#!/bin/zsh
set -eu
set -o pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
qa=/Users/junkawasaki/github/workspaces/codex/awai-usb-writer
helper=/Library/PrivilegedHelperTools/cloud.murakumo.kioxia-writer
mkdir -p "$qa/logs"
log="$qa/logs/passwordless-setup.log"
exec > >(/usr/bin/tee "$log") 2>&1
print 'KIOXIA専用の初回設定です。管理者パスワードはこの設定時だけ必要です。'
/usr/bin/sudo /bin/sh "$repo/macos-usb-writer/install-helper.sh"
print '通常の管理者操作がパスワード不要になっていないことを確認します。'
if /usr/bin/sudo -n -k /usr/bin/true; then
  print 'このMacには別途一般的なパスワード不要設定が存在します。専用ルールのみ追加しました。'
else
  print '通常の管理者操作は引き続き認証が必要です。'
fi
if /usr/bin/sudo -n -k "$helper" unexpected-argument; then
  print '引数制限の確認に失敗しました。';exit 1
fi
# Force a read-only preflight even if a previous request selected write.
/usr/bin/python3 - <<'PYREQUEST'
import json,os
from pathlib import Path
p=Path('/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/usb-write-request.json')
r=json.loads(p.read_text());r['action']='check'
tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(r)+'\n');os.chmod(tmp,0o600);tmp.replace(p)
PYREQUEST
print '専用処理がパスワードなしで使えることを確認します。' 
/usr/bin/sudo -n -k "$helper"
print '初回設定と読み取り確認が完了しました。'
print '書き込みはKIOXIA-Update.commandで別途実行します。'
