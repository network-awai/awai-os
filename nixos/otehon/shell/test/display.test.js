import assert from "node:assert/strict";
import { test } from "node:test";
import { brightnessError } from "../src/display.js";

test("brightness stays inside 0 to 100 integers", () => {
  assert.equal(brightnessError(0), null);
  assert.equal(brightnessError(80), null);
  assert.equal(brightnessError(100), null);
  assert.equal(brightnessError(-1), "bad-brightness");
  assert.equal(brightnessError(101), "bad-brightness");
  assert.equal(brightnessError(55.5), "bad-brightness");
  assert.equal(brightnessError("80"), "bad-brightness");
  assert.equal(brightnessError(true), "bad-brightness");
  assert.equal(brightnessError(null), "bad-brightness");
});
