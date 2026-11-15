"""Japanese physical-console UI for the same bounded installer as the GUI."""
import base64
import json
import os
from pathlib import Path
import socket
import time

SOCKET = '/run/otehon-install/control.sock'
ERRORS = {
    'target-too-small': '容量が不足しています。このディスクは選択できません。',
    'target-in-use': '起動 USB または使用中のディスクです。選択できません。',
    'missing-or-ambiguous-serial': 'ディスクを一意に識別できません。選択できません。',
    'target-changed': '接続状態が変わりました。保存先を選び直してください。',
    'approval-stale': '保存先の選択が変わりました。もう一度確認してください。',
    'approval-expired': '確認の有効時間を過ぎました。保存先を選び直してください。',
    'install-in-progress': '別の画面でインストール中です。完了をお待ちください。',
    'another-installer-active': '別のインストールが実行中です。',
}

def rpc(op, *args):
    line = b'JSON\t' + op.encode('ascii')
    for arg in args:
        line += b'\t' + base64.b64encode(arg.encode('utf-8'))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(SOCKET)
        connection.sendall(line + b'\n')
        with connection.makefile('rb') as stream:
            data = stream.readline(262145)
    if len(data) > 262144 or not data.endswith(b'\n'):
        raise RuntimeError('応答を確認できません。別の保存先を自動選択しません。')
    response = json.loads(data)
    if not response['ok']:
        code = response['error']
        raise RuntimeError(ERRORS.get(code, '確認に失敗しました。診断コード: ' + code))
    return response['value']

def unavailable(row, raw_bytes):
    if row['used'] or row['readOnly']: return '使用中・起動 USB（選択不可）'
    if row['size'] <= raw_bytes: return '容量不足（選択不可）'
    if row['ambiguous']: return '識別情報を確認できません（選択不可）'
    return ''

def choices(rows, raw_bytes):
    return sorted(rows, key=lambda r: (bool(unavailable(r, raw_bytes)), not r['path'].startswith('/dev/nvme'), r['path']))

def choose(rows, value):
    # No default, negative index, pasted escape sequence or arbitrary path.
    if not value.isascii() or not value.isdecimal(): return None
    number = int(value) if len(value) < 5 else 0
    return rows[number - 1] if 1 <= number <= len(rows) else None

def safe(value, limit=90):
    return ''.join(c if c.isprintable() else '?' for c in str(value))[:limit]

def partition_text(row):
    return ' / '.join(safe(p['fstype'] or '不明', 24) for p in row['partitions'][:4]) or '領域なし'

def header(info, title):
    print('\033[2J\033[H', end='')
    print('Awai Otehon ' + info['version'] + ' インストーラー（USB）')
    print('Build ID: ' + info['buildId'][:12] + '   NixOS: ' + info['nixos'] + '   Nix: ' + info['nix'])
    print('\n' + title + '\n')

def describe(row):
    print(safe(row['model'], 48) + '  ' + format(row['size'] / 10**9, '.1f') + ' GB  ' + safe(row['path']))
    print('識別番号: ' + safe(row['serial'] or '不明'))
    print('現在の領域: ' + partition_text(row))

