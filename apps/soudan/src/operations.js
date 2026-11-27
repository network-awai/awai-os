// External operations of Soudan (kotoba.app.client-runtime.v1, restricted-wasm-v1).
// Two operations are declared:
// 1. X1 send/share hand-off (ADR 0001 D9 / owner decision O1): handing the assembled consultation memo
//    to the lawyer the user chose, through the OS share sheet / Web parity hand-off (browser-action: share,
//    recipient: user-selected-app; no service origin is fabricated).
// 2. Optional in-house murakumo.cloud draft organization slot (soudan.inference.organize): synchronous
//    POST https://api.murakumo.cloud/v1/chat/completions ONLY (never free-tier external proxies), fail-closed by default
//    until pre-launch Legal item #224 blockers & in-house endpoint readiness are confirmed.
// Canonical broker vendored from kotoba-lang/kotoba (see otehon/shell/vendor/PINS.json).

export const SEND_SELECTOR = Object.freeze({
  capability: 'itonami.soudan.send',
  service: 'user-chosen-lawyer',
  operation: 'send-consultation-memo',
});

export const INFERENCE_SELECTOR = Object.freeze({
  capability: 'itonami.soudan.inference',
  service: 'murakumo-cloud',
  operation: 'organize-consultation-draft',
});

export const MURAKUMO_ORIGIN = 'https://api.murakumo.cloud';
export const MURAKUMO_PATH = '/v1/chat/completions';
export const MURAKUMO_READY_PATH = '/ready';
export const MURAKUMO_PINNED_MODEL = 'mishima';
export const FOREIGN_INFO_URL = 'https://soudan.itonami.app/foreign-info.html#murakumo';

// First-screen disclosure facts (KOTOBA-159 finding 9) follow the dialog language:
// the canonical broker localizes its own labels, while recipient/data/purpose/special-care-kinds/note
// are shown as declared. Placeholders clearly mark items awaiting Legal item #224 confirmation.
const DISCLOSURE_FACTS = Object.freeze({
  ja: Object.freeze({
    recipient: '利用者がこの端末で選ぶアプリ',
    data: Object.freeze(['相談メモ（氏名、連絡先、相談内容）']),
    purpose: '利用者が選んだ弁護士に相談メモを送る',
    withdrawal: '設定',
    specialCareKinds: Object.freeze(['相談メモに含まれ得る要配慮個人情報（病歴・犯罪歴等。Legal確認中）']),
    note: '画像原本は送信されません。送信前に実名・要配慮個人情報の要否を確認してください（Legal O8文言確認中）。',
  }),
  en: Object.freeze({
    recipient: 'the app you choose on this device',
    data: Object.freeze(['consultation memo (name, contact, consultation details)']),
    purpose: 'to send the consultation memo to the lawyer you chose',
    withdrawal: 'Settings',
    specialCareKinds: Object.freeze(['special-care data if entered (health/criminal; Legal TBD)']),
    note: 'Raw image bytes are never sent. Review personal or sensitive data before sending (Legal O8 wording pending).',
  }),
});

// Route B honest disclosure for murakumo.cloud (Legal addendum §1.5, item #224):
// Names Awai Network LLC (US legal entity), discloses possible Cloudflare / Hugging Face / Modal / OpenRouter
// routing, explicitly avoids false non-retention or country-lock guarantees, and warns users to anonymize.
const INFERENCE_DISCLOSURE_FACTS = Object.freeze({
  ja: Object.freeze({
    recipient: 'Awai Network LLC',
    countryName: 'アメリカ合衆国（米国法人）',
    data: Object.freeze(['匿名化後の相談メモ下書きテキスト（画像バイト除く）']),
    purpose: '相談前メモの事実・経緯・質問項目を自己整理する（法的助言ではありません）',
    withdrawal: '設定',
    specialCareKinds: Object.freeze(['誤入力され得る要配慮個人情報（病歴・犯罪歴等。入力しないでください／Legal確認中）']),
    note: '通常APIは学習・評価不使用。ただし処理国の固定やサービス全体での非保持は保証されません。実名・連絡先・要配慮個人情報は「Aさん」等に置換してください（Legal確認中）。',
  }),
  en: Object.freeze({
    recipient: 'Awai Network LLC',
    countryName: 'United States',
    data: Object.freeze(['anonymized consultation draft text (no image bytes)']),
    purpose: 'Organize consultation memo facts and questions (not legal advice)',
    withdrawal: 'Settings',
    specialCareKinds: Object.freeze(['sensitive data if entered (do not enter; Legal O8 pending)']),
    note: 'Not used for model training/evaluation; fixed country-of-processing and service-wide non-retention are not guaranteed. Anonymize names/contacts/sensitive data first (Legal O8 pending).',
  }),
});

