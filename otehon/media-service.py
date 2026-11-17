#!/usr/bin/env python3
"""Local speech and image generation for the Awai Otehon shell.

Listens on loopback only. systemd also denies it any other network address, so prompts
cannot leave the machine. Each request starts a CLI with fixed arguments and no shell.
"""
import json
import os
import re
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ["OTEHON_MEDIA_PORT"])
OUT = Path(os.environ["OTEHON_MEDIA_DIR"])
PIPER = os.environ["OTEHON_PIPER"]
SD = os.environ["OTEHON_SD"]
VOICES = json.loads(os.environ["OTEHON_VOICES"])
MODELS = Path(os.environ["OTEHON_MODELS"])
QWEN = MODELS / "qwen-image-Q2_K.gguf"
ENCODER = MODELS / "qwen25-vl-Q2_K.gguf"
VAE = MODELS / "qwen-vae.safetensors"
# A file:// page sends the origin "null". No other page may use this service.
ALLOWED_ORIGINS = {"null"}
MAX_TEXT = 2000
# Only 256 gives a clean picture on the checked weights: 384 gave noise, and exited 0.
SIZES = {256}
MAX_STEPS = 20
SPEECH_TIMEOUT = 120
IMAGE_TIMEOUT = 4 * 60 * 60
ID = re.compile(r"^[0-9a-f]{32}\.(wav|png)$")

jobs = {}
jobs_lock = threading.Lock()
# Image generation uses nearly all memory, so only one runs at a time.
image_slot = threading.Lock()


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def image_ready():
    return all(path.is_file() for path in (QWEN, ENCODER, VAE))


def clean_text(value):
    if not isinstance(value, str) or not value.strip():
        raise Refused(400, "empty-text")
    if len(value) > MAX_TEXT:
        raise Refused(413, "text-too-long")
    return value.strip()


def speak(body):
    text = clean_text(body.get("input"))
    voice = body.get("voice")
    if voice not in VOICES:
        raise Refused(400, "unknown-voice")
    name = f"{uuid.uuid4().hex}.wav"
    started = time.monotonic()
    try:
        run = subprocess.run(
            [PIPER, "-m", VOICES[voice], "-f", str(OUT / name)],
            input=text.encode(),
            capture_output=True,
            timeout=SPEECH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise Refused(504, "speech-timeout")
    if run.returncode != 0 or not (OUT / name).is_file():
        raise Refused(500, f"speech-failed: {run.stderr.decode(errors='replace')[-300:]}")
    return {"url": f"/files/{name}", "seconds": round(time.monotonic() - started, 2)}


def draw(job, prompt, size, steps, seed):
    name = f"{uuid.uuid4().hex}.png"
    started = time.monotonic()
    with image_slot:
        jobs[job]["state"] = "running"
        try:
            run = subprocess.run(
                [
                    SD,
                    "--diffusion-model", str(QWEN),
                    "--vae", str(VAE),
                    "--llm", str(ENCODER),
                    "-p", prompt,
                    "--cfg-scale", "2.5",
                    "--sampling-method", "euler",
                    "--flow-shift", "3",
                    "--steps", str(steps),
                    "--seed", str(seed),
                    "-W", str(size),
                    "-H", str(size),
                    "-o", str(OUT / name),
                ],
                capture_output=True,
                timeout=IMAGE_TIMEOUT,
            )
            ok = run.returncode == 0 and (OUT / name).is_file()
            detail = "" if ok else run.stderr.decode(errors="replace")[-300:]
        except subprocess.TimeoutExpired:
            ok, detail = False, "image-timeout"
    seconds = round(time.monotonic() - started, 1)
    with jobs_lock:
        if ok:
            jobs[job].update(state="done", url=f"/files/{name}", seconds=seconds)
        else:
            jobs[job].update(state="failed", reason=detail, seconds=seconds)
    print(f"image job {job}: {jobs[job]['state']} in {seconds}s", flush=True)


def start_image(body):
    if not image_ready():
        raise Refused(503, "image-model-missing")
    prompt = clean_text(body.get("prompt"))
    size = body.get("size", 256)
    steps = body.get("steps", 8)
    seed = body.get("seed", 42)
    if size not in SIZES:
        raise Refused(400, "bad-size")
    if not isinstance(steps, int) or isinstance(steps, bool) or not 1 <= steps <= MAX_STEPS:
        raise Refused(400, "bad-steps")
    if not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed < 2**31:
        raise Refused(400, "bad-seed")
    job = uuid.uuid4().hex
    with jobs_lock:
        jobs[job] = {"state": "queued", "size": size, "steps": steps}
    threading.Thread(target=draw, args=(job, prompt, size, steps, seed), daemon=True).start()
    return {"job": job}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def cors(self):
        if self.headers.get("Origin") in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", "null")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def allowed(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        # The Host check stops a web page from reaching this port through DNS rebinding.
        if host != f"127.0.0.1:{PORT}":
            self.refuse_and_close("bad-host")
            return False
        if origin is not None and origin not in ALLOWED_ORIGINS:
            self.refuse_and_close("bad-origin")
            return False
        return True

    def refuse_and_close(self, reason):
        # The body is unread, so it must not be taken for the next request on this connection.
        self.close_connection = True
        self.reply(403, {"error": reason})

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get("Origin") in ALLOWED_ORIGINS else 403)
        self.send_header("Content-Length", "0")
        self.cors()
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == "/v1/capabilities":
            self.reply(200, {"speech": sorted(VOICES), "image": image_ready()})
        elif self.path.startswith("/v1/jobs/"):
            job = jobs.get(self.path.rsplit("/", 1)[-1])
            self.reply(200, job) if job else self.reply(404, {"error": "unknown-job"})
        elif self.path.startswith("/files/"):
            self.send_file(self.path.rsplit("/", 1)[-1])
        else:
            self.reply(404, {"error": "not-found"})

    def send_file(self, name):
        if not ID.match(name) or not (OUT / name).is_file():
            self.reply(404, {"error": "not-found"})
            return
        data = (OUT / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav" if name.endswith(".wav") else "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.allowed():
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_TEXT * 8:
            self.send_response(413)
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise Refused(400, "bad-json")
            if self.path == "/v1/audio/speech":
                self.reply(200, speak(body))
            elif self.path == "/v1/images/generations":
                self.reply(202, start_image(body))
            else:
                self.reply(404, {"error": "not-found"})
        except json.JSONDecodeError:
            self.reply(400, {"error": "bad-json"})
        except Refused as refused:
            self.reply(refused.status, {"error": refused.reason})

    def log_message(self, format, *args):
        # Prompts and paths stay out of the journal.
        pass


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
