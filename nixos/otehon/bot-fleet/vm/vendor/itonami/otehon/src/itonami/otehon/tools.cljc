(ns itonami.otehon.tools
  "The Hermes core tool registry: same tool names, toolsets and approval
  rules. Pure data (the `schemas` table) + predicates; the live tool
  implementations and the host PATH/CLI checks stay host-side (S6c/d)."
  (:require [clojure.string :as str]))

(defn- fn-schema [name desc props required]
  {"type" "function"
   "function" {"name" name "description" desc
               "parameters" {"type" "object" "properties" props "required" required}}})

(def schemas
  {"terminal"
   (fn-schema "terminal" "Execute a shell command on the host and return its output. Use for running scripts, git, builds and inspecting the system."
              {"command" {"type" "string" "description" "The command to execute"}
               "timeout" {"type" "integer" "description" "Seconds before the command is killed (default 180)"}
               "workdir" {"type" "string" "description" "Working directory (default: the profile's terminal cwd)"}
               "background" {"type" "boolean" "description" "Start a background process; use process_manage to poll, wait, read output, send stdin, or terminate it"}
               "notify_on_complete" {"type" "boolean" "description" "Push a completion notice to you when the background process exits (background only; subagents cannot receive one — hand the process to your parent with process_manage instead)"}
               "notify" {"description" "With background=true. true: one notification on exit; use it for anything that ends (builds, tests, deploys), or the job runs silently. ['pattern', ...]: notify when a line matches, only for one-shot readiness on processes that never exit; rate-limited. Omit for servers/daemons."
                         "anyOf" [{"type" "boolean"} {"type" "array" "items" {"type" "string"}}]}
               "heartbeat" {"type" "integer" "minimum" 0 "default" 0
                            "description" "With background=true: also notify every N seconds (min 60) with new output; quiet ticks are skipped. For bounded jobs you must react to mid-run, never servers. Implies notify=true; 0 = off."}}
              ["command"])
   "process_manage"
   (fn-schema "process_manage" "Poll, wait on, read, or control a background terminal process started in this Kotoba agent runtime. Completed results are retained for up to 7 days, newest 64 per profile, while the agent runtime is alive."
              {"action" {"type" "string" "enum" ["list" "poll" "log" "wait" "kill" "write" "submit" "close" "handoff"]}
               "session_id" {"type" "string" "description" "Exact id or unique prefix returned by terminal(background=true). Required except for list."}
               "data" {"type" "string" "description" "Text to write or submit to stdin."}
               "timeout" {"type" "integer" "minimum" 1 "description" "Seconds to wait, capped at 1800."}
               "offset" {"type" "integer" "description" "Zero-based log line offset; omitted reads the tail."}
               "limit" {"type" "integer" "minimum" 1 "description" "Maximum log lines (capped at 2000)."}}
              ["action"])
   "read_file"
   (fn-schema "read_file" "Read a text file with line numbers (LINE_NUM|CONTENT)."
              {"path" {"type" "string"} "offset" {"type" "integer" "description" "1-based first line"}
               "limit" {"type" "integer" "description" "max lines (<= 2000)"}}
              ["path"])
   "write_file"
   (fn-schema "write_file" "Write content to a file, creating parent directories. Overwrites."
              {"path" {"type" "string"} "content" {"type" "string"}}
              ["path" "content"])
   "patch"
   (fn-schema "patch" "Replace old_string with new_string in a file. old_string must be unique unless replace_all."
              {"path" {"type" "string"} "old_string" {"type" "string"} "new_string" {"type" "string"}
               "replace_all" {"type" "boolean"}}
              ["path" "old_string" "new_string"])
   "search_files"
   (fn-schema "search_files" "Search file contents (regex) or file names (glob) under a path."
              {"pattern" {"type" "string"} "target" {"type" "string" "enum" ["content" "files"]}
               "path" {"type" "string"} "file_glob" {"type" "string"} "limit" {"type" "integer"}}
              ["pattern"])
   "web_search"
   (fn-schema "web_search" "Search the web. Returns titles, urls and snippets."
              {"query" {"type" "string"} "limit" {"type" "integer"}}
              ["query"])
   "web_extract"
   (fn-schema "web_extract" "Fetch up to 5 URLs and return their readable text."
              {"urls" {"type" "array" "items" {"type" "string"}} "char_limit" {"type" "integer"}}
              ["urls"])
   "browser_navigate"
   (fn-schema "browser_navigate" "Navigate to a public website through Kotoba's guarded browser proxy."
              {"url" {"type" "string"}} ["url"])
   "browser_snapshot"
   (fn-schema "browser_snapshot" "Read the current page accessibility snapshot."
              {"full" {"type" "boolean" "default" false}} [])
   "browser_click"
   (fn-schema "browser_click" "Click an element ref from the latest browser snapshot."
              {"ref" {"type" "string"}} ["ref"])
   "browser_type"
   (fn-schema "browser_type" "Replace the value of an input identified by a browser ref."
              {"ref" {"type" "string"} "text" {"type" "string"}} ["ref" "text"])
   "browser_scroll"
   (fn-schema "browser_scroll" "Scroll the current browser page."
              {"direction" {"type" "string" "enum" ["up" "down" "left" "right"]}} ["direction"])
   "browser_back"
   (fn-schema "browser_back" "Navigate back in the current browser session." {} [])
   "browser_press"
   (fn-schema "browser_press" "Press a keyboard key in the current browser page."
              {"key" {"type" "string"}} ["key"])
   "browser_get_images"
   (fn-schema "browser_get_images" "List images in the current browser page with source URLs and alt text." {} [])
   "browser_console"
   (fn-schema "browser_console" "Read browser console output or evaluate an expression in the current page."
              {"clear" {"type" "boolean" "default" false} "expression" {"type" "string"}} [])
   "browser_vision"
   (fn-schema "browser_vision" "Capture the current page and analyze its visible layout with the active Kotoba vision provider."
              {"question" {"type" "string"} "annotate" {"type" "boolean" "default" false}} ["question"])
   "vision_analyze"
   (fn-schema "vision_analyze" "Analyze an image using the active Kotoba provider chain. Remote URLs use the public-only web guard; local files must be readable by this run."
              {"image_url" {"type" "string" "description" "Public http(s) image URL, base64 image data URL, or readable local image path."}
               "question" {"type" "string" "description" "What to inspect or answer about the image."}}
              ["image_url" "question"])
   "skill_view"
   (fn-schema "skill_view" "Read a skill's SKILL.md (or a file inside the skill)."
              {"name" {"type" "string"} "file_path" {"type" "string"}}
              ["name"])
   "browser_cdp"
   (fn-schema "browser_cdp" "Send a raw Chrome DevTools Protocol (CDP) command. Escape hatch for browser operations not covered by the other browser tools. Requires a reachable CDP endpoint (browser.cdp_url / browser.cdp_endpoint / BROWSER_CDP_URL). Returns {success, method, result} or {error}."
              {"method" {"type" "string" "description" "CDP method, e.g. Target.attachToTarget"}
               "params" {"type" "object" "additionalProperties" true "description" "CDP parameters for the method"}
               "target_id" {"type" "string" "description" "Attach to this target first (flattened session) and send the command inside it"}}
              ["method"])
   "browser_dialog"
   (fn-schema "browser_dialog" "Answer the open JavaScript dialog. 'accept' clicks OK / returns the prompt text; 'dismiss' clicks Cancel / returns null from prompt(). For beforeunload dialogs: 'accept' allows the navigation, 'dismiss' keeps the page. Requires a CDP-capable backend."
              {"action" {"type" "string" "enum" ["accept" "dismiss"]}
               "prompt_text" {"type" "string" "description" "Response string for a prompt() dialog. Ignored for other dialog types. Defaults to empty string."}
               "dialog_id" {"type" "string" "description" "Specific dialog to respond to (its CDP target id). Required only when multiple dialogs are queued."}}
              ["action"])
   "browser_vault_list"
   (fn-schema "browser_vault_list" "List login handles + metadata across every enabled backend. Passwords are never included. A locked external manager contributes no items; it is reported under `locked` instead."
              {} [])
   "browser_vault_unlock"
   (fn-schema "browser_vault_unlock" "Ask the user (via the surface's masked prompt) to unlock an external manager for this session."
              {"backend_name" {"type" "string" "description" "Backend to unlock (see the `locked` list from browser_vault_list)."}}
              ["backend_name"])
   "browser_vault_save_login"
   (fn-schema "browser_vault_save_login" "Ask the user (masked prompt on their surface) for the login of the CURRENT page, store it in the local vault bound to that origin, and fill the password at once. The values never enter the conversation."
              {"label" {"type" "string" "description" "Optional label for the saved login."}
               "task_id" {"type" "string"}}
              [])
   "browser_vault_enter_code"
   (fn-schema "browser_vault_enter_code" "Second factor: fill the one-time code the CURRENT page asks for. If the saved login has an authenticator seed, the code is minted server-side and nobody is asked; otherwise the user is prompted on their surface. The code goes into the page and never enters the conversation."
              {"handle" {"type" "string" "description" "The saved login handle; optional when only one login exists."}
               "task_id" {"type" "string"}}
              [])
   "browser_vault_fill"
   (fn-schema "browser_vault_fill" "Fill the current page's password field from a vault handle. Password-only: the identifier is agent-visible metadata (see browser_vault_list) and is typed by the agent via normal input tools."
              {"handle" {"type" "string" "description" "A handle from browser_vault_list."}
               "task_id" {"type" "string"}}
              ["handle"])
   "browser_exec"
   (fn-schema "browser_exec" "Drive a real web browser via the Browser Use CLI: `code` runs as full Python (stdlib available) with pre-imported browser helpers; stdout comes back in the result. Start `code` with a one-line comment describing the step for the user in plain language, max 60 chars. STATE: the browser session and workspace persist across calls; Python variables do NOT. The workspace dir is in every result; functions defined in agent_helpers.py there are auto-imported into every call."
              {"code" {"type" "string" "description" "Python code to execute using the pre-imported browser helpers. Use print(...) for any data you need back."}
               "session" {"type" "string" "description" "Named isolated browser session — its own daemon, so concurrent tasks don't share tabs. Reuse the same name on every related call; omit for the shared default session."}
               "timeout_s" {"type" "integer" "default" 300 "description" "Max seconds to wait for the code to finish (default 300, max 1800)."}}
              ["code"])
   "skills_list"
   (fn-schema "skills_list" "List available profile skills with names, descriptions, and categories. Use skill_view(name) to load a skill."
              {"category" {"type" "string" "description" "Optional category filter"}}
              [])
   "skill_manage"
   (fn-schema "skill_manage" "Create, patch, or delete profile skills and supporting files. Up to 20 operations apply as one approved transaction; any failure rolls the touched skills back. Delete must be the only operation. Read first with skill_view."
              {"operations" {"type" "array" "minItems" 1 "maxItems" 20
                             "items" {"type" "object" "properties"
                                      {"action" {"type" "string" "enum" ["create" "patch" "write_file" "remove_file" "delete"]}
                                       "name" {"type" "string"}
                                       "category" {"type" "string"}
                                       "content" {"type" "string"}
                                       "old_string" {"type" "string"}
                                       "new_string" {"type" "string"}
                                       "replace_all" {"type" "boolean"}
                                       "file_path" {"type" "string"}
                                       "file_content" {"type" "string"}}
                                      "required" ["action" "name"]}}}
              ["operations"])
   "todo_list"
   (fn-schema "todo_list" "Track a task list for multi-step work. Pass todos to replace or merge the list; omit todos to read it. Always returns the full list."
              {"todos" {"type" "array" "items" {"type" "object" "properties"
                                                    {"id" {"type" "string"}
                                                     "content" {"type" "string"}
                                                     "status" {"type" "string" "enum" ["pending" "in_progress" "completed" "cancelled"]}
                                                     "parent" {"type" "string"}}
                                                    "required" ["id" "content" "status"]}}
               "merge" {"type" "boolean" "default" false
                        "description" "Update existing items by id and append new ones instead of replacing the list."}}
              [])
   "delegate_task"
   (fn-schema "delegate_task"
              "Spawn subagents in isolated contexts; each gets its own conversation and toolset, and only its final summary returns to you. Pass every task in `tasks` — one entry spawns one subagent, several run in parallel (up to 10 for this user, set via delegation.max_concurrent_children). One-shot sessions (CLI -z, cron) join their children and return results in this call. Children know nothing of this conversation: pass everything needed via 'context', including any required output language. Child summaries are SELF-REPORTS, not verified facts: for external side effects require a verifiable handle and verify it yourself. Children cannot call delegate_task, clarify, memory, or cronjob tools. USE FOR: reasoning-heavy subtasks, work that would flood your context, or independent parallel workstreams. DO NOT USE FOR: mechanical multi-step work (use terminal), a single tool call (call it directly), tasks needing user interaction, or durable work (use cron)."
              {"tasks" {"type" "array" "minItems" 1 "maxItems" 10
                        "description" "The task(s). Each entry spawns one subagent with isolated context; a single task is a one-entry array. Required when spawning."
                        "items" {"type" "object"
                                 "properties"
                                 {"goal" {"type" "string" "description" "What this subagent should accomplish. Be specific and self-contained — it knows nothing about your conversation history."}
                                  "context" {"type" "string" "description" "Background THIS child needs: file paths, error messages, constraints. Each child sees only its own context — repeat shared background in every task that needs it."}
                                  "output_schema" {"type" "object" "description" "Optional JSON Schema this child's final answer must validate against (told to the child up front; parent validates with one bounded correction retry; result gains schema_valid, plus schema_errors on failure — the child's raw text is still returned as summary, never discarded). Keep it forgiving — require only fields you will read."}
                                  "images" {"type" "array" "items" {"type" "string"} "description" "Optional images this child must SEE (max 8): local file paths or http(s) URLs. Text files do NOT belong here — put paths in 'context' instead."}}
                                 "required" ["goal"]}}
               "action" {"type" "string" "enum" ["spawn" "list" "steer" "stop"]
                         "description" "Default 'spawn'. 'list' = ids/goals/status of children; 'steer'/'stop' target one child by subagent_id. Joined (foreground) children have no mid-run inbox and no cancel — those actions answer honestly instead of pretending."}
               "subagent_id" {"type" "string" "description" "Target for action='steer'/'stop' (ids from the spawn response or action='list')."}
               "message" {"type" "string" "description" "For action='steer': the course correction, appended to the child's next tool result mid-run. Be directive and specific."}}
              [])
   "cronjob_manage"
   (fn-schema "cronjob_manage" "Manage this profile's scheduled Kotoba jobs, including monitor_script and monitor_url pre-run checks. List, create, update, pause, resume, remove, or run a job. Mutations require approval."
              {"action" {"type" "string" "enum" ["create" "list" "update" "pause" "resume" "remove" "run"]}
               "job_id" {"type" "string"}
               "prompt" {"type" "string"}
               "schedule" {"type" "string" "description" "Use a duration such as 30m or every 2 hours, a phrase such as every weekday at 9am, a 5-field cron expression, an ISO timestamp, or a one-shot such as in 30m."}
               "name" {"type" "string"}
               "repeat" {"type" "integer"} "deliver" {"type" "string"} "failure_deliver" {"type" "string"}
               "script" {"type" "string"} "monitor_script" {"type" "string"} "monitor_url" {"type" "string"}
               "context_from" {"type" "array" "items" {"type" "string"}}
               "continuity" {"type" "boolean"} "enabled_toolsets" {"type" "array" "items" {"type" "string"}}
               "workdir" {"type" "string"} "no_agent" {"type" "boolean"}
               "paused" {"type" "boolean"} "paused_reason" {"type" "string"} "pinned" {"type" "boolean"}
               "skills" {"type" "array" "items" {"type" "string"}} "skill" {"type" "string"}
               "include_disabled" {"type" "boolean"}}
              ["action"])
   "memory"
   (fn-schema "memory" "Add, replace or remove an entry in persistent memory (MEMORY.md / USER.md)."
              {"action" {"type" "string" "enum" ["add" "replace" "remove"]}
               "target" {"type" "string" "enum" ["memory" "user"]}
               "content" {"type" "string"} "old_text" {"type" "string"} "new_text" {"type" "string"}}
              ["action"])
   "execute_code"
   (fn-schema "execute_code" "Run Python that calls Hermes tools programmatically. Use when you need 3+ tool calls with logic between them: filtering/reducing large outputs before they enter context, branching, or loops (N pages/files, retry on failure). Use normal tool calls for single calls, results you must reason over in full, or anything needing user interaction. Calls run one confined, stateless script per call (no persistent kernel): variables, imports, and loaded data do not survive across calls; a timed-out call loses its state. Available via `from hermes_tools import ...`: web_search, web_extract, read_file, write_file, search_files, patch, terminal (foreground only). Limits: timeout parameter (default 300 s), max 50 tool calls per call. Helpers require imports: `from hermes_tools import json_parse, shell_quote, retry`. json_parse(text) - tolerant json.loads for terminal() output; shell_quote(s) - shlex.quote for dynamic shell args; retry(fn, max_attempts=3, delay=2) - exponential backoff."
             {"code" {"type" "string" "description" "Python code to execute. Import tools with `from hermes_tools import ...` and print your final result to stdout."}
               "timeout" {"type" "integer" "minimum" 1 "maximum" 300 "description" "Maximum runtime in seconds (default 300)."}}
              ["code"])
   "session_search"
   (fn-schema "session_search" "Search and read Hermes conversation history from this profile's state.db. Supports recent-session browsing, FTS discovery (which also matches session titles and returns one hit per session lineage), reading the latest messages in a session, and scrolling around a message id. Cross-profile: pass profile=<name> (or the @session:<profile>/<id> link as session_id) to search another profile's state.db read-only. Discovery honours detail=adaptive (default: only the top-ranked hit is fully hydrated) / full, plus sort (newest/oldest temporal bias), after/before session-start bounds, and exclude_session_ids (those sessions and their lineage omitted). It is read-only."
              {"query" {"type" "string" "description" "Full-text search query; omit to browse recent sessions."}
               "limit" {"type" "integer" "minimum" 1 "maximum" 20 "description" "Maximum sessions or matching messages (default 5)."}
               "session_id" {"type" "string" "description" "Read one session; an @session:<profile>/<id> link resolves to that profile (or pass profile=)."}
               "around_message_id" {"type" "integer" "description" "Return a bounded window around this message id; requires session_id."}
               "window" {"type" "integer" "minimum" 1 "maximum" 20 "description" "Messages on each side of the anchor (default 5)."}
               "profile" {"type" "string" "description" "Search another profile's history (read-only) instead of this one."}
               "detail" {"type" "string" "enum" ["adaptive" "full"] "description" "Discovery shape only. adaptive (default) fully hydrates the top-ranked result and returns only the anchor message for lower-ranked results; full returns bookends and the complete anchored window for every result."}
               "role_filter" {"type" "string" "enum" ["user,assistant" "user,assistant,tool" "user" "assistant" "tool"]}
               "sort" {"type" "string" "enum" ["newest" "oldest"] "description" "Discovery shape only. Temporal bias on top of FTS5 ranking: omit for relevance-only (exploratory recall), 'newest' for \"where did we leave X\", 'oldest' for \"how did X start\"."}
               "after" {"type" "string" "description" "Discovery shape only. Inclusive lower bound on session start time. ISO date/datetime (e.g. 2026-06-01) or relative duration (7d, 24h, 2w = within the last N). Use only when the user names a time frame. sort is a ranking bias, not a bound."}
               "before" {"type" "string" "description" "Discovery shape only. Exclusive upper bound on session start time. ISO date/datetime (a date-only value is midnight UTC that day) or relative duration (7d = older than a week). Use only when the user names a time frame."}
               "exclude_session_ids" {"type" "array" "items" {"type" "string"} "description" "Discovery shape only. Session ids already inspected this task. Those sessions and their lineage are omitted so a later query explores instead of repeating the same hit. Cap 20."}}
              [])
   "kanban_show"
   (fn-schema "kanban_show" "Read a Hermes Kanban task with its parent/child links, comments, recent events, and runs."
              {"task_id" {"type" "string" "description" "Kanban task id; defaults to the assigned task in a dispatcher worker."}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              [])
   "kanban_list"
   (fn-schema "kanban_list" "List bounded Kanban task summaries for board routing. Dispatcher task workers cannot use this board-wide tool."
              {"assignee" {"type" "string"} "status" {"type" "string"}
               "tenant" {"type" "string"} "include_archived" {"type" "boolean"}
               "limit" {"type" "integer" "minimum" 1 "maximum" 200}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              [])
   "kanban_heartbeat"
   (fn-schema "kanban_heartbeat" "Record progress on a running Kanban task and extend this worker's matching claim when available."
              {"task_id" {"type" "string" "description" "Kanban task id; defaults to the assigned task in a dispatcher worker."}
               "note" {"type" "string" "description" "Optional short progress note."}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              [])
   "kanban_complete"
   (fn-schema "kanban_complete" "Complete a Kanban task with a structured handoff. A dispatcher worker may complete only its assigned task and matching run."
              {"task_id" {"type" "string" "description" "Kanban task id; defaults to the assigned task in a dispatcher worker."}
               "summary" {"type" "string"} "result" {"type" "string"}
               "metadata" {"type" "object"} "created_cards" {"type" "array" "items" {"type" "string"}}
               "artifacts" {"type" "array" "items" {"type" "string"}}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              [])
   "kanban_block"
   (fn-schema "kanban_block" "Stop work on a Kanban task and route it as dependency, human input, capability, or transient blocker."
              {"task_id" {"type" "string" "description" "Kanban task id; defaults to the assigned task in a dispatcher worker."}
               "reason" {"type" "string" "description" "Short explanation shown on the board."}
               "kind" {"type" "string" "enum" ["dependency" "needs_input" "capability" "transient"]}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["reason"])
   "kanban_request_review"
   (fn-schema "kanban_request_review" "Move a Kanban implementation into the review phase and optionally assign a reviewer."
              {"task_id" {"type" "string"} "summary" {"type" "string"}
               "metadata" {"type" "object"} "reviewer" {"type" "string"}
               "artifacts" {"type" "array" "items" {"type" "string"}}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["summary"])
   "kanban_request_changes"
   (fn-schema "kanban_request_changes" "Return a reviewed Kanban task to its implementer with a reason."
              {"task_id" {"type" "string"} "reason" {"type" "string"}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["reason"])
   "kanban_link"
   (fn-schema "kanban_link" "Add a parent-to-child dependency edge between existing Kanban tasks."
              {"parent_id" {"type" "string"} "child_id" {"type" "string"}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["parent_id" "child_id"])
   "kanban_unblock"
   (fn-schema "kanban_unblock" "Unblock a task and restore its resumable phase, respecting parent dependencies. Orchestrator-only."
              {"task_id" {"type" "string"} "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["task_id"])
   "kanban_create"
   (fn-schema "kanban_create" "Create an assigned Kanban task, optionally gated by parent tasks."
              {"title" {"type" "string"} "assignee" {"type" "string"} "body" {"type" "string"}
               "parents" {"type" "array" "items" {"type" "string"}}
               "tenant" {"type" "string"} "priority" {"type" "integer"}
               "workspace_kind" {"type" "string" "enum" ["scratch" "dir" "worktree"]}
               "workspace_path" {"type" "string"} "project" {"type" "string"}
               "triage" {"type" "boolean"} "idempotency_key" {"type" "string"}
               "max_runtime_seconds" {"type" "integer"} "initial_status" {"type" "string" "enum" ["running" "blocked"]}
               "skills" {"type" "array" "items" {"type" "string"}}
               "goal_mode" {"type" "boolean"} "goal_max_turns" {"type" "integer"}
               "completion_contract" {"type" "string"} "model" {"type" "string"}
               "provider" {"type" "string"} "board" {"type" "string"}}
              ["title" "assignee"])
   "kanban_attachments"
   (fn-schema "kanban_attachments" "List files attached to a Kanban task, including their stored paths and metadata."
              {"task_id" {"type" "string"} "board" {"type" "string" "description" "Optional Kanban board slug."}}
              [])
   "kanban_attach"
   (fn-schema "kanban_attach" "Attach a base64-encoded file to a Kanban task."
              {"task_id" {"type" "string"} "filename" {"type" "string"}
               "content_base64" {"type" "string"} "content_type" {"type" "string"}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["task_id" "filename" "content_base64"])
   "kanban_attach_url"
   (fn-schema "kanban_attach_url" "Download a public http(s) URL and attach its bytes to a Kanban task (25 MB maximum)."
              {"task_id" {"type" "string"} "url" {"type" "string"} "filename" {"type" "string"}
               "content_type" {"type" "string"} "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["url"])
   "kanban_comment"
   (fn-schema "kanban_comment" "Append a durable comment to a Hermes Kanban task. The author is the active Kotoba profile; callers cannot impersonate another profile."
              {"task_id" {"type" "string" "description" "Kanban task id."}
               "body" {"type" "string" "description" "Markdown comment to add to the task thread."}
               "board" {"type" "string" "description" "Optional Kanban board slug."}}
              ["task_id" "body"])
   "ha_list_entities"
   (fn-schema "ha_list_entities" "List Home Assistant entities, optionally filtered by domain or area."
              {"domain" {"type" "string"} "area" {"type" "string"}} [])
   "ha_get_state"
   (fn-schema "ha_get_state" "Get one Home Assistant entity state and attributes."
              {"entity_id" {"type" "string"}} ["entity_id"])
   "ha_list_services"
   (fn-schema "ha_list_services" "List Home Assistant services, optionally filtered by domain."
              {"domain" {"type" "string"}} [])
   "ha_call_service"
   (fn-schema "ha_call_service" "Call a Home Assistant service. Shell, scripting, add-on, and REST-command domains are blocked."
              {"domain" {"type" "string"} "service" {"type" "string"}
               "entity_id" {"type" "string"} "data" {"type" "string"}}
              ["domain" "service"])
   "clarify"
   (fn-schema "clarify"
     "Ask the user one or more questions when you need a decision or clarification. questions carries 1-5 entries of {question, choices?, multi_select?}; choices are best-first (the first is marked Recommended), 0-4 labels. The surface asks; answers come back as JSON where every response has status (answered/skipped/unanswered) and user_response. Unavailable in contexts with no user to ask."
     {"questions" {"type" "array"
                   "minItems" 1
                   "maxItems" 5
                   "items" {"type" "object"
                            "properties" {"question" {"type" "string"}
                                          "choices" {"type" "array" "items" {"type" "string"}}
                                          "multi_select" {"type" "boolean"}}}
                   "description" "1-5 questions: [{\"question\": text, \"choices\": [label...], \"multi_select\": bool}]."}}
     ["questions"])
   "manage_connections"
   (fn-schema "manage_connections"
     "Check or describe connection surfaces. Two kinds exist: hosted connector accounts (a tool-gateway integration, answered here with a named error) and local MCP servers (configured state plus cached OAuth auth). Slice 1 is read-only; installing or authorizing a connection is a later slice. Pass connections=[{name: ..., mcp: bool}]; with none, every configured surface is listed."
     {"connections" {"type" "array"
                     "items" {"type" "object"
                              "required" ["name"]
                              "additionalProperties" false
                              "properties" {"name" {"type" "string"}
                                            "mcp" {"type" "boolean"}}}
                     "description" "Connector requests: [{\"name\": ..., \"mcp\": bool}]. Omit to list everything configured."}}
     [])
   "text_to_speech"
   (fn-schema "text_to_speech"
     "Convert text to speech audio (slice 1: an OpenAI-compatible /audio/speech endpoint). Requires tts.provider and tts.model in config; tts.voice names the voice (default alloy). The audio is written into the profile workspace and the result names the file. An unconfigured or failing synthesis answers a named error."
     {"text" {"type" "string" "description" "The text to speak."}
      "voice" {"type" "string" "description" "Voice name (defaults to the configured tts.voice or alloy)."}
      "model" {"type" "string" "description" "Override the configured tts.model for this call."}
      "format" {"type" "string" "description" "Audio format (default mp3)."}}
     ["text"])
   "computer_use" {"type" "function"
   "function" {"name" "computer_use"
               "description" "Capture the visible desktop and perform approved UI actions. Capture before input; input requires an interactive one-time approval."
               "parameters" {"type" "object" "properties"
                              {"action" {"type" "string" "enum" ["capture" "list_apps" "list_windows" "focus_app" "click" "double_click" "right_click" "middle_click" "drag" "scroll" "type" "key" "set_value" "wait"]}
                              "mode" {"type" "string" "enum" ["som" "vision" "ax"]}
                              "app" {"type" "string"}
                              "pid" {"type" "integer"}
                              "window_id" {"type" "integer"}
                              "element" {"type" "integer"}
                              "coordinate" {"type" "array" "items" {"type" "integer"}}
                              "button" {"type" "string" "enum" ["left" "right" "middle"]}
                              "from_element" {"type" "integer"} "to_element" {"type" "integer"}
                              "from_coordinate" {"type" "array" "items" {"type" "integer"}}
                              "to_coordinate" {"type" "array" "items" {"type" "integer"}}
                              "direction" {"type" "string" "enum" ["up" "down" "left" "right"]}
                              "amount" {"type" "integer"} "text" {"type" "string"} "keys" {"type" "string"}
                              "value" {"type" "string"} "seconds" {"type" "number"}}
                             "required" ["action"]}}}})

(def hermes-core-tools
  ;; Source of truth: Hermes `toolsets.py::_HERMES_CORE_TOOLS`. Keep the full
  ;; advertised surface here, including tools Kotoba has not implemented yet.
  ;; `loop/run` checks this list and refuses an incomplete runtime instead of
  ;; quietly presenting a smaller toolset under a Hermes-compatible name.
  ["web_search" "web_extract" "terminal" "process_manage"
   "read_file" "write_file" "patch" "search_files"
   "vision_analyze" "image_generate" "skills_list" "skill_view" "skill_manage"
   "browser_navigate" "browser_snapshot" "browser_click" "browser_type"
   "browser_scroll" "browser_back" "browser_press" "browser_get_images"
   "browser_vision" "browser_console" "browser_cdp" "browser_dialog"
   "browser_vault_list" "browser_vault_unlock" "browser_vault_fill"
   "browser_vault_save_login" "browser_vault_enter_code" "browser_exec"
   "text_to_speech" "todo_list" "memory" "session_search" "clarify"
   "execute_code" "delegate_task" "cronjob_manage"
   "ha_list_entities" "ha_get_state" "ha_list_services" "ha_call_service"
   "kanban_show" "kanban_list" "kanban_complete" "kanban_block"
   "kanban_request_review" "kanban_request_changes" "kanban_heartbeat"
   "kanban_comment" "kanban_create"
   "kanban_attach" "kanban_attach_url" "kanban_attachments" "computer_use"
   "manage_connections"])

(def hermes-api-tools
  (vec (remove #(or (#{"text_to_speech" "clarify" "computer_use"} %)
                    (str/starts-with? % "kanban_"))
                hermes-core-tools)))

(def browser-tools
  ["browser_navigate" "browser_snapshot" "browser_click" "browser_type"
   "browser_scroll" "browser_back" "browser_press" "browser_get_images"
   "browser_vision" "browser_console" "browser_cdp" "browser_dialog"
   "browser_vault_list" "browser_vault_unlock" "browser_vault_fill"
   "browser_vault_save_login" "browser_vault_enter_code" "browser_exec"])

(def toolsets
  (let [file-tools ["read_file" "write_file" "patch" "search_files"]
        skill-tools ["skills_list" "skill_view" "skill_manage"]
        web-tools ["web_search" "web_extract"]
        channel-bundles ["hermes-telegram" "hermes-whatsapp" "hermes-slack"
                         "hermes-signal" "hermes-bluebubbles"
                         "hermes-homeassistant" "hermes-email" "hermes-sms"
                         "hermes-mattermost" "hermes-matrix" "hermes-dingtalk"
                         "hermes-wecom" "hermes-wecom-callback" "hermes-weixin" "hermes-qqbot"]]
    (merge
     {"terminal" ["terminal" "process_manage"]
      "file" file-tools "files" file-tools "web" web-tools "search" ["web_search"]
      "x_search" ["x_search"] "vision" ["vision_analyze"] "video" ["video_analyze"]
      "image_gen" ["image_generate"] "video_gen" ["video_generate" "xai_video_edit" "xai_video_extend"]
      "computer_use" ["computer_use"] "skills" skill-tools "browser" browser-tools
      "cronjob" ["cronjob_manage"] "tts" ["text_to_speech"] "todo" ["todo_list"]
      "memory" ["memory"] "session_search" ["session_search"] "connections" ["manage_connections"]
      "bot_room" [] "context_engine" []
      "project" ["desktop_project"] "desktop_ui" ["read_terminal" "close_terminal" "desktop_preview"
                                                    "drive_preview" "annotate_preview" "read_window_below"
                                                    "focus_pane" "react_to_message" "gui_tour" "show_tip"]
      "setup" ["manage_catalog"] "clarify" ["clarify"] "code_execution" ["execute_code"]
      "delegation" ["delegate_task"] "homeassistant" ["ha_list_entities" "ha_get_state" "ha_list_services" "ha_call_service"]
      "kanban" (filter #(str/starts-with? % "kanban_") hermes-core-tools)
      "debugging" ["terminal" "process_manage" "web_search" "web_extract" "read_file" "write_file" "patch" "search_files"]
      "safe" ["web_search" "web_extract" "vision_analyze" "image_generate"]
      "coding" (vec (remove #{"image_generate" "text_to_speech" "cronjob_manage" "computer_use"
                              "ha_list_entities" "ha_get_state" "ha_list_services" "ha_call_service"}
                            (remove #(str/starts-with? % "kanban_") hermes-core-tools)))
      "hermes-api-server" hermes-api-tools
      "hermes-cli" hermes-core-tools
      "hermes-cron" hermes-core-tools
      "hermes-acp" (vec (remove #{"clarify"} hermes-core-tools))
      "hermes-discord" (into hermes-core-tools ["discord" "discord_admin"])
      "hermes-feishu" (into hermes-core-tools ["feishu_doc_read" "feishu_drive_list_comments"
                                                "feishu_drive_list_comment_replies" "feishu_drive_reply_comment"
                                                "feishu_drive_add_comment"])
      "hermes-yuanbao" (into hermes-core-tools ["yb_query_group_info" "yb_query_group_members"
                                                 "yb_send_dm" "yb_search_sticker" "yb_send_sticker"])
      "hermes-webhook" ["web_search" "web_extract" "vision_analyze" "clarify"]
      "hermes-gateway" (into hermes-core-tools ["discord" "discord_admin" "feishu_doc_read"
                                                 "feishu_drive_list_comments" "feishu_drive_list_comment_replies"
                                                 "feishu_drive_reply_comment" "feishu_drive_add_comment"
                                                 "yb_query_group_info" "yb_query_group_members" "yb_send_dm"
                                                 "yb_search_sticker" "yb_send_sticker"])
      "discord" ["discord"] "discord_admin" ["discord_admin"]
      "yuanbao" ["yb_query_group_info" "yb_query_group_members" "yb_send_dm" "yb_search_sticker" "yb_send_sticker"]
      "feishu_doc" ["feishu_doc_read"]
      "feishu_drive" ["feishu_drive_list_comments" "feishu_drive_list_comment_replies"
                      "feishu_drive_reply_comment" "feishu_drive_add_comment"]
      "spotify" ["spotify_playback" "spotify_devices" "spotify_queue" "spotify_search"
                 "spotify_playlists" "spotify_albums" "spotify_library"]
      "no_mcp" []}
     (zipmap channel-bundles (repeat hermes-core-tools)))))

(defn tool-names
  "Resolve toolsets or direct tool names; run preflight rejects unknown
  toolsets. A name that is itself a tool is the tool: API-server `tool_names`
  pass explicit names and are never broadened into a toolset that happens to
  share the name (`terminal`)."
  [sets]
  (vec (distinct (mapcat #(cond
                            (contains? schemas %) [%]
                            (contains? toolsets %) (get toolsets %)
                            :else [])
                         sets))))

(defn unsupported-tools
  "Tool names this Kotoba agent cannot execute. Callers at compatibility
  boundaries should fail closed instead of silently dropping these tools."
  [names]
  (vec (distinct (remove (set (keys schemas)) names))))

(defn unsupported-toolsets
  "Toolset names neither implemented by Kotoba nor in Hermes' current catalog."
  ([sets] (unsupported-toolsets sets #{}))
  ([sets additional]
   (vec (distinct (remove #(or (contains? toolsets %) (contains? schemas %) (contains? additional %)
                               (and (string? %) (str/starts-with? % "mcp-")
                                    (contains? additional (subs % 4)))) sets)))))

(def approval-free-tools #{"read_file" "search_files" "web_search" "web_extract" "skills_list" "skill_view" "todo_list" "delegate_task"
                           "browser_snapshot" "browser_get_images"
                           "ha_list_entities" "ha_get_state" "ha_list_services"})

(defn approval-required?
  ([name] (approval-required? name nil))
  ([name args]
   (cond
     (= name "cronjob_manage") (not= "list" (get args "action"))
     (= name "computer_use") (not (contains? #{"capture" "list_apps" "list_windows" "wait"}
                                              (get args "action")))
     :else (not (contains? approval-free-tools name)))))

(defn enabled-tool-names
  "Requested toolsets minus the profile's `agent.disabled_toolsets` (Hermes
  config.yaml; Hermes subtracts them last, after every enable, and so do
  we). A toolset itonami-agent does not implement (browser, x_search) names
  no tools here and subtracts nothing."
  [requested disabled]
  (let [off (set (tool-names disabled))]
    (vec (remove off (tool-names requested)))))

(defn execution-disabled-toolsets [config platform]
  "Return Hermes' profile denylist plus platform-specific execution denies."
  (let [configured (get-in config ["agent" "disabled_toolsets"])
        configured (if (string? configured) [configured] configured)]
    (vec (distinct
          (concat (filter string? configured)
                  (when (= platform "cron")
                    (concat ["messaging" "clarify"]
                            (when-not (true? (get-in config ["cron" "allow_agent_scheduling"]))
                              ["cronjob"]))))))))

(defn runtime-tool-names
  "Resolve tools that Hermes would actually expose in this profile. Hermes gates
  browser_cdp and browser_dialog together on a configured CDP endpoint; neither
  belongs in the local browser surface when no endpoint is configured. Kotoba's
  local browser commands also require the agent-browser CLI on PATH."
  ;; only the explicit 5-arity: the 4-arity read the host PATH, which stays
  ;; host-side (the CLI passes its own availability in).
  ([requested disabled cdp-configured? browser-cli-available? computer-cli-available?]
   (let [names (enabled-tool-names requested disabled)]
     (vec (remove (fn [name]
                    (or (and (not cdp-configured?)
                             (contains? #{"browser_cdp" "browser_dialog"} name))
                        (and (not browser-cli-available?)
                             (some #{name} browser-tools))
                        (and (= name "computer_use") (not computer-cli-available?))))
                  names)))))

(defn tool-schemas [names] (vec (keep schemas names)))
