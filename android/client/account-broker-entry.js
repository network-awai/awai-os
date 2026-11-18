import { signWnfsAccountAction } from '../../otehon/shell/src/identity/device.js';

try {
  const { app, action } = JSON.parse(window.AwaiAccountBroker.request());
  const proof = await signWnfsAccountAction(app, action);
  window.AwaiAccountBroker.complete(JSON.stringify(proof));
} catch {
  window.AwaiAccountBroker.complete('');
}
