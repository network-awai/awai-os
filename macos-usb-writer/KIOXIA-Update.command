#!/bin/zsh
set -eu
set -o pipefail
qa=/Users/junkawasaki/github/workspaces/codex/awai-usb-writer
helper=/Library/PrivilegedHelperTools/cloud.murakumo.kioxia-writer
mkdir -p "$qa/logs"
log="$qa/logs/passwordless-write.log"
reset_request() {
/usr/bin/python3 - <<'PYRESET'
import json,os
from pathlib import Path
p=Path('/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/usb-write-request.json')
r=json.loads(p.read_text());r['action']='check'
tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(r)+'\n');os.chmod(tmp,0o600);tmp.replace(p)
PYRESET
}
trap reset_request EXIT
# Preparation is unprivileged. The root helper accepts no paths or arguments.
/usr/bin/python3 - <<'PY'
import json,os
from pathlib import Path
p=Path('/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/usb-write-request.json')
r=json.loads(p.read_text())
r['action']='write'
tmp=p.with_suffix('.tmp')
tmp.write_text(json.dumps(r)+'\n');os.chmod(tmp,0o600);tmp.replace(p)
PY
print '準備済みISOを指定のKIOXIAへ書き込みます。完了までUSBを抜かないでください。'
/usr/bin/sudo -n -k "$helper" 2>&1 | /usr/bin/tee "$log"
print '書き込みと読み戻し照合が完了し、USBを取り外しました。抜いて大丈夫です。'