export function disclosureFacts(locale = 'ja') {
  return DISCLOSURE_FACTS[locale === 'en' ? 'en' : 'ja'];
}

export function inferenceDisclosureFacts(locale = 'ja') {
  return INFERENCE_DISCLOSURE_FACTS[locale === 'en' ? 'en' : 'ja'];
}

function sendOperation(locale = 'ja') {
  const facts = disclosureFacts(locale);
  return Object.freeze({
    ...SEND_SELECTOR,
    consent: 'each-operation',
    'data-categories': Object.freeze(['legal.consultation-memo']),
    endpoint: Object.freeze({'browser-action': 'share', recipient: 'user-selected-app'}),
    disclosure: Object.freeze({
      recipient: facts.recipient,
      country: 'JP',
      data: facts.data,
      'special-care': true,
      'special-care-kinds': facts.specialCareKinds,
      purpose: facts.purpose,
      frequency: 'one-time',
      withdrawal: facts.withdrawal,
      note: facts.note,
    }),
  });
}

function inferenceOperation(locale = 'ja') {
  const facts = inferenceDisclosureFacts(locale);
  return Object.freeze({
    ...INFERENCE_SELECTOR,
    consent: 'each-operation',
    'data-categories': Object.freeze(['consultation-draft-text']),
    endpoint: Object.freeze({
      origin: MURAKUMO_ORIGIN,
      routes: Object.freeze([
        Object.freeze({method: 'POST', path: MURAKUMO_PATH, 'query-params': Object.freeze([])}),
        Object.freeze({
          method: 'GET',
          path: MURAKUMO_READY_PATH,
          'query-params': Object.freeze(['model']),
          'query-values': Object.freeze({model: MURAKUMO_PINNED_MODEL}),
        }),
      ]),
    }),
    'request-body': 'text',
    'max-request-bytes': 65536,
    'content-type': 'application/json',
    'response-body': 'text',
    'max-response-bytes': 65536,
    'timeout-ms': 30000,
    disclosure: Object.freeze({
      recipient: facts.recipient,
      country: 'US',
      'country-name': facts.countryName,
      'foreign-info-url': FOREIGN_INFO_URL,
      data: facts.data,
      'special-care': true,
      'special-care-kinds': facts.specialCareKinds,
      purpose: facts.purpose,
      frequency: 'one-time',
      withdrawal: facts.withdrawal,
      note: facts.note,
    }),
  });
}

export const SEND_OPERATION = sendOperation('ja');
export const INFERENCE_OPERATION = inferenceOperation('ja');
export const REQUESTED_CAPABILITIES = Object.freeze([SEND_SELECTOR.capability, INFERENCE_SELECTOR.capability]);

export const HOST_LOCAL_ALLOWED_CALLS = Object.freeze([
  'storage.get',
  'storage.put',
  'storage.delete',
  'device.save',
]);

export const HOST_LOCAL_STORAGE_INVARIANTS = Object.freeze({
  class: 'device-only',
  backup: 'excluded',
  'at-rest': 'encrypted',
  erasable: true,
  'quota-bytes': 1048576,
  'max-entries': 64,
  'max-value-bytes': 262144,
});

export const HOST_LOCAL_SAVE_MIME_TYPES = Object.freeze([
  'text/plain',
  'application/json',
  'application/octet-stream',
]);

export const HOST_LOCAL_SAVE_OCTET_EXTENSIONS = Object.freeze(['md']);
export const HOST_LOCAL_SAVE_MAX_BYTES = 262144;

