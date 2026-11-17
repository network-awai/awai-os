// Real HTTPS pairing and Noise/UDP/OpenSSH; no account or mocked transport.
import {setup} from '../kekkai-setup-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const [url,fingerprint,runtime]=process.argv.slice(2);
await setup({url,fingerprint,runtime,identity:'/tmp/ci-ssh',code:readFileSync('/tmp/code','utf8').trim(),
 askApproval:message=>writeFileSync('/tmp/approval-stage',message),
 // Test fixture pins the VM's real host key before connecting.
 sshArgs:['-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/tmp/known_hosts','id -un; echo KEKKAI-SSH-OK']});
