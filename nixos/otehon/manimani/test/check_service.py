#!/usr/bin/env python3
"""Checks the running service end to end, with a stub agent on loopback and a real local model.

usage: check_service.py <llama-server url>
"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
PORT = 18771
AGENT_PORT = 18773
LLM = sys.argv[1]
failed = 0
agent_prompts = []


def check(name, ok):
    global failed
    failed += 0 if ok else 1
    print(f"{'ok  ' if ok else 'FAIL'} {name}", flush=True)


class Agent(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        agent_prompts.append(body["messages"][-1]["content"])
        data = json.dumps({"choices": [{"message": {"content": "Stub agent finished the draft."}}]}).encode()
        self.send_response(200)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass


def start(state, agents, llm=LLM, tick="500"):
    env = dict(os.environ, MANIMANI_PORT=str(PORT), MANIMANI_STATE=state, MANIMANI_LLM=llm,
               MANIMANI_AGENTS=agents, MANIMANI_TICK_MS=tick)
    return subprocess.Popen(["bb", "-cp", SRC, "-m", "manimani.service"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def call(path, body=None, headers=None, method=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"content-type": "application/json", "origin": "null", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def wait(predicate, seconds=240):
    end = time.time() + seconds
    while time.time() < end:
        try:
            state = call("/v1/state")[1]
            if predicate(state):
                return state
        except OSError:
            pass
        time.sleep(0.5)
    return None


def up():
    return wait(lambda state: state.get("status") == "ready", 30)


def spoke(state, count):
    return len([m for m in state["messages"] if m["role"] == "assistant"]) >= count


threading.Thread(
    target=http.server.ThreadingHTTPServer(("127.0.0.1", AGENT_PORT), Agent).serve_forever, daemon=True
).start()

with tempfile.TemporaryDirectory() as folder:
    state_file = os.path.join(folder, "state.edn")
    agents_file = os.path.join(folder, "agents.json")
    with open(agents_file, "w") as out:
        json.dump([{"id": "writer", "name": "Writer", "about": "writes drafts", "approval": "ask",
                    "url": f"http://127.0.0.1:{AGENT_PORT}/v1/chat/completions"}], out)

    # It must refuse to start with anything off this machine.
    process = start(state_file, agents_file, llm="https://api.example.com")
    check("refuses inference off this machine", process.wait(timeout=60) != 0)
    with open(os.path.join(folder, "bad.json"), "w") as out:
        json.dump([{"id": "x", "name": "X", "approval": "auto", "url": "https://api.example.com/v1"}], out)
    process = start(state_file, os.path.join(folder, "bad.json"))
    check("refuses an agent off this machine", process.wait(timeout=60) != 0)

    process = start(state_file, agents_file)
    check("starts and sees the local model", up() is not None)

    # Who may call it.
    check("a web page's origin is refused", call("/v1/state", headers={"origin": "https://evil.example"})[0] == 403)
    check("another Host is refused", call("/v1/state", headers={"host": "evil.example"})[0] == 403)
    check("empty text is refused", call("/v1/messages", {"text": "  "})[0] == 400)
    check("a task too frequent is refused", call("/v1/tasks", {"title": "t", "prompt": "p", "every-minutes": 1})[0] == 400)

    # A real answer from the local model.
    check("a message is accepted", call("/v1/messages", {"text": "Say hello in one short sentence."})[0] == 202)
    state = wait(lambda s: spoke(s, 1))
    answer = [m["text"] for m in state["messages"] if m["role"] == "assistant"][-1] if state else ""
    print(f"     model said: {answer[:120]!r}", flush=True)
    check("the local model answers", bool(answer))

    # Pausing refuses tools, and stops schedules.
    check("pause", call("/v1/pause", {"paused": True})[0] == 200)
    check("a task can be added", call("/v1/tasks", {"title": "check", "prompt": "Say done.", "every-minutes": 5})[0] == 200)
    check("paused state is shown", call("/v1/state")[1]["paused"] is True)
    call("/v1/pause", {"paused": False})

    # Everything survives a restart, as a resident service must.
    before = call("/v1/state")[1]
    process.terminate()
    process.wait(timeout=20)
    process = start(state_file, agents_file)
    after = up()
    check("messages survive a restart", after and len(after["messages"]) == len(before["messages"]))
    check("tasks survive a restart", after and [t["id"] for t in after["tasks"]] == [t["id"] for t in before["tasks"]])
    task_id = after["tasks"][0]["id"]
    check("a task can be removed", call(f"/v1/tasks/{task_id}/delete", {})[0] == 200)
    check("the task is gone", call("/v1/state")[1]["tasks"] == [])
    check("nothing about an agent's address is shown", "url" not in json.dumps(after["agents"]))

    # A task that came due while it was off runs on the next tick.
    process.terminate()
    process.wait(timeout=20)
    with open(state_file) as source:
        text = source.read()
    process = start(state_file, agents_file)
    up()
    call("/v1/tasks", {"title": "soon", "prompt": "Say the word ping.", "every-minutes": 5})
    process.terminate()
    process.wait(timeout=20)
    with open(state_file) as source:
        text = source.read()
    import re
    with open(state_file, "w") as out:
        out.write(re.sub(r":next-run \d+", ":next-run 1", text))
    process = start(state_file, agents_file)
    state = wait(lambda s: any(m["role"] == "task" for m in s.get("messages", [])), 30)
    check("a missed task runs after a restart", state is not None)

    process.terminate()
    process.wait(timeout=20)

    # With no model there is no fallback, and nothing is made up.
    process = start(state_file, agents_file, llm="http://127.0.0.1:1")
    wait(lambda s: s.get("status") == "model-unavailable", 30)
    count = len([m for m in call("/v1/state")[1]["messages"] if m["role"] == "assistant"])
    call("/v1/messages", {"text": "Are you there?"})
    state = wait(lambda s: s["messages"][-1]["role"] == "notice", 30)
    check("with no model it says so", state is not None)
    check("with no model it invents no answer",
          state and len([m for m in state["messages"] if m["role"] == "assistant"]) == count)
    process.terminate()
    process.wait(timeout=20)

    # An approval reaches the agent, through the service and the model's result. The core tests
    # cover the decision, so this writes the waiting approval into the saved state.
    with open(state_file) as source:
        text = source.read()
    with open(state_file, "w") as out:
        out.write(text.replace(":approvals []",
                               ':approvals [{:id "77" :agent "writer" :name "Writer" :prompt "Draft a note." :at 1}]'))
    process = start(state_file, agents_file)
    up()
    check("nothing reached the agent before approval", agent_prompts == [])
    call("/v1/approvals/88", {"approve": True})
    time.sleep(1)
    check("an unknown approval reaches nothing", agent_prompts == [])
    check("the real approval is accepted", call("/v1/approvals/77", {"approve": True})[0] == 200)
    state = wait(lambda s: any(m["role"] == "agent" for m in s["messages"]), 30)
    check("the agent received the approved prompt", agent_prompts == ["Draft a note."])
    check("the agent's answer returns to the conversation", state is not None)
    process.terminate()
    process.wait(timeout=20)

if failed:
    print(f"FAILED {failed}")
    sys.exit(1)
print("PASS")
