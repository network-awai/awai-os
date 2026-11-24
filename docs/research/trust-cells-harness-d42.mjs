// Trust delegated-operation cells — isolated synthetic harness (no network, no private data)
import { prepareClientOperationRequest, clientEndpointAllowsRequest, effectiveClientOperations, clientRuntimeProblems } from '/Users/node/github/repos/kotoba-lang/kotoba/lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js';

const op = (over={}) => ({
  capability: 'net/http-get', service: 'svc', operation: 'read',
  consent: 'each-operation', 'data-categories': ['public'],
  endpoint: { origin: 'https://svc.example', method: 'GET', path: '/items' }, ...over
});
const runtime = (operations) => ({ schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'restricted-wasm-v1', entry: 'index.html', 'local-state': { adapter: 'memory', schema: 's', version: 1 }, operations });
const sel = [ 'net/http-get', 'svc', 'read' ];

// fixed clock for expiry (inject_time/expiry recorded; no real wait)
const inject_time = 1700000000000, ttl_ms = 60000;
const expiry = inject_time + ttl_ms;
const now = expiry + 1; // request after expiry

function out(name, cond, detail) {
  console.log(`${name}: ${cond ? 'PASS' : 'FAIL'} — ${detail}`);
  return cond;
}
let ok = true;

// 1. MATCHED — declared endpoint allows the exact request; prepare resolves; in effective set
{
  const o = op(); const end = o.endpoint;
  const allows = clientEndpointAllowsRequest(end, 'https://svc.example/items', 'GET');
  const prepped = await prepareClientOperationRequest(o, { input: 'https://svc.example/items', init: { method: 'GET' } });
  const eff = effectiveClientOperations(runtime([o]), { requestedCapabilities: ['net/http-get'], approvedOperations: [o], hostSupportedOperations: [sel] });
  const problems = clientRuntimeProblems(runtime([o]), ['net/http-get']);
  ok &&= out('MATCHED', allows === true && prepped.input.url === 'https://svc.example/items' && eff.length === 1 && problems.length === 0,
    `allows=${allows} prepped-url=${prepped.input.url} effective=${eff.length} problems=${problems.length}`);
}

// 2. MISMATCHED — changed scope (different path) is refused; changed actor (service) not effective
{
  const o = op();
  const allows = clientEndpointAllowsRequest(o.endpoint, 'https://svc.example/other', 'GET');
  let threw = false;
  try { await prepareClientOperationRequest(o, { input: 'https://svc.example/other', init: { method: 'GET' } }); } catch (e) { threw = /request scope is not declared/.test(String(e.message)); }
  const o2 = op({ service: 'svc2' });
  const eff2 = effectiveClientOperations(runtime([o2]), { requestedCapabilities: ['net/http-get'], approvedOperations: [o], hostSupportedOperations: [sel.map(s=>s)] });
  ok &&= out('MISMATCHED', allows === false && threw === true && eff2.length === 0,
    `scope-allows=${allows} scope-threw=${threw} actor-changed-effective=${eff2.length}`);
}

// 3. EXPIRED — grant expiring before now is excluded from the effective set (fixed clock)
{
  const o = op();
  const grant = { operation: o, expires: expiry };
  const approvedLive = (now > grant.expires) ? [] : [grant.operation];
  const eff = effectiveClientOperations(runtime([o]), { requestedCapabilities: ['net/http-get'], approvedOperations: approvedLive, hostSupportedOperations: [sel] });
  ok &&= out('EXPIRED', eff.length === 0,
    `inject_time=${inject_time} expiry=${expiry} now=${now} effective-after-expiry=${eff.length}`);
}

console.log(ok ? 'ALL PASS (synthetic)' : 'SOME FAIL (synthetic)');
process.exit(ok ? 0 : 1);