def observe(info):
    previous = None
    while True:
        state = rpc('STATUS')
        if state['phase'] in ('verify', 'write', 'readback', 'boot'):
            # Keep phase and actual byte counts visible, without scrolling.
            marker = (state['phase'], int(state.get('done', 0) / 10**8))
            if marker != previous:
                header(info, '3 / 4  インストール中')
                print(state['message'])
                print('\n処理済み: %.2f / %.2f GB' % (state.get('done', 0) / 10**9, state.get('total', 0) / 10**9))
                print('\n電源と USB を接続したままお待ちください。')
                previous = marker
            time.sleep(1)
            continue
        if state['phase'] == 'complete':
            header(info, '4 / 4  インストールが完了しました')
            describe(state['target'])
            print('\n全長照合・UEFI 起動登録が完了しました。（INSTALL COMPLETE）')
            print('起動項目: ' + state['bootEntry'])
            print('\n電源を切って USB を抜き、PC を起動してください。')
            print('初回起動では、データ保護のパスフレーズを設定します。')
            print('\n1. 電源を切る（推奨）   2. 再起動   0. 保存先の画面へ戻る')
            answer = input('操作する番号を入力して Enter: ').strip()
            if answer in ('1', '2'):
                rpc('POWEROFF' if answer == '1' else 'REBOOT')
                print('終了処理中です。お待ちください。')
                while True: time.sleep(10)
            if answer == '0': return
            continue
        if state['phase'] == 'failed':
            header(info, 'インストールを完了できませんでした')
            print(state['message'])
            print('診断コード: ' + safe(state.get('error', 'unknown'), 300))
            if state.get('writeStarted'): print('保存先は変更されています。元の OS のままとは限りません。')
            input('\nEnter で保存先の画面へ戻ります: ')
        return

def main():
    info = json.loads(Path(os.environ['OTEHON_INSTALLER_INFO']).read_text())
    notice = ''
    seen_complete = False
    while True:
        try:
            state = rpc('STATUS')
            if state['phase'] in ('verify', 'write', 'readback', 'boot'):
                observe(info)
                seen_complete = True
                continue
            if state['phase'] == 'complete' and not seen_complete:
                observe(info)
                seen_complete = True
                continue
            if state['phase'] == 'failed':
                notice = state['message'] + (' 保存先は変更されている可能性があります。' if state.get('writeStarted') else '')
            inventory = rpc('LIST')
            rows = choices(inventory['devices'], inventory['rawBytes'])
            header(info, '1 / 4  インストール先を選んでください')
            print('USB から起動中です。保存先にはまだ書き込みません。')
            if notice: print('\n' + notice)
            for number, row in enumerate(rows, 1):
                print('\n%d. %s  %.1f GB  %s' % (number, safe(row['model'], 48), row['size'] / 10**9, safe(row['path'])))
                print('   ' + (unavailable(row, inventory['rawBytes']) or 'インストールできます') + ' | 領域: ' + partition_text(row))
            print('\n0. ディスク一覧を更新')
            answer = input('保存先の番号を入力して Enter: ').strip()
            if answer in ('', '0'):
                notice = '一覧を更新しました。保存先は変更していません。'
                continue
            row = choose(rows, answer)
            if row is None:
                notice = '表示されている番号を入力してください。保存先は変更していません。'
                continue
            reason = unavailable(row, inventory['rawBytes'])
            if reason:
                notice = reason + '。保存先は変更していません。'
                continue
            selected = rpc('SELECT', row['id'])
            row = selected['target']
            header(info, '2 / 4  上書きするディスクを確認してください')
            describe(row)
            print('\nこのディスクの OS とファイルをすべて消去します。')
            print('別のディスクを選ぶ場合は 0 で戻ってください。')
            print('\n1. すべて消去してインストール   0. 戻る')
            if input('実行する番号を入力して Enter: ').strip() != '1':
                notice = '中止しました。保存先は変更していません。'
                continue
            # The immutable selection ticket and serial are bound internally;
            # the person approves this displayed disk, never retypes its ID.
            rpc('INSTALL', selected['ticket'], row['serial'], 'ERASE')
            observe(info)
            seen_complete = True
            notice = ''
        except KeyboardInterrupt:
            notice = '画面を戻しました。進行中の書込みは停止しません。'
        except (OSError, ValueError, RuntimeError) as error:
            header(info, '確認が必要です')
            print(safe(str(error), 400))
            try: input('\nEnter で再確認: ')
            except (EOFError, KeyboardInterrupt): time.sleep(2)
        except EOFError:
            time.sleep(2)

if __name__ == '__main__': main()