export function runtimeDescriptor(locale = 'ja') {
  const lang = locale === 'en' ? 'en' : 'ja';
  return {
    schema: 'kotoba.app.client-runtime.v1',
    target: 'browser',
    profile: 'restricted-wasm-v1',
    entry: 'guest.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.state.v2', version: 2},
    'host-local': {
      schema: 'kotoba.host-local.v1',
      'app-id': 'network.itonami.soudan',
      calls: [...HOST_LOCAL_ALLOWED_CALLS],
      storage: {...HOST_LOCAL_STORAGE_INVARIANTS},
      stores: ['soudan-state'],
      save: {
        'max-bytes': HOST_LOCAL_SAVE_MAX_BYTES,
        'mime-types': [...HOST_LOCAL_SAVE_MIME_TYPES],
        'octet-stream-extensions': [...HOST_LOCAL_SAVE_OCTET_EXTENSIONS],
      },
    },
    workers: [],
    operations: [
      lang === 'ja' ? SEND_OPERATION : sendOperation('en'),
      lang === 'ja' ? INFERENCE_OPERATION : inferenceOperation('en'),
    ],
  };
}

// Zone B-25 Z25-06 contract validator: fails closed if host-local calls widen beyond
// storage.get/put/delete + device.save or if storage/save invariants drift.
export function validateHostLocalContract(descriptor) {
  const problems = [];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return {ok: false, problems: ['descriptor.invalid']};
  }
  const hl = descriptor['host-local'];
  if (!hl || typeof hl !== 'object' || Array.isArray(hl)) {
    return {ok: false, problems: ['host-local.missing']};
  }

  if (!Array.isArray(hl.calls)) {
    problems.push('host-local.calls.invalid');
  } else {
    const seen = new Set();
    for (const call of hl.calls) {
      if (typeof call !== 'string' || !HOST_LOCAL_ALLOWED_CALLS.includes(call)) {
        problems.push(`host-local.calls.widened:${String(call)}`);
      } else if (seen.has(call)) {
        problems.push(`host-local.calls.duplicate:${call}`);
      }
      seen.add(call);
    }
    for (const req of HOST_LOCAL_ALLOWED_CALLS) {
      if (!seen.has(req)) problems.push(`host-local.calls.missing:${req}`);
    }
  }

  const storage = hl.storage;
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    problems.push('host-local.storage.missing');
  } else {
    for (const [key, expected] of Object.entries(HOST_LOCAL_STORAGE_INVARIANTS)) {
      if (storage[key] !== expected) {
        problems.push(`host-local.storage.${key}`);
      }
    }
  }

  const save = hl.save;
  if (!save || typeof save !== 'object' || Array.isArray(save)) {
    problems.push('host-local.save.missing');
  } else {
    if (save['max-bytes'] !== HOST_LOCAL_SAVE_MAX_BYTES) {
      problems.push('host-local.save.max-bytes');
    }
    if (!Array.isArray(save['mime-types'])) {
      problems.push('host-local.save.mime-types.invalid');
    } else {
      const seenMimes = new Set();
      for (const mime of save['mime-types']) {
        if (typeof mime !== 'string' || !HOST_LOCAL_SAVE_MIME_TYPES.includes(mime)) {
          problems.push(`host-local.save.mime-type-undeclared:${String(mime)}`);
        } else if (seenMimes.has(mime)) {
          problems.push(`host-local.save.mime-types.duplicate:${mime}`);
        }
        seenMimes.add(mime);
      }
      for (const reqMime of HOST_LOCAL_SAVE_MIME_TYPES) {
        if (!seenMimes.has(reqMime)) problems.push(`host-local.save.mime-type-missing:${reqMime}`);
      }
    }
    if (!Array.isArray(save['octet-stream-extensions'])) {
      problems.push('host-local.save.octet-stream-extensions.invalid');
    } else {
      const seenExts = new Set();
      for (const ext of save['octet-stream-extensions']) {
        if (typeof ext !== 'string' || !HOST_LOCAL_SAVE_OCTET_EXTENSIONS.includes(ext)) {
          problems.push(`host-local.save.octet-stream-extension-undeclared:${String(ext)}`);
        } else if (seenExts.has(ext)) {
          problems.push(`host-local.save.octet-stream-extensions.duplicate:${ext}`);
        }
        seenExts.add(ext);
      }
      for (const reqExt of HOST_LOCAL_SAVE_OCTET_EXTENSIONS) {
        if (!seenExts.has(reqExt)) problems.push(`host-local.save.octet-stream-extension-missing:${reqExt}`);
      }
    }
  }

  return {ok: problems.length === 0, problems};
}

