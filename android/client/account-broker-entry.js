import { signHostAccount, signWnfsAccountAction } from '../../otehon/shell/src/identity/device.js';

try {
  const request = JSON.parse(window.AwaiAccountBroker.request());
  const proof = request.nonce ? await signHostAccount(request) : await signWnfsAccountAction(request.app, request.action);
  window.AwaiAccountBroker.complete(JSON.stringify(proof));
} catch {
  window.AwaiAccountBroker.complete('');
}
