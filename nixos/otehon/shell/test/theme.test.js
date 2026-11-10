import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readTheme, saveTheme, THEME_KEY } from "../src/theme.js";

test("each selected theme survives a new read, invalid values are ignored", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readTheme(storage), "Yoru");
  for (const name of ["Asa", "Hiru", "Yoru"]) {
    assert.equal(saveTheme(storage, name), true);
    assert.equal(readTheme(storage), name);
  }
  assert.equal(saveTheme(storage, "invalid"), false);
  assert.equal(values.get(THEME_KEY), "Yoru");
  values.set(THEME_KEY, "invalid");
  assert.equal(readTheme(storage), "Yoru");
});

test("storage denial leaves the interface usable", () => {
  const denied = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  assert.equal(readTheme(denied), "Yoru");
  assert.equal(saveTheme(denied, "Asa"), false);
});
