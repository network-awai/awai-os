import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixCommitCount, isoWeek, ledgerProblems, median, parseArgs, parseLedger, summarize, toMarkdown, unclassified, UNKNOWN } from "./dora.mjs";

const R = "network-awai/awai-os";
const ch = (pr, mergedAt, over = {}) => ({ repo: R, pr, mergedAt, startedAt: null, fixCommits: null, ...over });

test("isoWeek follows ISO 8601, including year boundaries", () => {
  for (const [t, w] of [
    ["2026-11-15T23:59:59Z", "2026-W46"], ["2026-11-16T00:00:00Z", "2026-W47"], ["2026-11-21T00:07:39Z", "2026-W47"],
    ["2026-11-22T12:00:00Z", "2026-W47"], ["2026-11-23T00:00:00Z", "2026-W48"], ["2026-01-01T00:00:00Z", "2026-W01"],
    ["2021-01-03T12:00:00Z", "2020-W53"], ["2024-12-30T00:00:00Z", "2025-W01"], ["2027-01-03T00:00:00Z", "2026-W53"],
  ]) assert.equal(isoWeek(t), w, t);
});

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([6.5, 12.6, 22.3, 217.8]), (12.6 + 22.3) / 2);
  assert.equal(median([1, NaN, 3]), 2);
});

