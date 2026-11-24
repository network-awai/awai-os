"use strict";
(function () {
  const token = location.hash.slice(1);
  const T = {
    rail: ["インストール先", "内容の確認", "インストール", "完了"], current: "現在", done: "済み",
    pickTitle: "インストール先を選ぶ", pickSub: "Awai OS を入れる空の内蔵 SSD を選んでください。",
    pickNote: "既存の区画があるディスクは、選択できない理由を一覧に表示します。",
    internal: "内蔵 SSD", free: "空きディスク", okTag: "選択可能", selTag: "選択済み", offTag: "選択不可",
    detail: "デバイスの詳細", poweroff: "電源を切る", review: "内容を確認", back: "戻る", reboot: "再起動",
    refresh: "一覧を更新", reviewTitle: "インストール内容を確認", reviewSub: "書き込み先と内容を確認してください。",
    target: "書き込み先", plan: "Awai OS とユーザーデータ用の区画を作成",
    planBody1: "選択した空の SSD に区画を作成します。", planBody2: "この USB は起動用の媒体として使用します。",
    typePrompt: "確認のため、デバイス名を入力してください", typeLabel: "デバイス名", go: "この SSD にインストール",
    busyTitle: "インストールしています", busySub: "電源を入れたまま、USB を接続してお待ちください。", dest: "導入先",
    steps: ["イメージの確認", "SSD への書き込み", "書き込んだ内容の読み戻し"], sDone: "完了", sActive: "進行中", sWait: "待機中",
    doneTitle: "インストールが完了しました", doneSub: "SSD に書き込んだ内容の読み戻しが完了しました。", verified: "確認済み",
    parts: "区画を確認", rebootTitle: "再起動して Awai OS をはじめる",
    rebootBody: "起動画面に戻ったら USB を抜き、内蔵 SSD を選んでください。",
    noneTitle: "インストール先が見つかりません", noneSub: "既存のデータを保護するため、一覧で理由を確認できます。",
    noneBox: "空の内蔵 SSD を接続し、一覧を更新してください。", noneBody: "ここからディスクの消去は実行できません。",
    failTitle: "インストールできませんでした", failedStep: "失敗した手順", step: "手順",
    notWritten: "SSD への書き込み: 行われていません。SSD は変更されていません。",
    written: "SSD への書き込み: 始まっていました。SSD の内容が途中の状態になっている可能性があります。",
    again: "最初に戻る", detailLabel: "詳細", loadFail: "状態を取得できませんでした。",
    reasons: { "boot-medium": "この PC を起動した USB", "has-partitions": "既存の区画あり", "not-nvme": "NVMe SSD ではありません",
      "not-block": "ディスクではありません", "not-disk": "ディスク全体ではありません", "read-only": "読み取り専用",
      "sector-size": "512 バイトセクターではありません", "mounted": "使用中", "signatures": "既存のデータあり",
      "boot-unknown": "起動した USB を特定できません", "inspect-failed": "情報を取得できません" },
  };
  const $ = (id) => document.getElementById(id);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; // CSSOM: allowed by the strict CSP
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };
  const gib = (n) => (n / 2 ** 30).toFixed(1) + " GiB";
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: { "X-Awai-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    let data = {};
    try { data = await r.json(); } catch (e) { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  };
  const ui = { screen: "", disks: [], selected: null, ticket: null, state: {}, message: "", poll: null };

  function rail(active) { // active: 0..3, all earlier steps are done
    const ol = $("steps"); ol.replaceChildren();
    T.rail.forEach((label, i) => ol.append(h("li", { class: i === active ? "current" : "", "aria-current": i === active ? "step" : null },
      h("span", {}, label), i === active ? h("span", { class: "tag" }, T.current) : i < active ? h("span", { class: "tag" }, T.done) : null)));
  }
  function frame(active, title, sub, body, actions) {
    rail(active);
    $("title").textContent = title; $("sub").textContent = sub;
    $("body").replaceChildren(...body.filter(Boolean)); $("actions").replaceChildren(...actions.filter(Boolean));
  }
  const diskCard = (d, extra, detail) => {
    const shown = d.problems.includes("boot-medium") ? ["boot-medium"] : d.problems;
    const reasons = shown.map((p) => T.reasons[p] || T.reasons["inspect-failed"]).join("、");
    const nvme = /^nvme/.test(d.name);
    const sub = [gib(d.size), nvme ? "NVMe" : "", extra ? detail : d.eligible ? T.free : reasons].filter(Boolean).join(" · ");
    const title = nvme ? T.internal : (d.model || d.name);
    if (!d.eligible || extra) {
      return h("div", { class: "card " + (d.eligible ? "selected" : "off"), "aria-disabled": d.eligible ? null : "true" },
        h("span", {}, h("span", { class: "t" }, title), h("br"), h("span", { class: "s" }, sub)), h("span", { class: "tag" }, extra || T.offTag));
    }
    const sel = ui.selected === d.name;
    return h("button", { class: "card" + (sel ? " selected" : ""), type: "button", "aria-pressed": String(sel), "data-name": d.name,
      onclick: () => { ui.selected = sel ? null : d.name; ui.message = ""; showDisks(); focusCard(d.name); } },
      h("span", {}, h("span", { class: "t" }, title), h("br"), h("span", { class: "s" }, sub)),
      h("span", { class: "tag" }, sel ? T.selTag : T.okTag));
  };
  function focusCard(name) {
    const c = (name && document.querySelector('button.card[data-name="' + name + '"]')) || document.querySelector("button.card[aria-pressed=true]") || document.querySelector("button.card");
    if (c) c.focus();
  }
  const power = (label) => h("button", { class: "link", type: "button", disabled: ui.screen === "progress", onclick: doPower("poweroff") }, label);
  const doPower = (what) => async () => { const r = await api("POST", "/api/" + what, {}); if (!r.ok) { ui.message = (r.data && r.data.ja) || T.loadFail; render(); } };
  const alertLine = () => ui.message ? [h("p", { class: "alert", role: "alert" }, ui.message)] : [];

  function showDisks() {
    const eligible = ui.disks.filter((d) => d.eligible);
    if (ui.selected && !eligible.some((d) => d.name === ui.selected)) ui.selected = null;
    const none = eligible.length === 0;
    ui.screen = none ? "none" : "pick";
    const sel = ui.disks.find((d) => d.name === ui.selected);
    const refresh = h("button", { class: "btn", type: "button", onclick: loadDisks }, T.refresh);
    if (none) {
      frame(0, T.noneTitle, T.noneSub, [...ui.disks.map((d) => diskCard(d)),
        h("div", { class: "note err" }, h("b", {}, T.noneBox), h("span", {}, T.noneBody)), ...alertLine()], [power(T.poweroff), refresh]);
    } else {
      frame(0, T.pickTitle, sel ? "選んだ SSD の内容を確認してから、書き込みに進みます。" : T.pickSub,
        [...ui.disks.map((d) => diskCard(d)), h("p", { class: "caption" }, sel ? T.detail + "  /dev/" + sel.name + (sel.model ? " · " + sel.model : "") : T.pickNote), ...alertLine()],
        [power(T.poweroff), h("button", { class: "btn", type: "button", disabled: !sel, onclick: toReview }, T.review)]);
    }
  }
  async function loadDisks() {
    const r = await api("GET", "/api/disks");
    if (!r.ok) { ui.message = T.loadFail; ui.disks = []; } else ui.disks = r.data.disks;
    showDisks(); $("title").focus();
  }
  async function toReview() {
    const r = await api("POST", "/api/review", { device: ui.selected });
    if (!r.ok) { ui.message = (r.data && r.data.ja) || T.loadFail; await loadDisks(); return; }
    ui.ticket = r.data.ticket; ui.message = ""; showReview();
  }
  function showReview() {
    ui.screen = "review";
    const d = ui.disks.find((x) => x.name === ui.selected);
    const input = h("input", { id: "typed", type: "text", autocomplete: "off", spellcheck: "false", "aria-label": T.typeLabel, oninput: () => { go.disabled = input.value !== d.name; } });
    const go = h("button", { class: "btn", type: "button", disabled: true, onclick: () => start(input.value) }, T.go);
    frame(1, T.reviewTitle, T.reviewSub, [diskCard(Object.assign({}, d, { eligible: true }), T.target, "/dev/" + d.name),
      h("div", { class: "note" }, h("b", {}, T.plan), h("span", {}, T.planBody1), h("span", {}, T.planBody2)),
      h("label", { class: "confirm", for: "typed" }, T.typePrompt, h("span", { class: "caption" }, T.detail + "  /dev/" + d.name), input), ...alertLine()],
      [h("button", { class: "link", type: "button", onclick: () => { ui.ticket = null; showDisks(); focusCard(); } }, T.back), go]);
    input.focus();
  }
  async function start(typed) {
    const r = await api("POST", "/api/install", { ticket: ui.ticket, typed });
    ui.ticket = null;
    if (!r.ok) { ui.message = (r.data && r.data.ja) || T.loadFail; await loadDisks(); return; }
    follow();
  }
  function follow() { clearInterval(ui.poll); poll(); ui.poll = setInterval(poll, 700); }
  async function poll() {
    const r = await api("GET", "/api/install");
    if (!r.ok) return;
    ui.state = r.data;
    if (r.data.state === "running") return showProgress();
    clearInterval(ui.poll);
    if (r.data.state === "done") return showDone();
    if (r.data.state === "failed") return showFailed();
    ui.screen === "progress" ? loadDisks() : null;
  }
  const stepLine = (i, st) => {
    const status = st.step > i + 1 ? "done" : st.step === i + 1 ? "active" : "wait";
    const pct = Math.round((st.fraction || 0) * 100);
    return [h("div", { class: "stepline" + (status === "active" ? " active" : "") }, h("span", {}, (i + 1) + " " + T.steps[i]),
      h("span", { class: "st" }, status === "done" ? T.sDone : status === "active" ? T.sActive : T.sWait)),
      status === "active" ? h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": T.steps[i] }, h("i", { style: "width:" + pct + "%" })) : null,
      status === "active" ? h("div", { class: "pct" }, pct + "%") : null];
  };
  const stateDisk = (st, tag, sub) => {
    const d = ui.disks.find((x) => x.name === st.device) || { name: st.device || "", size: 0, model: "", problems: [], eligible: true, path: "/dev/" + st.device, tran: "nvme" };
    return diskCard(Object.assign({}, d, { eligible: true }), tag);
  };
  function showProgress() {
    const first = ui.screen !== "progress"; ui.screen = "progress";
    const st = ui.state;
    frame(2, T.busyTitle, T.busySub, [stateDisk(st, T.dest), ...[0, 1, 2].flatMap((i) => stepLine(i, st))], [power(T.poweroff)]);
    if (first) $("title").focus();
  }
  function showDone() {
    ui.screen = "done"; const st = ui.state;
    const d = ui.disks.find((x) => x.name === st.device);
    const card = h("div", { class: "card selected" }, h("span", {}, h("span", { class: "t" }, T.internal), h("br"),
      h("span", { class: "s" }, (d ? gib(d.size) + " · NVMe · " : "") + st.partitions + " " + T.parts)), h("span", { class: "tag" }, T.verified));
    frame(3, T.doneTitle, T.doneSub, [card, h("div", { class: "note" }, h("b", {}, T.rebootTitle), h("span", {}, T.rebootBody)), ...alertLine()],
      [h("span"), h("button", { class: "btn", type: "button", onclick: doPower("reboot") }, T.reboot)]);
    $("title").focus();
  }
  function showFailed() {
    ui.screen = "failed"; const st = ui.state, e = st.error || {};
    const wrote = st.written === "started";
    const buttons = [wrote ? h("span") : h("button", { class: "link", type: "button", onclick: dismiss }, T.again),
      h("button", { class: "btn", type: "button", onclick: doPower("poweroff") }, T.poweroff)];
    frame(2, T.failTitle, T.failedStep + ": " + (e.step || 1) + " " + (e.stepJa || ""), [
      h("div", { class: "note err" }, h("b", {}, e.ja || ""), h("span", {}, T.detailLabel + ": " + (e.code || ""))),
      h("div", { class: "note" }, h("span", {}, wrote ? T.written : T.notWritten)), ...alertLine()], buttons);
    $("title").focus();
  }
  async function dismiss() { await api("POST", "/api/dismiss", {}); ui.selected = null; loadDisks(); }

  function render() { ({ pick: showDisks, none: showDisks, review: showReview, progress: showProgress, done: showDone, failed: showFailed })[ui.screen](); }

  async function boot() {
    const r = await api("GET", "/api/install");
    if (r.ok) {
      ui.state = r.data;
      if (r.data.state === "running") { await preload(); return follow(); }
      if (r.data.state === "done") { await preload(); return showDone(); }
      if (r.data.state === "failed") { await preload(); return showFailed(); }
    }
    loadDisks();
  }
  async function preload() { const r = await api("GET", "/api/disks"); if (r.ok) ui.disks = r.data.disks; }
  boot();
})();
