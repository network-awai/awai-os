import { test } from "node:test";
import assert from "node:assert/strict";
import { installedApps, setAppInstalled } from "../src/apps.js";

function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test("bundled app install and removal persist per account", () => {
  const s = storage();
  assert.deepEqual(installedApps("did:test:a", s), ["tokei"]);
  assert.equal(setAppInstalled("did:test:a", "tokei", true, s), true);
  assert.deepEqual(installedApps("did:test:a", s), ["tokei"]);
  assert.deepEqual(installedApps("did:test:b", s), ["tokei"]);
  assert.equal(setAppInstalled("did:test:a", "tokei", false, s), true);
  assert.deepEqual(installedApps("did:test:a", s), []);
});
test("unknown entries and failed storage cannot pretend to install", () => {
  const s = storage();
  assert.equal(setAppInstalled("did:test:a", "external", true, s), false);
  assert.equal(setAppInstalled("bad", "tokei", true, s), false);
  assert.equal(setAppInstalled("did:test:a", "tokei", true, { getItem() { return null; }, setItem() { throw Error(); } }), false);
  s.setItem("otehon.installed-apps.v1:did:test:a", JSON.stringify(["external", "tokei", "tokei"]));
  assert.deepEqual(installedApps("did:test:a", s), ["tokei"]);
});
