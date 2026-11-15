// AWAI-2962: local, original UI tones. No audio fetch, remote operation or
// autoplay override. The OS mixer remains the final volume/mute authority.
export const FEEL_KEY = "otehon.feel.v1";
export const DEFAULT_FEEL = Object.freeze({ sound: true, startup: true, reduceMotion: false });
let sessionFeel;
function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }

export function readFeel(storage) {
  if (storage === undefined && sessionFeel) return { ...sessionFeel };
  try {
    const value = JSON.parse((storage ?? browserStorage())?.getItem(FEEL_KEY));
    return Object.fromEntries(Object.entries(DEFAULT_FEEL).map(([key, fallback]) =>
      [key, typeof value?.[key] === "boolean" ? value[key] : fallback]));
  } catch { return { ...DEFAULT_FEEL }; }
}

export function saveFeel(value, storage) {
  const next = Object.fromEntries(Object.keys(DEFAULT_FEEL).map(key => [key, value[key]]));
  if (Object.values(next).some(v => typeof v !== "boolean")) return false;
  if (storage === undefined) sessionFeel = next;
  try {
    const target = storage ?? browserStorage();
    if (!target) return false;
    target.setItem(FEEL_KEY, JSON.stringify(next)); return true;
  }
  catch { return false; }
}

// One shared envelope, different original intervals; no sampled brand sounds.
export const TONES = Object.freeze({
  startup: [[523.25, 0, 0.16], [783.99, 0.09, 0.23]],
  select: [[659.25, 0, 0.035]],
  confirm: [[659.25, 0, 0.07], [987.77, 0.045, 0.10]],
  back: [[523.25, 0, 0.065], [392, 0.04, 0.09]],
});

export function createFeedback({
  storage,
  Context = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  now = () => performance.now(),
} = {}) {
  let context;
  let last = -Infinity;
  let disposed = false;
  const active = new Set();
  function silence() {
    for (const tone of active) { try { tone.stop(); } catch {} }
    active.clear();
  }
  return {
    silence,
    async play(kind, event) {
      const prefs = readFeel(storage);
      // A trusted click/key event, not a timer, synthetic event, or focus alone.
      if (disposed || !event?.isTrusted || !TONES[kind] || !prefs.sound ||
          (kind === "startup" && !prefs.startup) || !Context || now() - last < 70) return false;
      last = now();
      try {
        context ??= new Context();
        if (context.state === "suspended") await context.resume();
        const current = readFeel(storage);
        if (disposed || context.state !== "running" || !current.sound ||
            (kind === "startup" && !current.startup)) return false;
        silence();
        for (const [frequency, offset, duration] of TONES[kind]) {
          const tone = context.createOscillator();
          const envelope = context.createGain();
          const start = context.currentTime + offset;
          tone.type = "sine";
          tone.frequency.setValueAtTime(frequency, start);
          envelope.gain.setValueAtTime(0, start);
          envelope.gain.linearRampToValueAtTime(0.045, start + 0.008);
          envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          tone.connect(envelope); envelope.connect(context.destination);
          active.add(tone);
          tone.onended = () => { active.delete(tone); tone.disconnect(); envelope.disconnect(); };
          tone.start(start); tone.stop(start + duration + 0.01);
        }
        return true;
      } catch { return false; } // Audio availability never blocks navigation.
    },
    dispose() { disposed = true; silence(); context?.close().catch(() => {}); },
  };
}

// Only feedback: no interception, preventDefault, programmatic clicks or focus
// movement. In particular, this does not approve any external operation.
export function installFeedback(doc = document, host = window) {
  const audio = createFeedback();
  const apply = () => {
    doc.documentElement.dataset.reduceMotion = String(readFeel().reduceMotion);
    if (!readFeel().sound) audio.silence();
  };
  const click = event => {
    const button = event.target.closest?.("button");
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" ||
        button.closest("dialog") || !button.closest(".setup, .shell, .feel-settings")) return;
    audio.play(button.dataset.uiSound ?? (button.matches(".secondary") ? "back" : "confirm"), event);
  };
  const key = event => {
    if (event.key === "Tab" && !event.repeat &&
        event.target.closest?.(".setup, .shell, .feel-settings")) audio.play("select", event);
  };
  const storageChanged = event => {
    if (event.key === FEEL_KEY || event.key === null) { sessionFeel = undefined; apply(); }
  };
  apply();
  doc.addEventListener("click", click);
  doc.addEventListener("keydown", key);
  host.addEventListener("otehon-feel-change", apply);
  host.addEventListener("storage", storageChanged);
  return () => {
    doc.removeEventListener("click", click); doc.removeEventListener("keydown", key);
    host.removeEventListener("otehon-feel-change", apply); host.removeEventListener("storage", storageChanged);
    audio.dispose();
  };
}

export function updateFeel(value) {
  const saved = saveFeel(value);
  // Keep the current tab usable even if persistence is denied; tell the UI.
  window.dispatchEvent(new Event("otehon-feel-change"));
  return saved;
}
