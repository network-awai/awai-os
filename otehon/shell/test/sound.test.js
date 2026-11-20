import assert from "node:assert/strict";
import { test } from "node:test";
import { muteError, volumeError } from "../src/sound.js";

test("volumes stay inside 0 to 100 integers", () => {
  assert.equal(volumeError(0), null);
  assert.equal(volumeError(55), null);
  assert.equal(volumeError(100), null);
  assert.equal(volumeError(-1), "bad-volume");
  assert.equal(volumeError(101), "bad-volume");
  assert.equal(volumeError(55.5), "bad-volume");
  assert.equal(volumeError("55"), "bad-volume");
  assert.equal(volumeError(true), "bad-volume");
  assert.equal(volumeError(null), "bad-volume");
});

test("mute takes only booleans", () => {
  assert.equal(muteError(true), null);
  assert.equal(muteError(false), null);
  assert.equal(muteError(1), "bad-mute");
  assert.equal(muteError("off"), "bad-mute");
  assert.equal(muteError(null), "bad-mute");
});
