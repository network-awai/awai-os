import { test } from "node:test";
import assert from "node:assert/strict";
import { readProfileManifests } from "../src/profile-catalog.js";

const manifest = (name, content, size = content.length) => ({
  name, kind: "directory",
  getFileHandle: async file => { assert.equal(file, "itonami.edn"); return { getFile: async () => ({ size, text: async () => content }) }; },
});
const directory = rows => ({ name: "profiles", async *values() { yield* rows; } });
const forget = async () => undefined;

test("directory catalog reads only bounded immediate itonami manifests", async () => {
  let opened = 0;
  const root = directory([manifest("notes", "EDN"), manifest("big", "SECRET", 262145),
    { name: "../escape", kind: "directory", getFileHandle: () => { throw Error("must not read"); } },
    { name: ".env", kind: "file" },
    { name: "missing", kind: "directory", getFileHandle: async () => { throw Object.assign(Error(), { name: "NotFoundError" }); } }]);
  const result = await readProfileManifests({ remember: forget, picker: async options => { opened++; assert.equal(options.mode, "read"); return root; } });
  assert.deepEqual(result, [{ directory: "notes", text: "EDN" }]);
  assert.equal(opened, 1);
});

test("a chosen .itonami root opens only its profiles directory", async () => {
  const result = await readProfileManifests({ remember: forget, picker: async () => ({ name: ".itonami", getDirectoryHandle: async name => {
    assert.equal(name, "profiles"); return directory([manifest("notes", "EDN")]);
  } }) });
  assert.equal(result[0].directory, "notes");
});

test("remembered handle rechecks read permission; denial reads nothing", async () => {
  let reads = 0;
  const root = { ...directory([]), queryPermission: async () => "prompt", requestPermission: async () => "denied",
    values() { reads++; throw Error("must not read"); } };
  await assert.rejects(readProfileManifests({ remember: async () => root, picker: () => { throw Error("no silent reprompt"); } }), /permission-denied/);
  assert.equal(reads, 0);
  root.queryPermission = async () => "granted";
  delete root.values;
  root.values = directory([]).values;
  assert.deepEqual(await readProfileManifests({ remember: async () => root }), []);
});

test("cancelling and unreadable directories do not produce a partial catalog", async () => {
  await assert.rejects(readProfileManifests({ remember: forget, picker: async () => { throw Object.assign(Error("cancel"), { name: "AbortError" }); } }), /cancel/);
  const root = directory([{ name: "blocked", kind: "directory", getFileHandle: async () => { throw Error("unreadable"); } }]);
  await assert.rejects(readProfileManifests({ remember: forget, picker: async () => root }), /unreadable/);
});
