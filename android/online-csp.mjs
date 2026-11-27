// Build-time only: enforce OnlinePins.java / HostActivity.java parity (AWAI-3729),
// then use the same pinned canonical validator and online declaration as the client.
import {readFileSync, realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const MAX_PIN_APPS = 64;
const MAX_PIN_BYTES = 32768;
const MAX_CATALOG_BYTES = 131072;
const MAX_APK_BYTES = 64 * 1024 * 1024;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const DISTRIBUTION_PREFIX = 'https://raw.githubusercontent.com/network-awai/awai-os/';
const CATALOG_APP_RE = /^network\.itonami\.[a-z][a-z0-9]{1,62}$/;
const SAFE_REL_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const NON_INT_NUMBER = Symbol('non-int-number');
const INT64_NUMBER = Symbol('int64-number');

function loadCatalogOnlineIds() {
  const src = readFileSync(new URL('./shared/src/network/awai/platform/Catalog.java', import.meta.url), 'utf8');
  const m = src.match(/public static String onlineFileFor\(String id\)[\s\S]*?^\s*\}/m);
  if (!m) throw Error('online-pins: unable to read Catalog.onlineFileFor');
  const body = m[0];
  const ids = new Set();
  for (const match of body.matchAll(/"((?:network|app)\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)"/g)) {
    ids.add(match[1]);
  }
  if (body.includes('REGISTRY_ASSOC')) ids.add('network.itonami.registry.assoc');
  return ids;
}

/**
 * Minimal strict RFC 8259 JSON parser aligned with OnlinePins.java and android/build.py:
 * inside the strict pins subtree, enforces exact signed int64 bounds via BigInt, finite doubles,
 * exact integer vs decimal/exponent tokens, no duplicate keys, no lone UTF-16 surrogates, and
 * max container nesting depth 16.
 */
