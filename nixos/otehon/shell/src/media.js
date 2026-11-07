// Speech and images generated on this device by the local service in media.nix.
// Nothing goes through the shared broker, because nothing leaves the machine.
import { useEffect, useState } from "react";

export const MEDIA_ORIGIN = "http://127.0.0.1:8770";
const POLL_MS = 5000;
const NONE = { speech: [], image: false };

const post = (path, body) =>
  fetch(`${MEDIA_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function useMediaCapabilities() {
  const [capabilities, setCapabilities] = useState(NONE);
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch(`${MEDIA_ORIGIN}/v1/capabilities`)
        .then((response) => response.json())
        .then((value) => live && setCapabilities(value))
        .catch(() => live && setCapabilities(NONE));
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return capabilities;
}

// Threads hold plain strings and generated items.
export function describeMessage(item) {
  if (typeof item === "string") return { kind: "text", text: item };
  return item;
}

// Nothing watches an item saved while working after a reload, so it reads as interrupted.
export function settleSavedItem(item) {
  return item?.state === "working" ? { ...item, state: "failed", reason: "interrupted" } : item;
}

// Kana and kanji pick the Japanese voice.
export function voiceFor(text) {
  return /[぀-ヿ㐀-鿿]/.test(text) ? "ja" : "en";
}

const newId = () => crypto.randomUUID();

export async function requestSpeech(text, context, add, update) {
  const id = newId();
  add(context, { id, kind: "speech", state: "working", text });
  try {
    const response = await post("/v1/audio/speech", { input: text, voice: voiceFor(text) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    update(context, id, { state: "done", url: body.url, seconds: body.seconds });
  } catch (error) {
    update(context, id, { state: "failed", reason: error.message === "unknown-voice" ? "no voice for this language" : error.message });
  }
}

export async function requestImage(text, context, add, update) {
  const id = newId();
  add(context, { id, kind: "image", state: "working", text });
  try {
    const started = await post("/v1/images/generations", { prompt: text });
    const body = await started.json();
    if (!started.ok) throw new Error(body.error);
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const job = await (await fetch(`${MEDIA_ORIGIN}/v1/jobs/${body.job}`)).json();
      if (job.state === "done") {
        update(context, id, { state: "done", url: job.url, seconds: job.seconds });
        return;
      }
      if (job.state === "failed") throw new Error(job.reason);
    }
  } catch (error) {
    update(context, id, { state: "failed", reason: error.message });
  }
}
