(ns itonami.otehon.code-rpc
  "The pure shaping half of itonami.agent.code-rpc: error envelopes,
  the tool-error log scan, the sandbox allowlist and the recovery
  hint rules. The shim-header / tool-stubs data and
  generate-hermes-tools (byte-identical stub module) ride the
  file-transport slice with the serve loop; token check, dispatch,
  budget and log stay host-side (S6). Failure rules keep their
  (regex, formatter) shape and first-match-wins order, verbatim."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def sandbox-allowed-tools
  ["patch" "read_file" "search_files" "terminal" "web_extract" "web_search" "write_file"])

(def terminal-blocked-params
  #{"background" "pty" "notify" "notify_on_complete" "watch_patterns"
    "heartbeat" "persist_on_release"})

(def default-max-tool-calls 50)
(def max-tool-error-chars 2048)
(def tool-error-truncation-marker "… [truncated]")

(defn tool-error
  [message]
  (let [text (str message)]
    (hio/json-str {"error" (if (<= (count text) max-tool-error-chars)
                             text
                             (str (subs text 0 max-tool-error-chars)
                                  tool-error-truncation-marker))})))

(defn- bounded300 [s]
  (let [text (str s)] (subs text 0 (min 300 (count text)))))

(defn result-error
  [result]
  (if (and (string? result) (str/starts-with? result "{") (str/includes? result "\"error\""))
    (try
      (let [body (hio/parse-json result)
            e (when (map? body) (get body "error"))]
        (if e (bounded300 e) ""))
      (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ ""))
    ""))

(defn tool-errors-since
  [log start]
  (vec (take 5 (for [e (drop start log)
                     :when (get e "error")]
                 {"tool" (get e "tool") "error" (get e "error")}))))

(defn sandbox-tools-for
  [enabled]
  (let [x (filter (set enabled) sandbox-allowed-tools)]
    (if (seq x) (vec x) sandbox-allowed-tools)))

(defn- missing-import-hint
  [missing enabled]
  (if (contains? #{"json_parse" "shell_quote" "retry"} missing)
    (str "Import helpers with `from hermes_tools import " missing "`. If that import failed, "
         "the generated module may be stale or another hermes_tools may be first on sys.path. "
         "Check hermes_tools.__file__ and retry with reset=true.")
    (str "'" missing "' is not available inside the execute_code sandbox. Importable tools here: "
         (str/join ", " (sandbox-tools-for enabled))
         ". For anything else, use the normal tool call instead of execute_code.")))

(def failure-hint-rules
  [[#"cannot import name '(\w+)' from 'hermes_tools'"
    (fn [m enabled] (missing-import-hint (nth m 1) enabled))]
   [#"NameError: name '(json_parse|shell_quote|retry)' is not defined"
    (fn [m _] (str "Import " (nth m 1) " before calling it: from hermes_tools import " (nth m 1)))]
   [#"ModuleNotFoundError: No module named '([\w.]+)'"
    (fn [m _] (str "'" (nth m 1) "' is not installed in the sandbox interpreter. "
                   "Use Python stdlib inside execute_code, or run the code via "
                   "terminal() with the project venv's python instead."))]
   [#"TypeError: string indices must be integers|AttributeError: 'str' object has no attribute 'get'"
    (fn [_ _] (str "Tool functions in the sandbox return DICTS (already parsed) — "
                   "do not json.loads() them or index them like strings. "
                   "Example: read_file(path)['content']."))]])

(defn failure-hint
  [stderr enabled]
  (when-not (str/blank? (str stderr))
    (let [window (subs (str stderr) 0 (min 4000 (count (str stderr))))]
      (some (fn [[re fmt]]
              (try
                (when-let [m (re-find re window)]
                  (fmt (if (vector? m) m [m]) enabled))
                (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))
            failure-hint-rules))))

(defn hint-on-failure
  [exit timed-out? stderr enabled]
  (when (or (true? timed-out?) (not= 0 exit))
    (failure-hint stderr enabled)))

;; ---- one execute_code run's RPC server state -------------------------------

(defn token-str
  [request]
  (let [t (get request "token")]
    (if (or (nil? t) (false? t)) "" (str t))))

(defn make-state
  "`dispatch` is (fn [tool-name args-map] result-string) — the run's own
  tool handlers. Shared cases never send a fn over EDN: the op wires a
  canned dispatch per case, so this stays exactly the legacy shape."
  [{:keys [rpc-dir rpc-token dispatch allowed-tools max-tool-calls]}]
  {:rpc-dir rpc-dir
   :rpc-token (or rpc-token "")
   :dispatch dispatch
   :allowed (vec (sort (or (seq allowed-tools) sandbox-allowed-tools)))
   :max-tool-calls (or max-tool-calls default-max-tool-calls)
   :counter (atom 0)
   :log (atom [])})

(defn- args-preview [args]
  (let [s (str args)] (subs s 0 (min 80 (count s)))))

(defn- round-half-up
  "Half-up round to a long. Durations here are non-negative, where all
  three runners agree; the one Java/JS/Python split (negative halves)
  cannot occur."
  [x]
  #?(:lpy (let [math (python/__import__ "math")] (int (.floor math (+ x 0.5))))
     :clj (Math/round (double x))
     :cljs (js/Math.round x)))

(defn duration-seconds
  "Legacy `duration-seconds`, with the clock injected: `now-ms` is ms like
  `hio/now-ms` (the legacy reads it inside). The op passes the live clock;
  shared cases pin fixed call-start/now-ms pairs."
  [call-start now-ms]
  (double (/ (round-half-up (* 100 (/ (- now-ms call-start) 1000))) 100)))

(defn- floor-num
  [x]
  #?(:lpy (let [math (python/__import__ "math")] (.floor math x))
     :clj (Math/floor (double x))
     :cljs (js/Math.floor x)))