test("deployment frequency counts merged changes per week, oldest week first", () => {
  const rows = summarize([ch(3, "2026-11-23T01:00:00Z"), ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-20T10:00:00Z"), { repo: R, pr: 9, mergedAt: null }, { repo: "x", pr: 1, mergedAt: "2026-11-20T10:00:00Z" }]);
  assert.deepEqual(rows.map((r) => [r.week, r.deployments]), [["2026-W47", 2], ["2026-W48", 1]]);
  assert.deepEqual(summarize([]), []);
});

test("lead time is the median over changes with a known start; others are left out and counted", () => {
  const [r] = summarize([
    ch(1, "2026-11-19T11:01:04Z", { startedAt: "2026-11-19T10:48:28Z" }),
    ch(2, "2026-11-19T10:59:16Z", { startedAt: "2026-11-19T10:52:45Z" }),
    ch(3, "2026-11-19T12:50:48Z", { startedAt: "2026-11-19T12:28:32Z" }),
    ch(4, "2026-11-20T15:36:51Z", { startedAt: "2026-11-20T11:59:02Z" }),
    ch(5, "2026-11-19T06:29:52Z"),
    ch(6, "2026-11-19T06:00:00Z", { startedAt: "2026-11-19T07:00:00Z" }), // a start after the merge is not a lead time
  ]);
  assert.equal(r.leadTimeMedianMin, 17.4);
  assert.equal(r.leadTimeN, 4);
  assert.equal(r.deployments, 6);
  const [none] = summarize([ch(1, "2026-11-19T10:00:00Z")]);
  assert.equal(none.leadTimeMedianMin, UNKNOWN);
  assert.equal(none.leadTimeN, 0);
});

test("fail rate and rework rate are unknown until the week has been classified", () => {
  const changes = [ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-20T10:00:00Z"), ch(3, "2026-11-20T12:00:00Z"), ch(4, "2026-11-20T13:00:00Z")];
  let [r] = summarize(changes);
  assert.deepEqual([r.changeFailRatePct, r.reworkRatePct, r.classified], [UNKNOWN, UNKNOWN, false]);
  // Classified only up to a time inside the week: still unknown, but known failures are shown.
  const partial = parseLedger(`{"kind":"classified-through","at":"2026-11-20T11:00:00Z"}\n{"kind":"failure","repo":"${R}","pr":1}`);
  [r] = summarize(changes, partial);
  assert.deepEqual([r.changeFailRatePct, r.knownFailures, r.reworkRatePct], [UNKNOWN, 1, UNKNOWN]);
  assert.ok(toMarkdown([r]).includes("unknown (1 known)"));
  // Fully classified: a measured zero is a zero.
  const zero = parseLedger('{"kind":"classified-through","at":"2026-11-21T00:00:00Z"}');
  [r] = summarize(changes, zero);
  assert.deepEqual([r.changeFailRatePct, r.reworkRatePct, r.classified], [0, 0, true]);
  const full = parseLedger([
    '{"kind":"classified-through","at":"2026-11-20T00:00:00Z"}', '{"kind":"classified-through","at":"2026-11-21T00:00:00Z"}',
    `{"kind":"failure","repo":"${R}","pr":1,"fixed_by":{"repo":"${R}","pr":3}}`, `{"kind":"rework","repo":"${R}","pr":3}`,
    `{"kind":"rework","repo":"${R}","pr":99}`,
  ].join("\n"));
  [r] = summarize(changes, full);
  assert.deepEqual([r.changeFailRatePct, r.reworkRatePct, r.knownFailures], [25, 25, 1]);
});

test("recovery time runs from the failed change's merge to its fix's merge", () => {
  const changes = [ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-19T11:30:00Z"), ch(3, "2026-11-19T09:00:00Z"), ch(4, "2026-11-19T12:00:00Z")];
  const led = (lines) => parseLedger(lines.join("\n"));
  let [r] = summarize(changes, led([`{"kind":"failure","repo":"${R}","pr":1,"fixed_by":{"repo":"${R}","pr":2}}`]));
  assert.deepEqual([r.recoveryMedianMin, r.recoveryN], [90, 1]);
  // No fix named, a fix that is not a merged change, or a "fix" merged before the failure: no recovery time.
  [r] = summarize(changes, led([`{"kind":"failure","repo":"${R}","pr":1}`, `{"kind":"failure","repo":"${R}","pr":2,"fixed_by":{"repo":"${R}","pr":77}}`, `{"kind":"failure","repo":"${R}","pr":4,"fixed_by":{"repo":"${R}","pr":3}}`]));
  assert.deepEqual([r.recoveryMedianMin, r.recoveryN, r.knownFailures], [UNKNOWN, 0, 3]);
  [r] = summarize(changes);
  assert.equal(r.recoveryMedianMin, UNKNOWN);
});

test("clean merge rate uses only changes whose review commits are known", () => {
  let [r] = summarize([ch(1, "2026-11-19T10:00:00Z", { fixCommits: 0 }), ch(2, "2026-11-19T10:00:00Z", { fixCommits: 1 }), ch(3, "2026-11-19T10:00:00Z", { fixCommits: 0 }), ch(4, "2026-11-19T10:00:00Z")]);
  assert.deepEqual([r.cleanMergeRatePct, r.cleanMergeN], [66.7, 3]);
  [r] = summarize([ch(1, "2026-11-19T10:00:00Z")]);
  assert.deepEqual([r.cleanMergeRatePct, r.cleanMergeN], [UNKNOWN, 0]);
  assert.equal(fixCommitCount([{ messageHeadline: "AWAI-1: x" }]), 0);
  assert.equal(fixCommitCount([{ messageHeadline: "AWAI-1: x" }, { messageHeadline: "Merge main into muse/x" }, { messageHeadline: "AWAI-1 fix" }]), 1);
  assert.equal(fixCommitCount([{ messageHeadline: "Merge branch 'main'" }]), 0);
  assert.equal(fixCommitCount([]), null);
  assert.equal(fixCommitCount(undefined), null);
});

test("parseLedger ignores and counts malformed lines", () => {
  const l = parseLedger(['not json', '{"kind":"failure","repo":"x","pr":1}', `{"kind":"failure","repo":"${R}","pr":"1"}`, `{"kind":"rework","repo":"${R}","pr":0}`,
    '{"kind":"classified-through","at":"yesterday"}', '{"kind":"other"}', '', `{"kind":"failure","repo":"${R}","pr":5,"fixed_by":{"repo":"x","pr":1}}`].join("\n"));
  assert.equal(l.bad, 6);
  // The latest classified-through time wins, whatever the order of the lines.
  assert.equal(parseLedger('{"kind":"classified-through","at":"2026-11-21T00:00:00Z"}\n{"kind":"classified-through","at":"2026-11-20T00:00:00Z"}').classifiedThrough, Date.parse("2026-11-21T00:00:00Z"));
  assert.deepEqual([...l.failures], [[`${R}#5`, null]]);
  assert.equal(l.classifiedThrough, null);
  assert.equal(l.rework.size, 0);
});

test("parseArgs accepts only owned repositories and a plain date", () => {
  assert.deepEqual(parseArgs(["--repos", `${R}, cloud-itonami/itonami-agent`, "--since", "2026-11-01", "--json"]).repos, [R, "cloud-itonami/itonami-agent"]);
  for (const repos of ["NousResearch/hermes-agent", "kotoba-lang/hikari-baito-ludo", "awai-os", `${R},apache/arrow`]) assert.ok(parseArgs(["--repos", repos, "--since", "2026-11-01"]).error, repos);
  for (const since of ["yesterday", "2026-13-45", "2026-11-01T00:00:00Z", "11/01/2026"]) assert.ok(parseArgs(["--repos", R, "--since", since]).error, since);
  assert.ok(parseArgs(["--repos", R]).error);
  assert.ok(parseArgs(["--repos", R, "--since", "2026-11-01", "--force"]).error);
  assert.ok(parseArgs(["--repos"]).error);
});

test("toMarkdown prints one row per week and keeps unknown as a word", () => {
  const md = toMarkdown(summarize([ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-23T10:00:00Z", { fixCommits: 0 })]));
  assert.equal(md.split("\n").length, 4);
  assert.ok(md.includes("| 2026-W47 | 1 | unknown (0) | unknown | unknown (0) | unknown | unknown (0) |"));
  assert.ok(md.includes("| 2026-W48 | 1 | unknown (0) | unknown | unknown (0) | unknown | 100 (1) |"));
});

const R2 = "network-awai/app-kagitaba";
const led = (...lines) => parseLedger(lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));

test("a classified span covers only its repositories and only from its start", () => {
  const changes = [ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-20T10:00:00Z"), { ...ch(7, "2026-11-20T11:00:00Z"), repo: R2 }];
  const span = { kind: "classified-through", from: "2026-11-18T00:00:00Z", at: "2026-11-21T00:00:00Z" };
  // The other repository has not been looked at: the week stays unknown.
  let [r] = summarize(changes, led({ ...span, repos: [R] }));
  assert.deepEqual([r.classified, r.changeFailRatePct, r.reworkRatePct], [false, UNKNOWN, UNKNOWN]);
  [r] = summarize(changes, led({ ...span, repos: [R] }, { ...span, repos: [R2] }));
  assert.deepEqual([r.classified, r.changeFailRatePct, r.reworkRatePct], [true, 0, 0]);
  [r] = summarize(changes, led({ ...span, repos: [R, R2] }, { kind: "failure", repo: R2, pr: 7 }, { kind: "rework", repo: R, pr: 2 }));
  assert.deepEqual([r.changeFailRatePct, r.reworkRatePct], [33.3, 33.3]);
  // A change merged before the start of the span has not been looked at either.
  [r] = summarize(changes, led({ ...span, from: "2026-11-19T12:00:00Z", repos: [R, R2] }));
  assert.equal(r.classified, false);
  [r] = summarize(changes, led({ ...span, from: "2026-11-19T10:00:00Z", repos: [R, R2] }));
  assert.equal(r.classified, true);
  // Later lines extend the span; the earliest start and the latest end hold.
  [r] = summarize(changes, led({ kind: "classified-through", from: "2026-11-18T00:00:00Z", at: "2026-11-19T12:00:00Z", repos: [R, R2] }, { kind: "classified-through", from: "2026-11-19T12:00:00Z", at: "2026-11-21T00:00:00Z", repos: [R, R2] }));
  assert.equal(r.classified, true);
  // A span for all repositories still works, and a per-repository one does not shrink it.
  [r] = summarize(changes, led({ kind: "classified-through", at: "2026-11-21T00:00:00Z" }, { ...span, at: "2026-11-19T00:00:00Z", repos: [R] }));
  assert.equal(r.classified, true);
});

test("parseLedger reads reviewed lines and rejects a span it cannot trust", () => {
  const l = led({ kind: "reviewed", repo: R, pr: 4, note: "x" }, { kind: "reviewed", repo: R, pr: 0 },
    { kind: "classified-through", at: "2026-11-21T00:00:00Z", repos: [] }, { kind: "classified-through", at: "2026-11-21T00:00:00Z", repos: ["nope"] },
    { kind: "classified-through", at: "2026-11-21T00:00:00Z", repos: R }, { kind: "classified-through", from: "2026-11-22T00:00:00Z", at: "2026-11-21T00:00:00Z", repos: [R] },
    { kind: "classified-through", from: "soon", at: "2026-11-21T00:00:00Z" });
  assert.deepEqual([...l.reviewed], [`${R}#4`]);
  assert.deepEqual([l.bad, l.badLines, l.through.size], [6, [2, 3, 4, 5, 6, 7], 0]);
  // A failure with an unreadable fix still counts, and its line is reported; a second, different fix is a conflict.
  const f = led({ kind: "failure", repo: R, pr: 1, fixed_by: { repo: "x", pr: 2 } }, { kind: "failure", repo: R, pr: 3, fixed_by: { repo: R, pr: 4 } },
    { kind: "failure", repo: R, pr: 3, fixed_by: { repo: R, pr: 5 } }, { kind: "failure", repo: R, pr: 3 }, { kind: "failure", repo: R, pr: 3, fixed_by: { repo: R, pr: 4 } },
    { kind: "failure", repo: R, pr: 6 }, { kind: "failure", repo: R, pr: 6, fixed_by: { repo: R, pr: 8 } });
  assert.deepEqual([...f.failures], [[`${R}#1`, null], [`${R}#3`, `${R}#4`], [`${R}#6`, `${R}#8`]]);
  assert.deepEqual([f.bad, f.badLines, f.conflicts], [0, [1], [3]]);
});

test("recovery time can use a fix that is not a bot change", () => {
  const changes = [ch(1, "2026-11-19T10:00:00Z")];
  const l = led({ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 50 } });
  let [r] = summarize(changes, l);
  assert.deepEqual([r.recoveryMedianMin, r.recoveryN], [UNKNOWN, 0]);
  [r] = summarize(changes, l, new Map([[`${R}#50`, "2026-11-19T10:45:00Z"]]));
  assert.deepEqual([r.recoveryMedianMin, r.recoveryN], [45, 1]);
  [r] = summarize(changes, l, new Map([[`${R}#50`, "never"]]));
  assert.equal(r.recoveryN, 0);
});

test("unclassified lists the changes outside every span, oldest first", () => {
  const changes = [ch(3, "2026-11-22T10:00:00Z"), ch(1, "2026-11-10T10:00:00Z"), ch(2, "2026-11-19T10:00:00Z"), { ...ch(7, "2026-11-19T11:00:00Z"), repo: R2 }, { repo: R, pr: 9, mergedAt: null }];
  const l = led({ kind: "classified-through", from: "2026-11-18T00:00:00Z", at: "2026-11-21T00:00:00Z", repos: [R] });
  assert.deepEqual(unclassified(changes, l).map((c) => `${c.repo}#${c.pr}`), [`${R}#1`, `${R2}#7`, `${R}#3`]);
  assert.equal(unclassified(changes, l)[0].t, undefined);
  assert.equal(unclassified(changes, parseLedger("")).length, 4);
  assert.deepEqual(unclassified(changes, led({ kind: "classified-through", at: "2026-11-23T00:00:00Z" })), []);
});

test("ledgerProblems: a span may not cover a change nobody wrote a line for", () => {
  const now = Date.parse("2026-11-21T07:00:00Z");
  const changes = [ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-19T11:00:00Z"), ch(3, "2026-11-19T12:00:00Z"), ch(4, "2026-11-22T12:00:00Z")];
  const span = { kind: "classified-through", from: "2026-11-18T00:00:00Z", at: "2026-11-21T00:00:00Z", repos: [R] };
  const ok = [span, { kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 2 } }, { kind: "rework", repo: R, pr: 2 }, { kind: "reviewed", repo: R, pr: 3 }];
  assert.deepEqual(ledgerProblems(changes, led(...ok), new Map(), now), []);
  assert.deepEqual(ledgerProblems(changes, parseLedger(""), new Map(), now), []);
  for (const drop of [1, 2, 3]) {
    const p = ledgerProblems(changes, led(...ok.filter((_, i) => i !== drop)), new Map(), now);
    assert.equal(p.length, 1, String(drop));
    assert.match(p[0], new RegExp(`${R}#${drop} is inside the classified span but has no ledger line`));
  }
  // The change after the span needs no line; moving the span over it without one is a problem.
  const moved = ledgerProblems(changes, led(...ok, { ...span, at: "2026-11-23T00:00:00Z" }), new Map(), Date.parse("2026-11-24T00:00:00Z"));
  assert.deepEqual(moved, [`${R}#4 is inside the classified span but has no ledger line`]);
});

test("ledgerProblems: bad lines, conflicts, a span in the future, and fixes that do not hold", () => {
  const now = Date.parse("2026-11-21T07:00:00Z");
  const changes = [ch(1, "2026-11-19T10:00:00Z"), ch(2, "2026-11-19T09:00:00Z"), ch(3, "2026-11-19T12:00:00Z")];
  const has = (lines, re, fix = new Map()) => assert.ok(ledgerProblems(changes, led(...lines), fix, now).some((p) => re.test(p)), String(re));
  has(["not json"], /line\(s\) 1: not a valid ledger line/);
  has([{ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 3 } }, { kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 2 } }], /line\(s\) 2: a different fix/);
  has([{ kind: "classified-through", at: "2026-11-21T07:00:01Z", repos: [R] }], new RegExp(`classified-through for ${R} is in the future`));
  has([{ kind: "classified-through", at: "2026-12-01T00:00:00Z" }], /for all repositories is in the future/);
  assert.deepEqual(ledgerProblems([], led({ kind: "classified-through", at: "2026-11-21T07:00:00Z" }), new Map(), now), []);
  has([{ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 2 } }], new RegExp(`${R}#1: its fix ${R}#2 was merged before it`));
  has([{ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 50 } }], /its fix .*#50 is not a merged pull request/);
  has([{ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 50 } }], /#50 was merged before it/, new Map([[`${R}#50`, "2026-11-19T09:59:59Z"]]));
  const fine = [{ kind: "failure", repo: R, pr: 1, fixed_by: { repo: R, pr: 50 } }, { kind: "failure", repo: R, pr: 2, fixed_by: { repo: R, pr: 3 } }, { kind: "failure", repo: R, pr: 3 }, { kind: "failure", repo: R, pr: 99, fixed_by: { repo: R, pr: 98 } }];
  assert.deepEqual(ledgerProblems(changes, led(...fine), new Map([[`${R}#50`, "2026-11-19T10:00:00Z"]]), now), []);
});

test("the checked-in ledger is well formed", () => {
  const text = readFileSync(new URL("./metrics/dora-ledger.jsonl", import.meta.url), "utf8");
  const l = parseLedger(text);
  assert.deepEqual([l.badLines, l.conflicts], [[], []]);
  assert.ok(!l.through.has("*"), "every classified-through line names its repositories");
  for (const [r, t] of l.through) assert.ok(Number.isFinite(l.from.get(r)) && l.from.get(r) < t, r);
  // Every line says who looked, when, and why.
  for (const line of text.split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    assert.match(e.by ?? "", /\S/, line);
    assert.match(e.on ?? "", /^\d{4}-\d{2}-\d{2}$/, line);
    if (e.kind !== "classified-through") assert.ok(String(e.note ?? "").length >= 20, line);
  }
});

test("parseArgs reads --check and --unclassified", () => {
  const o = parseArgs(["--repos", R, "--since", "2026-11-01", "--check", "--unclassified"]);
  assert.deepEqual([o.check, o.unclassified, o.json], [true, true, false]);
  const d = parseArgs(["--repos", R, "--since", "2026-11-01"]);
  assert.deepEqual([d.check, d.unclassified, d.ledger], [false, false, null]);
});