// Zone B-25 Z25-08 / Z25-33 disclosure contract validator: enforces that EVERY declared
// operation carries each-operation consent, one-time frequency, non-empty disclosure.withdrawal,
// and special-care: true with non-empty special-care-kinds.
export function validateOperationDisclosures(descriptor) {
  const problems = [];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return {ok: false, problems: ['descriptor.invalid']};
  }
  if (!Array.isArray(descriptor.operations) || descriptor.operations.length === 0) {
    return {ok: false, problems: ['operations.missing']};
  }
  descriptor.operations.forEach((op, idx) => {
    const label = typeof op?.capability === 'string' && op.capability ? op.capability : `op[${idx}]`;
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      problems.push(`operation.invalid:${label}`);
      return;
    }
    if (op.consent !== 'each-operation') {
      problems.push(`operation.consent.not-each-operation:${label}`);
    }
    const disc = op.disclosure;
    if (!disc || typeof disc !== 'object' || Array.isArray(disc)) {
      problems.push(`operation.disclosure.missing:${label}`);
      return;
    }
    if (disc.frequency !== 'one-time') {
      problems.push(`operation.disclosure.frequency.not-one-time:${label}`);
    }
    if (typeof disc.withdrawal !== 'string' || disc.withdrawal.trim().length === 0) {
      problems.push(`operation.disclosure.withdrawal.missing:${label}`);
    }
    if (disc['special-care'] !== true) {
      problems.push(`operation.disclosure.special-care.required:${label}`);
    }
    if (!Array.isArray(disc['special-care-kinds'])
      || disc['special-care-kinds'].length === 0
      || !disc['special-care-kinds'].every(k => typeof k === 'string' && k.trim().length > 0)) {
      problems.push(`operation.disclosure.special-care-kinds.missing:${label}`);
    }
  });
  return {ok: problems.length === 0, problems};
}

function parseCspDirectives(csp) {
  const directives = new Map();
  if (typeof csp !== 'string') return directives;
  for (const rawPart of csp.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const tokens = part.split(/\s+/);
    const name = tokens[0].toLowerCase();
    if (!directives.has(name)) directives.set(name, tokens.slice(1));
  }
  return directives;
}

function exactTokenSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const set = new Set(actual);
  if (set.size !== expected.length) return false;
  return expected.every(t => set.has(t));
}

function isRemoteScriptUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(?:https?:|\/\/|data:|blob:|javascript:|[a-z][a-z0-9+.-]*:\/\/)/i.test(trimmed);
}

function isRemoteLinkUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^(?:https?:|\/\/)/i.test(trimmed);
}

