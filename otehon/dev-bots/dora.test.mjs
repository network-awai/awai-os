import test from "node:test";
import assert from "node:assert/strict";
import { fixCommitCount, isoWeek, median, parseArgs, parseLedger, summarize, toMarkdown, UNKNOWN } from "./dora.mjs";

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