export function parseStrictJson(text, {strictRoot = false, strictKey = null} = {}) {
  let pos = 0;
  const len = text.length;
  function skipWs() {
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a) pos++;
      else break;
    }
  }
  function parseValue(depth, strict) {
    skipWs();
    if (pos >= len) throw Error('pins-json: unexpected end');
    const c = text[pos];
    if (c === '{') return parseObject(depth + 1, strict);
    if (c === '[') return parseArray(depth + 1, strict);
    if (c === '"') return parseString(strict);
    if (c === 't') { expect('true'); return true; }
    if (c === 'f') { expect('false'); return false; }
    if (c === 'n') { expect('null'); return null; }
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber(strict);
    throw Error('pins-json: unexpected token');
  }
  function parseObject(depth, strict) {
    if (strict && depth > 16) throw Error('pins-json: nesting depth exceeded');
    if (depth > 64) throw Error('json: nesting depth exceeded');
    pos++; // '{'
    skipWs();
    const obj = Object.create(null);
    if (pos < len && text[pos] === '}') { pos++; return obj; }
    while (true) {
      skipWs();
      if (pos >= len || text[pos] !== '"') throw Error('pins-json: expected key');
      const key = parseString(strict);
      if (strict && Object.hasOwn(obj, key)) throw Error('pins-duplicate-key');
      skipWs();
      if (pos >= len || text[pos] !== ':') throw Error('pins-json: expected colon');
      pos++;
      const childStrict = strict || (depth === 1 && strictKey !== null && key === strictKey);
      const childDepth = !strict && childStrict ? 0 : depth;
      obj[key] = parseValue(childDepth, childStrict);
      skipWs();
      if (pos >= len) throw Error('pins-json: unterminated object');
      const sep = text[pos++];
      if (sep === '}') return obj;
      if (sep !== ',') throw Error('pins-json: expected comma');
    }
  }
  function parseArray(depth, strict) {
    if (strict && depth > 16) throw Error('pins-json: nesting depth exceeded');
    if (depth > 64) throw Error('json: nesting depth exceeded');
    pos++; // '['
    skipWs();
    const arr = [];
    if (pos < len && text[pos] === ']') { pos++; return arr; }
    while (true) {
      arr.push(parseValue(depth, strict));
      skipWs();
      if (pos >= len) throw Error('pins-json: unterminated array');
      const sep = text[pos++];
      if (sep === ']') return arr;
      if (sep !== ',') throw Error('pins-json: expected comma');
    }
  }
  function readUnicodeEscape() {
    const hex = text.slice(pos, pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw Error('pins-json: bad unicode escape');
    pos += 4;
    return parseInt(hex, 16);
  }
  function parseString(strict) {
    pos++; // '"'
    let out = '';
    while (pos < len) {
      const ch = text[pos++];
      if (ch === '"') return out;
      const code = ch.charCodeAt(0);
      if (code < 0x20) throw Error('pins-json: control char');
      if (ch === '\\') {
        if (pos >= len) throw Error('pins-json: unterminated escape');
        const esc = text[pos++];
        if (esc === '"' || esc === '\\' || esc === '/') out += esc;
        else if (esc === 'b') out += '\b';
        else if (esc === 'f') out += '\f';
        else if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          const u = readUnicodeEscape();
          if (strict && u >= 0xd800 && u <= 0xdbff) {
            if (text[pos] !== '\\' || text[pos + 1] !== 'u') throw Error('pins-json: lone surrogate');
            pos += 2;
            const low = readUnicodeEscape();
            if (low < 0xdc00 || low > 0xdfff) throw Error('pins-json: lone surrogate');
            out += String.fromCharCode(u, low);
          } else if (strict && u >= 0xdc00 && u <= 0xdfff) {
            throw Error('pins-json: lone surrogate');
          } else {
            out += String.fromCharCode(u);
          }
        } else throw Error('pins-json: bad escape');
      } else if (strict && code >= 0xd800 && code <= 0xdbff) {
        const next = pos < len ? text.charCodeAt(pos) : -1;
        if (next < 0xdc00 || next > 0xdfff) throw Error('pins-json: lone surrogate');
        out += ch + text[pos++];
      } else if (strict && code >= 0xdc00 && code <= 0xdfff) {
        throw Error('pins-json: lone surrogate');
      } else out += ch;
    }
    throw Error('pins-json: unterminated string');
  }
  function parseNumber(strict) {
    const start = pos;
    if (text[pos] === '-') pos++;
    if (pos >= len) throw Error('pins-json: bad number');
    if (text[pos] === '0') pos++;
    else if (text[pos] >= '1' && text[pos] <= '9') {
      while (pos < len && text[pos] >= '0' && text[pos] <= '9') pos++;
    } else throw Error('pins-json: bad number');
    let decimal = false;
    if (pos < len && text[pos] === '.') {
      decimal = true;
      pos++;
      const fracStart = pos;
      while (pos < len && text[pos] >= '0' && text[pos] <= '9') pos++;
      if (pos === fracStart) throw Error('pins-json: bad fraction');
    }
    if (pos < len && (text[pos] === 'e' || text[pos] === 'E')) {
      decimal = true;
      pos++;
      if (pos < len && (text[pos] === '+' || text[pos] === '-')) pos++;
      const expStart = pos;
      while (pos < len && text[pos] >= '0' && text[pos] <= '9') pos++;
      if (pos === expStart) throw Error('pins-json: bad exponent');
    }
    const raw = text.slice(start, pos);
    if (strict) {
      if (decimal) {
        const num = Number(raw);
        if (!Number.isFinite(num)) throw Error('pins-json: non-finite number');
        return {[NON_INT_NUMBER]: raw};
      }
      const big = BigInt(raw);
      if (big < INT64_MIN || big > INT64_MAX) throw Error('pins-json: integer out of int64 range');
      const num = Number(raw);
      return Number.isSafeInteger(num) ? num : {[INT64_NUMBER]: big};
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) throw Error('pins-json: non-finite number');
    return num;
  }
  function expect(lit) {
    if (!text.startsWith(lit, pos)) throw Error('pins-json: bad literal');
    pos += lit.length;
  }
  skipWs();
  const root = parseValue(0, strictRoot);
  skipWs();
  if (pos !== len) throw Error('pins-json: trailing data');
  return root;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && !Object.hasOwn(v, NON_INT_NUMBER) && !Object.hasOwn(v, INT64_NUMBER);
}

