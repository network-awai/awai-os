// Transform only the primary backup action; keep the editor's storage checks and
// candidate format detection. Refuse to package an unfamiliar editor build.
export function androidBackupSource(source) {
  const original = /  const url = URL\.createObjectURL\(new Blob\(\[snapshot\], \{ type: 'application\/octet-stream' \}\)\);\n  const link = document\.createElement\('a'\);\n  link\.href = url; link\.download = ([^;\n]+); link\.click\(\);\n  setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 60000\);\n  fail\('バックアップのダウンロードを開始しました。'\);/g;
  const hits = [...source.matchAll(original)];
  if (hits.length !== 1) throw new Error('Expected one Office backup export path');
  return source.replace(original, (_, filename) => `  try {
    const result = await window.__TAURI__.core.invoke('save_office_backup', {
      name: ${filename}, snapshot,
    });
    if (result?.status === 'saved') fail('バックアップを保存しました。');
    else if (result?.status === 'cancelled') fail('バックアップの保存をキャンセルしました。');
    else throw Error('backup-write-failed');
  } catch (_) {
    fail('バックアップを保存できませんでした。編集中のデータは保持されています。');
  }`);
}
