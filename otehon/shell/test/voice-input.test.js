import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createLocalDictation } from "../src/voice-input.js";

test("unsupported on-device recognition never opens the microphone", async () => {
  let calls = 0;
  let state;
  const voice = createLocalDictation({
    Recognition: class {},
    mediaDevices: { getUserMedia: () => { calls++; } },
    onText() {}, onLevel() {}, onState: (next) => { state = next; },
  });
  await voice.start();
  assert.equal(state, "unavailable");
  assert.equal(calls, 0);
});

test("local recognition writes text only to the callback and releases microphone", async () => {
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    let instance, stopped = 0, closed = 0, output = "", state;
    const track = { stop: () => { stopped++; } };
    class Recognition {
      static async available(options) {
        assert.deepEqual(options, { langs: ["ja-JP"], processLocally: true });
        return "available";
      }
      constructor() { instance = this; }
      start(input) { assert.equal(input, track); assert.equal(this.processLocally, true); }
      stop() {}
    }
    Recognition.prototype.processLocally = false;
    class AudioContext {
      createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (a) => a.fill(128) }; }
      createMediaStreamSource() { return { connect() {} }; }
      close() { closed++; return Promise.resolve(); }
    }
    const voice = createLocalDictation({
      Recognition, AudioContext,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
      onText: (text) => { output += text; }, onLevel() {}, onState: (next) => { state = next; },
    });
    await voice.start();
    assert.equal(state, "listening");
    instance.onresult({ resultIndex: 0, results: [{ 0: { transcript: "こんにちは" }, isFinal: true }] });
    assert.equal(output, "こんにちは");
    voice.stop();
    assert.equal(state, "idle");
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
  } finally {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("cancelling while microphone permission is pending releases a late stream", async () => {
  let resolvePermission, stopped = 0;
  class Recognition { static async available() { return "available"; } }
  Recognition.prototype.processLocally = false;
  const voice = createLocalDictation({
    Recognition, AudioContext: class {},
    mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) },
    onText() {}, onState() {}, onLevel() {},
  });
  const pending = voice.start();
  await Promise.resolve();
  voice.stop();
  resolvePermission({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await pending;
  assert.equal(stopped, 1);
});
