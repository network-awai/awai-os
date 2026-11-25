"""Every Japanese string the screens show (the revised Figma design, rev2). Backend messages live in core.MESSAGES.
Sentences are whole strings with named placeholders; nothing is assembled from translated fragments."""

T = {
    "rail": ["SSD を選ぶ", "内容を確認", "インストール", "完了"],
    "release": "Awai OS Meiji", "releaseShort": "Awai OS", "product": "PC に", "product2": "インストール",
    "pickTitle": "どの SSD に入れますか？", "pickSubOne": "空の SSD が見つかりました。ほかのディスクには触れません。",
    "pickSubMany": "入れる SSD を1つ選んでください。",
    "internal": "内蔵 SSD", "free": "空です", "okTag": "選べます", "selTag": "✓ 選択中", "offTag": "使えません",
    "serialTail": "末尾 {tail}", "dot": "・",
    "poweroff": "電源を切る", "powerAsk": "もう一度押すと電源を切ります", "review": "内容を確認",
    "back": "戻る", "reboot": "再起動", "refresh": "もう一度さがす", "again": "最初に戻る",
    "reviewTitle": "この内容で入れます", "reviewSub": "よければ「この SSD にインストール」を押してください。",
    "target": "入れる先", "plan": "入れるもの",
    "planBody1": "Awai OS Meiji と、あなたのデータ用の場所を作ります。",
    "planBody2": "途中で電源を切らないでください。", "planBody3": "この USB には何も書き込みません。",
    "go": "この SSD にインストール",
    "askTitle1": "この SSD に Awai OS を入れます。", "askTitle2": "よろしいですか？", "askFact": "内蔵 SSD　{size}（空です）",
    "askPower": "途中で電源を切らないでください。", "askCancel": "やめる", "askGo": "インストールする",
    "busyTitle": "インストールしています", "busySub": "電源を入れたまま、USB を挿したままお待ちください。",
    "busyTag": "入れています", "busyHint": "この間は操作できません。画面はこのままにしてください。",
    "step1": "1　イメージの確認", "step2": "2　SSD への書き込み", "step3": "3　書き込んだ内容の確かめ",
    "sDone": "✓", "sWait": "まだ", "pct": "{pct}%",
    "doneTitle": "インストールが完了しました", "doneSub": "書き込んだ内容の確かめも終わりました。", "verified": "✓ 確認済み",
    "parts": "{n} 区画を確認", "rebootTitle": "USB を抜いて、再起動してください", "rebootBody": "再起動すると Awai OS が始まります。",
    "noneTitle": "入れられる SSD がありません", "noneSub": "データを守るため、空の SSD にだけ入れられます。",
    "noneBox": "空の SSD をつないで「もう一度さがす」を押してください", "noneBody": "この画面からディスクの中身は消せません。",
    "failTitle": "インストールできませんでした",
    "failSubNone": "SSD への書き込みは始まっていません。SSD は変わっていません。",
    "failSubWritten": "SSD への書き込みは始まっていました。SSD の中身が途中の状態になっている可能性があります。",
    "supportNo": "サポート用の番号：{code}", "failedStep": "失敗した手順：{step}",
    "rebootBusy": "インストール中は再起動できません。", "loadFail": "状態を取得できませんでした。",
    "hintDo": "Enter：{action}", "hintKeys": "↑↓：選ぶ", "hintMouse": "マウスも使えます", "hintEsc": "Esc：{action}",
    "hintAsk": "←→：選ぶ　　Enter：決定　　Esc：やめる", "hintSelect": "選んで次へ",
    "reasons": {"boot-medium": "この PC を起動した USB", "has-partitions": "すでに使われています", "not-nvme": "NVMe SSD ではありません",
                "not-block": "ディスクではありません", "not-disk": "ディスク全体ではありません", "read-only": "読み取り専用です",
                "sector-size": "512 バイトセクターではありません", "mounted": "使用中です", "signatures": "すでに使われています",
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
