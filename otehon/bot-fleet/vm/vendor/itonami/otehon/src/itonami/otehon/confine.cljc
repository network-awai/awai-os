(ns itonami.otehon.confine
  "Portable core of `itonami.agent.confine` (the OS boundary around the
  `terminal`, `read_file` and `search_files` tools) for the Otehon .cljc
  core, with one pinned answer on every runner.

  Ported (pure policy core): `policy`, `secret-paths`, `read-denial` /
  `readable?`, `confine-env`, `seatbelt-profile`, `bwrap-args`, `command`.
  The `:confine` shared-case op exercises these.

  Deliberate divergences from the `.cljk` reference (recorded, not gaps):
  - `secret-paths` takes `itonami-dir` explicitly; the legacy reads the
    ITONAMI_DIR env var inside. Shared cases must pin every input, and
    the process environment is not a portable case input.
  - `bwrap-args` takes an optional `:scan-fn` in its spec (default runs
    the real `find` scan via the host); cases stub the scan so the argv
    prefix is byte-pinned. A nil scan result still refuses, verbatim.
  - `command` takes an optional `:tmpdir`; the legacy always mints one.
    Cases pass an explicit tmpdir so `:argv` is byte-pinned.
  - `backend` (sandbox-exec/bwrap host probe) and the `audit*!` log
    writers stay host-side: their outputs depend on the machine and the
    clock, so no shared case can pin them.

  Portability: no host interop except through `hio`; no regex literals
  carrying a literal backslash; `re-pattern` is built from plain strings."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def base-env-keys
  ["PATH" "HOME" "USER" "LOGNAME" "SHELL" "LANG" "LC_ALL" "LC_CTYPE" "TERM" "TZ"])

