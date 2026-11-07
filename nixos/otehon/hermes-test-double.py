"""TEST DOUBLE for the model behind Hermes. Check images only. It is not inference.

It answers from a script, so a check can make Hermes face a tool call that a real model might
not emit: a terminal call that must be refused, and a Saifu call that must work. It records
each request, because what Hermes offers the model is what the agent is allowed to do.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ["OTEHON_DOUBLE_PORT"])
LOG = "/run/otehon-model-double/requests.jsonl"
NAME = "test-double"
SCRIPTED_CALLS = {
    "DOUBLE_CALL_SAIFU": ("mcp__saifu__saifu_format_wei", {"wei": "1500000000000000000"}),
    "DOUBLE_CALL_TERMINAL": ("terminal", {"command": "touch /var/lib/otehon-hermes/TERMINAL_RAN"}),
}


def text_of(message):
    content = message.get("content")
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content or ""


def reply_for(messages):
    """Returns (text, tool_call)."""
    last = messages[-1]
    if last.get("role") == "tool":
        return f"TEST DOUBLE TOOL RESULT: {text_of(last)}", None
    said = text_of(last)
    for trigger, call in SCRIPTED_CALLS.items():
        if trigger in said:
            return None, call
    return f"TEST DOUBLE ANSWER to: {said}", None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_json(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json({"status": "ok", "test_double": True})
        elif self.path == "/props":
            self.send_json({"default_generation_settings": {"n_ctx": 64000}, "test_double": True})
        elif self.path in ("/v1/models", "/models"):
            self.send_json({"object": "list", "data": [{"id": NAME, "object": "model", "context_length": 64000}]})
        else:
            self.send_error(404)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
        messages = request.get("messages", [])
        tools = [tool["function"]["name"] for tool in request.get("tools") or []]
        with open(LOG, "a") as log:
            log.write(json.dumps({
                "tools": tools,
                "system": "\n".join(text_of(m) for m in messages if m.get("role") == "system"),
                "last_role": messages[-1].get("role") if messages else None,
                "last": text_of(messages[-1]) if messages else "",
            }) + "\n")
        text, call = reply_for(messages)
        delta = {"role": "assistant"}
        if call:
            delta["tool_calls"] = [{
                "index": 0, "id": "call_double_1", "type": "function",
                "function": {"name": call[0], "arguments": json.dumps(call[1])},
            }]
        else:
            delta["content"] = text
        finish = "tool_calls" if call else "stop"
        if request.get("stream"):
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("connection", "close")
            self.end_headers()
            for choice in ({"index": 0, "delta": delta, "finish_reason": None},
                           {"index": 0, "delta": {}, "finish_reason": finish}):
                frame = {"id": "double", "object": "chat.completion.chunk", "model": NAME, "choices": [choice]}
                self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.close_connection = True
            return
        message = {key: value for key, value in delta.items()}
        for tool_call in message.get("tool_calls", []):
            tool_call.pop("index")
        self.send_json({"id": "double", "object": "chat.completion", "model": NAME, "choices": [
            {"index": 0, "message": message, "finish_reason": finish}]})


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