function checkPinEntry(entry, rev, ceiling, label) {
  if (!isPlainObject(entry)) throw Error(`pins-shape (${label})`);
  const keys = Object.keys(entry);
  if (keys.length !== 3 || !Object.hasOwn(entry, 'url') || !Object.hasOwn(entry, 'sha256') || !Object.hasOwn(entry, 'maxBytes')) {
    throw Error(`pins-shape (${label})`);
  }
  const url = entry.url;
  const prefix = `${DISTRIBUTION_PREFIX}${rev}/store/distribution/`;
  if (typeof url !== 'string' || !url.startsWith(prefix) || url.length <= prefix.length) {
    throw Error(`pins-url (${label})`);
  }
  const rel = url.slice(prefix.length);
  if (!SAFE_REL_PATH_RE.test(rel) || rel.split('/').some((seg) => seg === '.' || seg === '..')) {
    throw Error(`pins-url (${label})`);
  }
  let u;
  try { u = new URL(url); } catch { throw Error(`pins-url (${label})`); }
  if (u.origin !== 'https://raw.githubusercontent.com' || u.port || u.username || u.password
      || u.search || u.hash || u.href !== url) {
    throw Error(`pins-url (${label})`);
  }
  const sha = entry.sha256;
  if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
    throw Error(`pins-digest (${label})`);
  }
  const maxBytes = entry.maxBytes;
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling) {
    throw Error(`pins-budget (${label})`);
  }
}

export function validateStrictPins(pins, catalogIds = loadCatalogOnlineIds()) {
  if (!isPlainObject(pins)) throw Error('pins-shape: expected object');
  const rootKeys = Object.keys(pins);
  if (rootKeys.length !== 3 || !Object.hasOwn(pins, 'revision') || !Object.hasOwn(pins, 'catalog') || !Object.hasOwn(pins, 'apks')) {
    throw Error('pins-shape: expected exact keys revision, catalog, apks');
  }
  const rev = pins.revision;
  if (typeof rev !== 'string' || !/^[0-9a-f]{40}$/.test(rev)) throw Error('pins-revision');
  checkPinEntry(pins.catalog, rev, MAX_CATALOG_BYTES, 'catalog');
  const apks = pins.apks;
  if (!isPlainObject(apks)) throw Error('pins-apks');
  const ids = Object.keys(apks);
  if (ids.length < 1 || ids.length > MAX_PIN_APPS) throw Error('pins-apps-count');
  for (const id of ids) {
    if (!catalogIds.has(id) && !CATALOG_APP_RE.test(id)) throw Error(`unknown-app (${id})`);
    checkPinEntry(apks[id], rev, MAX_APK_BYTES, id);
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(pins), 'utf8');
  if (serializedBytes > MAX_PIN_BYTES) {
    throw Error(`size-limit: serialized online-pins.json exceeds ${MAX_PIN_BYTES} bytes (${serializedBytes})`);
  }
}

function toPlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.hasOwn(value, NON_INT_NUMBER)) return Number(value[NON_INT_NUMBER]);
  if (Object.hasOwn(value, INT64_NUMBER)) return Number(value[INT64_NUMBER]);
  if (Array.isArray(value)) return value.map(toPlain);
  const out = {};
  for (const k of Object.keys(value)) out[k] = toPlain(value[k]);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const payload = parseStrictJson(text, {strictKey: 'pins'});
  if (!isPlainObject(payload)) throw Error('online-csp: expected JSON object payload');
  const catalogIds = loadCatalogOnlineIds();
  validateStrictPins(payload.pins, catalogIds);
  if (typeof payload.pinsJson === 'string') {
    const rawBytes = Buffer.byteLength(payload.pinsJson, 'utf8');
    if (rawBytes > MAX_PIN_BYTES) {
      throw Error(`size-limit: pinsJson exceeds ${MAX_PIN_BYTES} bytes (${rawBytes})`);
    }
    validateStrictPins(parseStrictJson(payload.pinsJson, {strictRoot: true}), catalogIds);
  }
  const {assets, descriptor} = toPlain(payload);
  const pins = toPlain(payload.pins);
  const {onlineRuntime} = await import(pathToFileURL(assets + '/online.js'));
  const {clientRuntimeConnectSrc} = await import(pathToFileURL(assets + '/runtime.js'));
  process.stdout.write(clientRuntimeConnectSrc(onlineRuntime(descriptor, pins), ['store-download'], [], 'https://appassets.androidplatform.net'));
}
