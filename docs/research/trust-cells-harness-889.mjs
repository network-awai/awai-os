// Trust delegated-operation cells — isolated synthetic harness (vendored pin 889239dc)
// Module: kotoba-lang/kotoba @ 889239dc972a868ee9e824517aad07c343972e7d
//   lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js
//   sha256 76bc0d8358ebcc62c3bf530c5958e9b9040184dd3b9c358b5cf38a0f4b17182c
// Usage: node docs/research/trust-cells-harness-889.mjs [path-to-kotoba-client-runtime.js]
// Default module path: /tmp/kotoba-889.mjs (generate with:
//   git -C kotoba-lang/kotoba show 889239dc...:lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js > /tmp/kotoba-889.mjs)
const modPath = process.argv[2] ?? '/tmp/kotoba-889.mjs';
const { prepareClientOperationRequest, clientEndpointAllowsRequest, effectiveClientOperations, clientRuntimeProblems } = await import(modPath);

const disclosure = { recipient: 'svc', country: 'JP', data: ['public'], 'special-care': false, purpose: 'read items', frequency: 'one-time' };
const op = (over = {}) => ({
  capability: 'net/http-get', service: 'svc', operation: 'read',
  consent: 'each-operation', 'data-categories': ['public'], disclosure,
  endpoint: { origin: 'https://svc.example', method: 'GET', path: '/items' }, ...over
});
const runtime = (operations) => ({ schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'restricted-wasm-v1', entry: 'index.html', 'local-state': { adapter: 'memory', schema: 's', version: 1 }, operations });
const sel = ['net/http-get', 'svc', 'read'];

function out(name, cond, detail) { console.log(`${name}: ${cond ? 'PASS' : 'FAIL'} — ${detail}`); return cond; }
let ok = true;

// 1. MATCHED (vendored pin 889; disclosure present per KOTOBA-159 finding 9)
{
  const o = op();
  const allows = clientEndpointAllowsRequest(o.endpoint, 'https://svc.example/items', 'GET');
  const prepped = await prepareClientOperationRequest(o, { input: 'https://svc.example/items', init: { method: 'GET' } });
  const eff = effectiveClientOperations(runtime([o]), { requestedCapabilities: ['net/http-get'], approvedOperations: [o], hostSupportedOperations: [sel] });
  const problems = clientRuntimeProblems(runtime([o]), ['net/http-get']);
  ok &&= out('MATCHED', allows === true && prepped.input.url === 'https://svc.example/items' && eff.length === 1 && problems.length === 0,
    `allows=${allows} prepped-url=${prepped.input.url} effective=${eff.length} problems=${JSON.stringify(problems)}`);
}

// 2. MISMATCHED (vendored pin 889; scope + actor variants, factor in trace)
{
  const o = op();
  const allows = clientEndpointAllowsRequest(o.endpoint, 'https://svc.example/other', 'GET');
  let threw = false;
  try { await prepareClientOperationRequest(o, { input: 'https://svc.example/other', init: { method: 'GET' } }); } catch (e) { threw = /request scope is not declared/.test(String(e.message)); }
  const o2 = op({ service: 'svc2' });
  const eff2 = effectiveClientOperations(runtime([o2]), { requestedCapabilities: ['net/http-get'], approvedOperations: [o], hostSupportedOperations: [sel] });
  ok &&= out('MISMATCHED', allows === false && threw === true && eff2.length === 0,
    `scope-allows=${allows} scope-threw=${threw} actor-changed-effective=${eff2.length}`);
}

// NOTE: EXPIRED is an ABSENT finding measured by grep, not by this harness (see
// research/trust-draft-claims.md TRUST-DELEGATION-EXPIRED ABSENT row). The
// previous harness-side expiry filter was a tautology and was withdrawn.

console.log(ok ? 'ALL PASS (synthetic, vendored 889)' : 'SOME FAIL (synthetic, vendored 889)');
process.exit(ok ? 0 : 1);
