"""Every Japanese string the screens show (the design's copy). Backend messages live in core.MESSAGES."""

T = {
    "rail": ["インストール先", "内容の確認", "インストール", "完了"], "current": "現在", "done": "済み",
    "release": "Awai OS Meiji", "product": "PC に\nインストール", "hint": "Tab で項目を移動\nEnter で選択",
    "pickTitle": "インストール先を選ぶ", "pickSub": "Awai OS を入れる空の内蔵 SSD を選んでください。",
    "pickSubSelected": "選んだ SSD の内容を確認してから、書き込みに進みます。",
    "pickNote": "既存の区画があるディスクは、選択できない理由を一覧に表示します。",
    "internal": "内蔵 SSD", "free": "空きディスク", "okTag": "選択可能", "selTag": "選択済み", "offTag": "選択不可",
    "detail": "デバイスの詳細", "poweroff": "電源を切る", "powerAsk": "もう一度押すと電源を切ります", "review": "内容を確認",
    "back": "戻る", "reboot": "再起動", "refresh": "一覧を更新", "reviewTitle": "インストール内容を確認",
    "reviewSub": "書き込み先と内容を確認してください。", "target": "書き込み先", "plan": "Awai OS とユーザーデータ用の区画を作成",
    "planBody1": "選択した空の SSD に区画を作成します。", "planBody2": "この USB は起動用の媒体として使用します。",
    "typePrompt": "確認のため、デバイス名を入力してください", "typeLabel": "デバイス名", "go": "この SSD にインストール",
    "busyTitle": "インストールしています", "busySub": "電源を入れたまま、USB を接続してお待ちください。", "dest": "導入先",
    "steps": ["イメージの確認", "SSD への書き込み", "書き込んだ内容の読み戻し"], "sDone": "完了", "sActive": "進行中", "sWait": "待機中",
    "doneTitle": "インストールが完了しました", "doneSub": "SSD に書き込んだ内容の読み戻しが完了しました。", "verified": "確認済み",
    "parts": "区画を確認", "rebootTitle": "再起動して Awai OS をはじめる",
    "rebootBody": "起動画面に戻ったら USB を抜き、内蔵 SSD を選んでください。",
    "noneTitle": "インストール先が見つかりません", "noneSub": "既存のデータを保護するため、一覧で理由を確認できます。",
    "noneBox": "空の内蔵 SSD を接続し、一覧を更新してください。", "noneBody": "ここからディスクの消去は実行できません。",
    "failTitle": "インストールできませんでした", "failedStep": "失敗した手順",
    "notWritten": "SSD への書き込み: 行われていません。SSD は変更されていません。",
    "written": "SSD への書き込み: 始まっていました。SSD の内容が途中の状態になっている可能性があります。",
    "again": "最初に戻る", "rebootBusy": "インストール中は再起動できません。", "detailLabel": "詳細", "loadFail": "状態を取得できませんでした。",
    "reasons": {"boot-medium": "この PC を起動した USB", "has-partitions": "既存の区画あり", "not-nvme": "NVMe SSD ではありません",
                "not-block": "ディスクではありません", "not-disk": "ディスク全体ではありません", "read-only": "読み取り専用",
                "sector-size": "512 バイトセクターではありません", "mounted": "使用中", "signatures": "既存のデータあり",
                "boot-unknown": "起動した USB を特定できません", "inspect-failed": "情報を取得できません"},
}


def all_text():
    """All strings, for the glyph-coverage check."""
    out = []

    def walk(v):
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
    walk(T)
    return "".join(out)