function readHtmlAttr(attrs, attrName) {
  const re = new RegExp(`(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

export function validateCspPolicy(csp, {expectedConnectSrc = 'none', allowScriptless = false, scriptTagCount = 0} = {}) {
  const problems = [];
  if (typeof csp !== 'string' || !csp.trim()) {
    return {ok: false, problems: ['csp.missing']};
  }
  const directives = parseCspDirectives(csp);
  const defaultSrc = directives.get('default-src');
  if (!exactTokenSet(defaultSrc, ["'none'"])) {
    problems.push('csp.default-src-not-none');
  }

  const scriptSrc = directives.get('script-src');
  if (scriptSrc) {
    if (!exactTokenSet(scriptSrc, ["'self'"])) {
      problems.push('csp.script-src-widened');
    }
  } else if (!allowScriptless) {
    problems.push('csp.script-src-missing');
  } else if (scriptTagCount > 0) {
    problems.push('csp.script-tag-in-scriptless-surface');
  }

  const connectSrc = directives.get('connect-src');
  if (expectedConnectSrc === 'tauri-ipc') {
    if (!exactTokenSet(connectSrc, ['ipc:', 'http://ipc.localhost'])) {
      problems.push('csp.connect-src-not-tauri-ipc');
    }
  } else if (expectedConnectSrc === 'none') {
    if (!exactTokenSet(connectSrc, ["'none'"])) {
      problems.push('csp.connect-src-not-none');
    }
  }

  for (const [dir, tokens] of directives.entries()) {
    for (const tok of tokens) {
      const lower = tok.toLowerCase();
      if (lower === "'unsafe-inline'" || lower === "'unsafe-eval'" || lower === '*') {
        problems.push(`csp.unsafe-token:${dir}:${tok}`);
      }
      const allowedTauriIpc = expectedConnectSrc === 'tauri-ipc' && dir === 'connect-src' && lower === 'http://ipc.localhost';
      if (!allowedTauriIpc && (/^https?:/i.test(tok) || tok.startsWith('//'))) {
        problems.push(`csp.remote-source:${dir}:${tok}`);
      }
    }
  }

  return {ok: problems.length === 0, problems};
}

// Zone B-25 Z25-06 HTML surface validator: rejects any remote script URL (http://, https://, //, etc.)
// and enforces strict CSP (script-src 'self' or scriptless default-src 'none', connect-src parity).
export function validateHtmlSurface(html, {name = 'html', expectedConnectSrc = 'none', allowScriptless = true} = {}) {
  const problems = [];
  if (typeof html !== 'string' || !html.trim()) {
    return {ok: false, problems: [`${name}:html.invalid`]};
  }

  const scriptTags = [];
  let outsideScripts = '';
  let cursor = 0;
  const openScriptRe = /<\s*script\b([^>]*)>/gi;
  let match;
  while ((match = openScriptRe.exec(html)) !== null) {
    outsideScripts += html.slice(cursor, match.index);
    const attrs = match[1] ?? '';
    scriptTags.push(attrs);
    const closeIdx = html.toLowerCase().indexOf('</script', openScriptRe.lastIndex);
    if (closeIdx < 0) {
      cursor = html.length;
      break;
    }
    const closeEnd = html.indexOf('>', closeIdx);
    cursor = closeEnd >= 0 ? closeEnd + 1 : html.length;
    openScriptRe.lastIndex = cursor;
  }
  outsideScripts += html.slice(cursor);

  for (const attrs of scriptTags) {
    const srcVal = readHtmlAttr(attrs, 'src');
    if (srcVal !== null) {
      if (expectedConnectSrc === 'guest-srcdoc') {
        problems.push(`${name}:guest.external-script-src:${srcVal}`);
      }
      if (isRemoteScriptUrl(srcVal)) {
        problems.push(`${name}:remote-script-src:${srcVal}`);
      }
    }
  }

  const linkRe = /<\s*link\b([^>]*)>/gi;
  let linkMatch;
  while ((linkMatch = linkRe.exec(outsideScripts)) !== null) {
    const attrs = linkMatch[1] ?? '';
    const hrefVal = readHtmlAttr(attrs, 'href');
    const relVal = (readHtmlAttr(attrs, 'rel') ?? '').toLowerCase();
    if (hrefVal !== null && isRemoteLinkUrl(hrefVal)) {
      problems.push(`${name}:remote-link-href:${hrefVal}`);
    }
    if (expectedConnectSrc === 'guest-srcdoc' && relVal.split(/\s+/).includes('stylesheet')) {
      problems.push(`${name}:guest.external-stylesheet`);
    }
  }

  let hasNoReferrer = false;
  const metaCsps = [];
  const metaRe = /<\s*meta\b([^>]*)>/gi;
  let metaMatch;
  while ((metaMatch = metaRe.exec(outsideScripts)) !== null) {
    const attrs = metaMatch[1] ?? '';
    const metaName = (readHtmlAttr(attrs, 'name') ?? '').toLowerCase();
    const httpEquiv = (readHtmlAttr(attrs, 'http-equiv') ?? '').toLowerCase();
    const content = readHtmlAttr(attrs, 'content');
    if (metaName === 'referrer' && content?.toLowerCase() === 'no-referrer') {
      hasNoReferrer = true;
    }
    if (httpEquiv === 'content-security-policy' && content !== null) {
      metaCsps.push(content);
    }
  }

  if (!hasNoReferrer) problems.push(`${name}:referrer.missing-no-referrer`);

  if (expectedConnectSrc === 'guest-srcdoc') {
    for (const metaCsp of metaCsps) {
      const dirs = parseCspDirectives(metaCsp);
      for (const [dir, tokens] of dirs.entries()) {
        for (const tok of tokens) {
          if (/^https?:/i.test(tok) || tok.startsWith('//')) {
            problems.push(`${name}:guest.csp-remote-source:${dir}:${tok}`);
          }
        }
      }
    }
  } else if (metaCsps.length === 0) {
    problems.push(`${name}:csp.missing`);
  } else {
    for (const metaCsp of metaCsps) {
      const cspRes = validateCspPolicy(metaCsp, {
        expectedConnectSrc,
        allowScriptless,
        scriptTagCount: scriptTags.length,
      });
      for (const p of cspRes.problems) problems.push(`${name}:${p}`);
    }
  }

  return {ok: problems.length === 0, problems};
}