(defn- finite-num?
  [x]
  #?(:lpy (let [math (python/__import__ "math")] (boolean (.isfinite math x)))
     :clj (Double/isFinite (double x))
     :cljs (js/Number.isFinite x)))

(defn int-seq?
  "Legacy `int-seq?`: the parsed JSON seq number. Integral floats count
  (JSON numbers arrive all the same); strings, booleans, nil, NaN and
  infinities do not."
  [s]
  ;; `==`, not `=`: bb/SCI `=` is strict across Long/Double (1 vs 1.0),
  ;; while all three runners agree on numeric `==`.
  (and (number? s) (finite-num? s) (== s (floor-num s))))

(defn req-file?
  "Legacy `req-file?`: a transport request name that is not a tmp part."
  [f]
  (and (str/starts-with? f "req_") (not (str/ends-with? f ".tmp"))))

(defn res-name
  "Legacy `res-name`: Python f\"res_{seq:06d}\" — the width counts the sign,
  so negatives take 5 digits (`res_-00001`); overflow never truncates."
  [n]
  (let [neg (neg? n)
        width (if neg 5 6)
        digits (str (if neg (- n) n))
        pad (str/join (repeat (max 0 (- width (count digits))) "0"))]
    (str "res_" (when neg "-") pad digits)))

(defn token-ok?
  "Legacy `token-ok?`: constant-time token check; an empty server token
  fails closed. No early exit — length mismatch and per-char differences
  fold into one accumulator. The NUL pad only aligns lengths; a length
  mismatch already forces false, so pad collisions cannot flip a verdict."
  [request rpc-token]
  (and (string? rpc-token)
       (not (str/blank? rpc-token))
       (let [a (token-str request)
             la (count a) lb (count rpc-token)
             n (max la lb)
             pad (fn [s l] (str s (str/join (repeat (- n l) (str (char 0))))))]
         (zero? (+ (if (= la lb) 0 1)
                   (reduce + 0 (map (fn [x y] (if (= x y) 0 1))
                                    (pad a la) (pad rpc-token lb))))))))