(defn join
  "Join path segments with `/` (no duplicate separators)."
  [& parts]
  (str/join "/" (remove str/blank? (map #(str/replace (str %) #"/+$" "") parts))))

(defn expand
  "Expand a leading `~` against HOME."
  [p]
  (let [s (str p)]
    (if (str/starts-with? s "~")
      (str (or (hio/env "HOME") "~") (subs s 1))
      s)))

(defn- ls-names
  [dir]
  (try (hio/read-dir-names dir)
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ [])))

(defn- exists?
  [p]
  (boolean (or (hio/file? p) (hio/dir? p))))

(defn secret-paths
  "Directories and files under `home` a confined command may not read.
  `itonami-dir` is explicit (the legacy reads ITONAMI_DIR itself)."
  [home itonami-dir]
  (let [j #(join home %)]
    {:dirs [(j ".ssh") (j ".aws") (j ".gnupg") (j ".kube") (j ".docker")
            (j ".config/gh") (j ".config/gcloud") (j ".azure") (j ".password-store")
            (j "Library/Keychains") (j ".itonami/node") (join itonami-dir "node")]
     :files (vec (concat [(j ".netrc") (j ".git-credentials") (j ".npmrc") (j ".pypirc")
                          (j ".itonami/peer.env") (join itonami-dir "peer.env") (j ".hermes/.env")]
                         (for [p (ls-names (join itonami-dir "profiles"))]
                           (join itonami-dir "profiles" p ".env"))
                         (for [p (ls-names (j ".itonami/profiles"))] (j (str ".itonami/profiles/" p "/.env")))
                         (for [p (ls-names (j ".hermes/profiles"))] (j (str ".hermes/profiles/" p "/.env")))))
     :name-patterns ["\\.env$" "\\.env\\.[^/]*$" "/secrets\\.command$" "/auth\\.json$"]}))

(defn policy
  "The terminal policy of a run. `peer?` = a turn this node runs for
  someone else: the bundle's own :terminal is ignored."
  [itonami-edn {:keys [peer?]}]
  (let [t (when-not peer? (:terminal itonami-edn))]
    {:confinement (if peer? :sandbox (get t :confinement :sandbox))
     :network? (boolean (and (not peer?) (:network t)))
     :env-allow (vec (when-not peer? (:env t)))
     :write-extra (vec (when-not peer? (map expand (:write t))))
     :read-scope (if peer? :roots :all-but-secrets)
     :web-allow (some-> (get-in itonami-edn [:web :allow]) vec)
     :peer? (boolean peer?)}))

(defn- under? [p dir] (or (= p dir) (str/starts-with? p (str dir "/"))))

(defn- real [p] (try (hio/realpath p)
                     (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ p)))

(defn- real-or-parent
  [p]
  (if (exists? p)
    (real p)
    (let [parent (hio/dirname p)]
      (if (= parent p) p (join (real-or-parent parent) (hio/basename p))))))

(defn path-home-dirs
  "Toolchain dirs on PATH under `home` (and their parent when named bin/)."
  [home]
  (vec (distinct (for [d (str/split (or (hio/env "PATH") "") #":")
                       :when (and (seq d) (under? d home))
                       x (if (= "bin" (hio/basename d)) [d (hio/dirname d)] [d])]
                   x))))

(defn read-denial
  "Why an in-process tool may not read `path` under `pol`: :secret |
  :outside-roots, or nil when it may."
  [pol {:keys [path roots home itonami-dir]}]
  (when-not (and (= :host (:confinement pol)) (not (:peer? pol)))
    (let [p (real-or-parent (str path))
          home (real (str home))
          {:keys [dirs files name-patterns]} (secret-paths home (str itonami-dir))]
      (cond
        (or (some #(under? p (real %)) dirs)
            (some #(= p (real %)) files)
            (some #(re-find (re-pattern %) p) name-patterns)) :secret
        (and (= :roots (:read-scope pol))
             (under? p home)
             (not (some #(under? p (real %)) roots))) :outside-roots))))

(defn readable? [pol opts] (nil? (read-denial pol opts)))

(defn confine-env
  "The environment a confined command sees: base keys from this process,
  plus the granted profile secrets by name, plus its own TMPDIR (and,
  under :roots scope, TMPDIR as HOME)."
  [{:keys [env-allow read-scope]} tool-env tmpdir]
  (merge (select-keys (hio/all-env) base-env-keys)
         (select-keys tool-env env-allow)
         {"TMPDIR" tmpdir}
         (when (= :roots read-scope) {"HOME" tmpdir})))

(defn- sb-str [s] (str "\"" (-> s (str/replace "\\" "\\\\") (str/replace "\"" "\\\"")) "\""))

(defn seatbelt-profile
  "SBPL text for {:write-roots [...] :read-roots [...] :read-scope kw :home
  dir :network? bool}. Later rules win, so the secret denials come last."
  [{:keys [write-roots read-roots read-scope home network? itonami-dir]}]
  (let [{:keys [dirs files name-patterns]} (secret-paths (str home) (str (or itonami-dir home)))]
    (str/join "\n"
              (concat
               ["(version 1)" "(allow default)"
                "(deny file-write*)"
                (str "(allow file-write* "
                     (str/join " " (concat (for [r write-roots] (str "(subpath " (sb-str (real (str r))) ")"))
                                           ["(literal \"/dev/null\")" "(literal \"/dev/zero\")"
                                            "(regex #\"^/dev/tty\")" "(regex #\"^/dev/fd/\")"
                                            "(literal \"/dev/dtracehelper\")"]))
                     ")")]
               (when (= :roots read-scope)
                 [(str "(deny file-read-data (subpath " (sb-str (real (str home))) "))")
                  (str "(allow file-read-data "
                       (str/join " " (for [r (concat write-roots read-roots)] (str "(subpath " (sb-str (real (str r))) ")")))
                       ")")])
               (for [d dirs] (str "(deny file-read* file-write* (subpath " (sb-str (real (str d))) "))"))
               (for [f files] (str "(deny file-read* file-write* (literal " (sb-str (real (str f))) "))"))
               (for [p name-patterns] (str "(deny file-read* file-write* (regex #\"" (str/replace p "\"" "\\\"") "\"))"))
               (when-not network? ["(deny network*)"])))))

(def ^:private secret-file-find
  ["(" "-name" "node_modules" "-o" "-name" ".git" ")" "-prune" "-o" "-type" "f"
   "(" "-name" "*.env" "-o" "-name" "*.env.*" "-o" "-name" "secrets.command" "-o" "-name" "auth.json" ")" "-print"])

(defn secret-files-under
  "Every file matching :name-patterns under `dirs`, or nil when the scan
  does not finish in time."
  [dirs]
  (let [dirs (filter hio/dir? dirs)]
    (if (empty? dirs)
      []
      (let [r (hio/spawn-sync! (into (into ["find"] dirs) secret-file-find) {:timeout-ms 15000})]
        (when-not (:timed-out? r)
          (vec (distinct (remove str/blank? (str/split-lines (:stdout r))))))))))

(defn bwrap-args
  "bubblewrap argv prefix for the same policy, or nil when the secret-file
  scan did not finish. `:scan-fn` overrides the `find` scan (cases stub
  it); mount order: empty home, roots on top, masks last."
  [{:keys [write-roots read-roots home network? scan-fn itonami-dir]}]
  (let [{:keys [dirs files]} (secret-paths (str home) (str (or itonami-dir home)))
        shown (vec (distinct (concat write-roots read-roots)))
        visible? (fn [p] (some #(under? (str p) (str %)) shown))
        found ((or scan-fn secret-files-under) shown)]
    (when found
      (vec (concat ["bwrap" "--ro-bind" "/" "/" "--dev" "/dev" "--proc" "/proc"
                    "--die-with-parent" "--new-session"]
                   (when-not network? ["--unshare-net"])
                   ["--tmpfs" (str home)]
                   (mapcat (fn [r] ["--ro-bind" (str r) (str r)])
                           (filter #(and (hio/dir? (str %)) (under? (str %) (str home))) read-roots))
                   (mapcat (fn [r] ["--bind" (str r) (str r)]) write-roots)
                   (mapcat (fn [d] ["--tmpfs" (str d)])
                           (filter #(and (hio/dir? (str %)) (visible? %)) dirs))
                   (mapcat (fn [f] ["--ro-bind" "/dev/null" (str f)])
                           (distinct (concat (filter #(and (hio/file? (str %)) (visible? %)) files) found))))))))

(defn command
  "How to run `cmd` (a shell line) or `argv` under `pol`. Returns {:argv
  [...] :env {...} :tmpdir dir :sandbox kw} or {:refused reason}.
  `:tmpdir` overrides the minted per-run TMPDIR (cases pin it)."
  [pol {:keys [cmd argv write-roots read-roots tool-env home backend tmpdir itonami-dir scan-fn]}]
  (let [run (or argv ["/bin/sh" "-c" cmd])]
    (if (and (= :host (:confinement pol)) (not (:peer? pol)))
      {:argv run :env (merge (hio/all-env) tool-env) :sandbox :host}
      (let [tmpdir (or tmpdir (join (or (hio/env "TMPDIR") "/tmp") (str "itonami-term-" (hio/random-hex 6))))]
        (hio/mkdirs! tmpdir)
        (let [spec {:write-roots (vec (distinct (concat write-roots (:write-extra pol) [tmpdir])))
                    :read-roots (vec (distinct (concat read-roots (path-home-dirs (str home)))))
                    :read-scope (:read-scope pol)
                    :home (str home) :network? (:network? pol) :itonami-dir (str (or itonami-dir home))}
              env' (confine-env pol tool-env tmpdir)]
          (case backend
            :seatbelt {:argv (into ["/usr/bin/sandbox-exec" "-p" (seatbelt-profile spec)] run)
                       :env env' :tmpdir tmpdir :sandbox :seatbelt}
            :bwrap (if-let [pre (bwrap-args (cond-> spec scan-fn (assoc :scan-fn scan-fn)))]
                     {:argv (into pre run) :env env' :tmpdir tmpdir :sandbox :bwrap}
                     (do (hio/remove-dir! tmpdir)
                         {:refused "secret-file scan under the run's directories did not finish in 15 s"}))
            (do (hio/remove-dir! tmpdir)
                {:refused (str "no OS sandbox on this host (need sandbox-exec or bwrap); "
                               (if (:peer? pol)
                                 "turns run for a peer are never unconfined"
                                 "set :terminal {:confinement :host} in itonami.edn to run unconfined"))})))))))
