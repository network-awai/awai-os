import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createFeedback, DEFAULT_FEEL, FEEL_KEY, readFeel, saveFeel } from "../src/feel.js";

function store(value = DEFAULT_FEEL) {
  let saved = JSON.stringify(value);
  return { getItem: () => saved, setItem: (key, v) => { assert.equal(key, FEEL_KEY); saved = v; } };
}
function fixture({ resumeFails = false, deferred = false } = {}) {
  const calls = [];
  let resume;
  const storage = store();
  class Context {
    state = "suspended"; currentTime = 1; destination = {};
    async resume() {
      if (resumeFails) throw Error("no-output");
      if (deferred) await new Promise(resolve => { resume = resolve; });
      this.state = "running";
    }
    createOscillator() {
      return { frequency: { setValueAtTime: f => calls.push(["frequency", f]) },
        connect() {}, disconnect() {}, start: () => calls.push(["start"]), stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {} };
    }
    async close() { calls.push(["close"]); }
  }
  return { calls, storage, finishResume: () => resume(), audio: createFeedback({ storage, Context, now: () => 100 }) };
}
test("bad preference data and denied storage never break startup", () => {
  assert.deepEqual(readFeel(store({ sound: "yes", startup: false })), { ...DEFAULT_FEEL, startup: false });
  const denied = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  assert.deepEqual(readFeel(denied), DEFAULT_FEEL);
  assert.equal(saveFeel(DEFAULT_FEEL, denied), false);
  assert.equal(saveFeel({ ...DEFAULT_FEEL, sound: "yes" }, store()), false);
});
test("saved mute/startup preferences survive a new read", () => {
  const storage = store();
  assert.equal(saveFeel({ ...DEFAULT_FEEL, sound: false, startup: false }, storage), true);
  assert.equal(readFeel(storage).sound, false);
  assert.equal(readFeel(storage).startup, false);
});
test("synthetic events and unknown tones cannot start audio", async () => {
  const { audio, calls } = fixture();
  assert.equal(await audio.play("startup", { isTrusted: false }), false);
  assert.equal(await audio.play("unknown", { isTrusted: true }), false);
  assert.equal(calls.length, 0);
});
test("trusted start plays the two original intervals, repeat is bounded", async () => {
  const { audio, calls } = fixture();
  assert.equal(await audio.play("startup", { isTrusted: true }), true);
  assert.deepEqual(calls.filter(c => c[0] === "frequency"), [["frequency", 523.25], ["frequency", 783.99]]);
  assert.equal(await audio.play("confirm", { isTrusted: true }), false);
  audio.dispose();
  assert.equal(await audio.play("startup", { isTrusted: true }), false);
});
test("audio resume failure leaves the caller free to navigate", async () => {
  const { audio, calls } = fixture({ resumeFails: true });
  assert.equal(await audio.play("startup", { isTrusted: true }), false);
  assert.equal(calls.length, 0);
});
test("muting while resume is pending prevents every oscillator", async () => {
  const { audio, calls, storage, finishResume } = fixture({ deferred: true });
  const playback = audio.play("startup", { isTrusted: true });
  saveFeel({ ...DEFAULT_FEEL, sound: false }, storage);
  finishResume();
  assert.equal(await playback, false);
  assert.equal(calls.length, 0);
});
test("disposal while resume is pending prevents late sound", async () => {
  const { audio, calls, finishResume } = fixture({ deferred: true });
  const playback = audio.play("startup", { isTrusted: true });
  audio.dispose(); finishResume();
  assert.equal(await playback, false);
  assert.equal(calls.some(c => c[0] === "start"), false);
});
