import test from "node:test";
import assert from "node:assert/strict";
import { allowsContent, displayMessage, readAgeBand, saveAgeBand } from "../src/age.js";

function memoryStore() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("declaration is scoped to the verified account and survives reload", () => {
  const store = memoryStore();
  assert.equal(readAgeBand("did:key:one", store), null);
  assert.equal(saveAgeBand("did:key:one", "13-17", store), true);
  assert.equal(readAgeBand("did:key:one", store), "13-17");
  assert.equal(readAgeBand("did:key:two", store), null);
  assert.equal(saveAgeBand("did:key:two", "18-plus", store), true);
  assert.equal(readAgeBand("did:key:one", store), "13-17");
  assert.equal(readAgeBand("did:key:two", store), "18-plus");
});

test("invalid values and storage failures do not unlock a declaration", () => {
  const store = memoryStore();
  assert.equal(saveAgeBand("did:key:one", "adult", store), false);
  assert.equal(saveAgeBand("", "18-plus", store), false);
  store.setItem("otehon.age.v1:did:key:one", "forged");
  assert.equal(readAgeBand("did:key:one", store), null);
  const broken = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  assert.equal(saveAgeBand("did:key:one", "18-plus", broken), false);
  assert.equal(readAgeBand("did:key:one", broken), null);
});

test("content ratings apply age limits and unknown values fail closed", () => {
  for (const [band, expected] of [
    ["under-13", [true, false, false]],
    ["13-17", [true, true, false]],
    ["18-plus", [true, true, true]],
  ]) assert.deepEqual(["general", "teen", "adult"].map((rating) => allowsContent(band, rating)), expected);
  assert.equal(allowsContent(null, "general"), false);
  assert.equal(allowsContent("18-plus", "unknown"), false);
  assert.equal(allowsContent("toString", "adult"), false);
  assert.equal(displayMessage({ text: "restricted", rating: "adult" }, "13-17"), null);
  assert.equal(displayMessage({ text: "unknown" }, "18-plus"), null);
  assert.equal(displayMessage({ text: "allowed", rating: "teen" }, "13-17"), "allowed");
  assert.equal(displayMessage("my own draft", "under-13"), "my own draft");
});