(defn refusal
  "Legacy `handle-request` gates, minus the async dispatch tail:
  allow-list and budget refusals as `tool-error` strings, nil when the
  call may proceed. `counter` is a plain value (the op reads the state's
  atom); refusals never consume budget or log."
  [allowed tool-name counter max-tool-calls]
  (cond
    (not (some #{tool-name} allowed))
    (tool-error (str "Tool '" tool-name "' is not available in execute_code. Available: "
                     (str/join ", " allowed)))

    (>= counter max-tool-calls)
    (tool-error (str "Tool call limit reached (" max-tool-calls
                     "). No more tool calls allowed in this execution."))

    :else nil))

(defn terminal-args
  "Legacy `handle-request` args filter: strip `terminal-blocked-params`
  from terminal calls (non-maps become {}); other tools pass through
  untouched."
  [tool-name tool-args]
  (if (= tool-name "terminal")
    (into {} (remove (fn [[k _]] (contains? terminal-blocked-params k))
                     (if (map? tool-args) tool-args {})))
    tool-args))

(defn message-text
  "Legacy `message-text`: the exception's message, or its printed form
  when it carries none — the `(or (ex-message e) (str e))` shape the other
  units already use."
  [e]
  (or (ex-message e) (str e)))

(defn finish-call!
  "The `_handle_rpc_request` tail after dispatch: coerce the result to
  its response string, consume budget, and log it (with the bounded
  error when the result carries one). `call-start` is ms like
  `hio/now-ms`; the logged duration is clock-derived and stripped
  from shared-case comparisons (see the op)."
  [state tool-name args result call-start]
  (let [result (try
                 (if (string? result) result (hio/json-str result))
                 (catch #?(:lpy python/Exception :clj Exception :cljs :default) e (tool-error (str e))))
        error (result-error result)
        entry (cond-> {"tool" tool-name
                       "args_preview" (args-preview args)
                       "duration" (duration-seconds call-start (hio/now-ms))}
                (seq error) (assoc "error" error))]
    (swap! (:counter state) inc)
    (swap! (:log state) conj entry)
    result))

(def ^:private bom-str
  "The UTF-8 BOM, built from its code point: no backslash-u escape
  may appear in portable sources (PORTABILITY.md)."
  (str (char 65279)))

;; ---- hermes_tools.py generation (code_execution_tool.py) ------------------

(def ^:private shim-header
  ;; code_execution_tool/_FILE_TRANSPORT_HEADER verbatim (the generated module's
  ;; source up to the first stub).
  (str "\"\"\"Auto-generated Hermes tools RPC stubs (file-based transport).\"\"\"\nimport json, os, shlex, tempfile, threading, time\n\n_RPC_DIR = os.environ.get(\"HERMES_RPC_DIR\") or os.path.join(tempfile.gettempdir(), \"hermes_rpc\")\n_seq = 0\n# `_seq += 1` is not atomic (read-modify-write), so concurrent _call()\n# invocations from multiple threads could allocate the same sequence number\n# and clobber each other's request files. Guard seq allocation with a lock.\n_seq_lock = threading.Lock()\n\n# ---------------------------------------------------------------------------\n# Convenience helpers (avoid common scripting pitfalls)\n# ---------------------------------------------------------------------------\n\ndef json_parse(text: str):\n    \"\"\"Parse JSON tolerant of control characters and UTF-8 BOM (strict=False).\n    Use this instead of json.loads() when parsing output from terminal()\n    or web_extract() that may contain raw tabs/newlines in strings,\n    or from tools/files that prepend a UTF-8 BOM (salvage #57870, credit @woxinwuhen713-bit).\"\"\"\n    if isinstance(text, str) and text.startswith(\"" bom-str "\"):\n        text = text[1:]\n    return json.loads(text, strict=False)\n\n\ndef shell_quote(s: str) -> str:\n    \"\"\"Shell-escape a string for safe interpolation into commands.\n    Use this when inserting dynamic content into terminal() commands:\n        terminal(f\"echo {shell_quote(user_input)}\")\n    \"\"\"\n    return shlex.quote(s)\n\n\ndef retry(fn, max_attempts=3, delay=2):\n    \"\"\"Retry a function up to max_attempts times with exponential backoff.\n    Use for transient failures (network errors, API rate limits):\n        result = retry(lambda: terminal(\"gh issue list ...\"))\n    \"\"\"\n    last_err = None\n    for attempt in range(max_attempts):\n        try:\n            return fn()\n        except Exception as e:\n            last_err = e\n            if attempt < max_attempts - 1:\n                time.sleep(delay * (2 ** attempt))\n    raise last_err\n\n\ndef _call(tool_name, args):\n    \"\"\"Send a tool call request via file-based RPC and wait for response.\"\"\"\n    global _seq\n    with _seq_lock:\n        _seq += 1\n        seq = _seq\n    seq_str = f\"{seq:06d}\"\n    req_file = os.path.join(_RPC_DIR, f\"req_{seq_str}\")\n    res_file = os.path.join(_RPC_DIR, f\"res_{seq_str}\")\n\n    # Write request atomically (write to .tmp, then rename).\n    # encoding=\"utf-8\" is critical: on Windows-hosted remote backends\n    # (or any non-UTF-8 locale) the default open() mode would mangle\n    # non-ASCII chars in tool args when encoding them as JSON.\n    tmp = req_file + \".tmp\"\n    # The request carries the RPC token and tool args: owner-only even under a\n    # permissive process umask.\n    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)\n    with os.fdopen(fd, \"w\", encoding=\"utf-8\") as f:\n        json.dump({\n            \"tool\": tool_name,\n            \"args\": args,\n            \"seq\": seq,\n            \"token\": os.environ.get(\"HERMES_RPC_TOKEN\", \"\"),\n        }, f)\n    os.rename(tmp, req_file)\n\n    # Wait for response with adaptive polling\n    deadline = time.monotonic() + 300  # 5-minute timeout per tool call\n    poll_interval = 0.05  # Start at 50ms\n    while not os.path.exists(res_file):\n        if time.monotonic() > deadline:\n            raise RuntimeError(f\"RPC timeout: no response for {tool_name} after 300s\")\n        time.sleep(poll_interval)\n        poll_interval = min(poll_interval * 1.2, 0.25)  # Back off to 250ms\n\n    with open(res_file, encoding=\"utf-8\") as f:\n        raw = f.read()\n\n    # Clean up response file\n    try:\n        os.unlink(res_file)\n    except OSError:\n        pass\n\n    result = json.loads(raw)\n    if isinstance(result, str):\n        try:\n            return json.loads(result)\n        except (json.JSONDecodeError, TypeError):\n            return result\n    return result\n\n"))

(def ^:private tool-stubs
  ;; code_execution_tool/_TOOL_STUBS: name -> [signature, docstring, args_dict_expr]
  {"web_search"
   ["query: str, limit: int = 5"
    "\"\"\"Search the web. Returns dict with data.web list of {url, title, description}.\"\"\""
    "{\"query\": query, \"limit\": limit}"]
   "web_extract"
   ["urls: list, char_limit: int = None"
    "\"\"\"Extract content from URLs (no LLM summarization). Returns dict with results list of {url, title, content, error}. Pages over char_limit (default 15000) are head+tail truncated with the full text stored on disk; the content footer gives the path. content is markdown.\"\"\""
    "{\"urls\": urls, \"char_limit\": char_limit}"]
   "read_file"
   ["path: str, offset: int = 1, limit: int = 2000"
    "\"\"\"Read a file (1-indexed lines). Returns dict with \"content\" and \"total_lines\".\"\"\""
    "{\"path\": path, \"offset\": offset, \"limit\": limit}"]
   "write_file"
   ["path: str, content: str, cross_profile: bool = False"
    "\"\"\"Write content to a file (always overwrites). Returns dict with status.\"\"\""
    "{\"path\": path, \"content\": content, \"cross_profile\": cross_profile}"]
   "search_files"
   ["pattern: str, target: str = \"content\", path: str = \".\", file_glob: str = None, limit: int = 50, offset: int = 0, output_mode: str = \"content\", context: int = 0, order: str = \"discovery\""
    "\"\"\"Search file contents (target=\"content\") or find files by name (target=\"files\"). Returns dict with \"matches\".\"\"\""
    "{\"pattern\": pattern, \"target\": target, \"path\": path, \"file_glob\": file_glob, \"limit\": limit, \"offset\": offset, \"output_mode\": output_mode, \"context\": context, \"order\": order}"]
   "patch"
   ["path: str = None, old_string: str = None, new_string: str = None, replace_all: bool = False, mode: str = \"replace\", patch: str = None, cross_profile: bool = False"
    "\"\"\"Targeted find-and-replace (mode=\"replace\") or V4A multi-file patches (mode=\"patch\"). Returns dict with status.\"\"\""
    "{\"path\": path, \"old_string\": old_string, \"new_string\": new_string, \"replace_all\": replace_all, \"mode\": mode, \"patch\": patch, \"cross_profile\": cross_profile}"]
   "terminal"
   ["command: str, timeout: int = None, workdir: str = None"
    "\"\"\"Run a shell command (foreground only). Returns dict with \"output\" and \"exit_code\".\"\"\""
    "{\"command\": command, \"timeout\": timeout, \"workdir\": workdir}"]})

(defn generate-hermes-tools
  "Source of the hermes_tools.py stub module for SANDBOX_ALLOWED_TOOLS ∩
  `enabled` — byte-identical to generate_hermes_tools_module with the
  file transport."
  [enabled]
  (let [names (sort (sandbox-tools-for enabled))
        stubs (for [n names
                    :let [[sig doc args-expr] (get tool-stubs n)]]
                (str "def " n "(" sig "):\n    " doc "\n    return _call('" n "', " args-expr ")\n"))]
    (str shim-header (str/join "\n" stubs))))
