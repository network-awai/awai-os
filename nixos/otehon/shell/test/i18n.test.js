import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { DAPP_TEXT_JA, TEXT, translate } from "../src/i18n.js";

const catalog = JSON.parse(readFileSync(new URL("../src/dapps.json", import.meta.url)));
const src = new URL("../src/", import.meta.url);

test("English and Japanese have the same keys", () => {
  assert.deepEqual(Object.keys(TEXT.ja).sort(), Object.keys(TEXT.en).sort());
});

test("every Japanese text differs from the English one, unless it is a name", () => {
  const same = Object.keys(TEXT.en).filter((key) => TEXT.en[key] === TEXT.ja[key]);
  assert.deepEqual(same, ["settei.network", "browser.title"]);
});

test("placeholders match between languages", () => {
  const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(TEXT.en)) assert.deepEqual(names(TEXT.ja[key]), names(TEXT.en[key]), key);
});

test("every key the screens use exists", () => {
  const used = new Set();
  for (const file of readdirSync(src).filter((name) => name.endsWith(".jsx"))) {
    for (const match of readFileSync(new URL(file, src), "utf8").matchAll(/\bt\("([\w.]+)"/g)) used.add(match[1]);
  }
  assert.ok(used.size > 50, `only ${used.size} keys found, so the scan is not reading the screens`);
  const missing = [...used].filter((key) => !(key in TEXT.en));
  assert.deepEqual(missing, []);
});

test("every dapp summary and network service has Japanese text", () => {
  for (const dapp of catalog.dapps) {
    assert.ok(DAPP_TEXT_JA.summary[dapp.id], dapp.id);
    for (const operation of dapp.remoteOperations) assert.ok(DAPP_TEXT_JA.service[operation.service], operation.service);
  }
});

test("translate fills placeholders and refuses unknown keys", () => {
  assert.equal(translate("ja", "composer.message", { name: "Aozora" }), "Aozora にメッセージ");
  assert.throws(() => translate("ja", "no.such.key"), /missing text/);
});
