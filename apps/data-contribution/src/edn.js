// Minimal EDN reader (copied from apps/horei/scripts/edn.mjs) for the awai-data-contribution-rewards bot results.
// Supports: nil/true/false, strings, integers/decimals, keywords, symbols,
// vectors, lists, sets, maps and namespaced maps (#:ns{...}), ; comments and #_ discard.
// Keywords become strings without the leading colon (":law/key" -> "law/key").
// Anything else (other tagged literals, chars, ratios) is rejected, never guessed.
export class EdnError extends Error {}

export function parseEdn(text) {
  let i = 0;
  const n = text.length;
  const fail = msg => { throw new EdnError(`${msg} at offset ${i}`); };
  const ws = () => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === ',' || c === '\n' || c === '\r' || c === '\t') i++;
      else if (c === ';') { while (i < n && text[i] !== '\n') i++; }
      else break;
    }
  };
  const delim = c => c === undefined || ' ,\n\r\t;()[]{}"'.includes(c);
  const token = () => { const s = i; while (i < n && !delim(text[i])) i++; return text.slice(s, i); };
  function str() {
    i++;
    let out = '';
    for (;;) {
      if (i >= n) fail('unterminated string');
      const c = text[i++];
      if (c === '"') return out;
      if (c !== '\\') { out += c; continue; }
      const e = text[i++];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' };
      if (e in map) out += map[e];
      else if (e === 'u') { const h = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape'); out += String.fromCharCode(parseInt(h, 16)); i += 4; }
      else fail('unsupported escape');
    }
  }
  function seq(close) {
    const out = [];
    for (;;) {
      ws();
      if (i >= n) fail('unterminated collection');
      if (text[i] === close) { i++; return out; }
      const v = value();
      if (v !== DISCARD) out.push(v);
    }
  }
  function map(ns) {
    const items = seq('}');
    if (items.length % 2) fail('odd map');
    const out = {};
    for (let k = 0; k < items.length; k += 2) {
      let key = items[k];
      if (typeof key !== 'string' || !key.startsWith(KW)) fail('non-keyword map key');
      key = key.slice(KW.length);
      if (ns) key = key.startsWith('_/') ? key.slice(2) : key.includes('/') ? key : `${ns}/${key}`;
      if (Object.hasOwn(out, key)) fail('duplicate map key ' + key);
      out[key] = unkw(items[k + 1]);
    }
    return out;
  }
  const DISCARD = Symbol('discard');
  function value() {
    ws();
    if (i >= n) fail('unexpected end');
    const c = text[i];
    if (c === '"') return str();
    if (c === '[') { i++; return seq(']').map(unkw); }
    if (c === '(') { i++; return seq(')').map(unkw); }
    if (c === '{') { i++; return map(null); }
    if (c === '#') {
      const d = text[i + 1];
      if (d === '{') { i += 2; return seq('}').map(unkw); }
      if (d === '_') { i += 2; value(); return DISCARD; }
      if (d === ':') {
        i += 2;
        const ns = token();
        if (!/^[A-Za-z][\w.*+!?-]*$/.test(ns) || text[i] !== '{') fail('bad namespaced map');
        i++;
        return map(ns);
      }
      fail('unsupported tagged literal');
    }
    if (c === ')' || c === ']' || c === '}') fail('unexpected ' + c);
    const t = token();
    if (t === 'nil') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^[-+]?\d+$/.test(t)) { const v = Number(t); if (!Number.isSafeInteger(v)) fail('integer out of range'); return v; }
    if (/^[-+]?\d+\.\d+([eE][-+]?\d+)?$/.test(t)) return Number(t);
    if (t.startsWith(':') && t.length > 1) return KW + t.slice(1);
    if (/^[A-Za-z*+!?<>=._-][\w*+!?<>=.\/-]*$/.test(t)) return t;
    fail('unsupported token ' + JSON.stringify(t));
  }
  const v = value();
  ws();
  if (i < n) fail('trailing data');
  return unkw(v);
}
// Keywords are tagged internally so map keys can be told apart from strings.
const KW = '\u0000kw:';
const unkw = v => (typeof v === 'string' && v.startsWith(KW) ? v.slice(KW.length) : v);
