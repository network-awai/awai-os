import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOSHIKI_KEY,
  addBot,
  addCircle,
  addProposal,
  addRole,
  assignRole,
  blankState,
  circlePath,
  computeSize,
  myRoles,
  personNameForAccount,
  subtreeRoles,
  decideProposal,
  loadSoshiki,
  moveCircle,
  parseList,
  removeBot,
  removeCircle,
  removeRole,
  saveSoshiki,
  seedState,
  settleSoshiki,
  updateBot,
} from "../src/soshiki.js";

const circle = (state, name, purpose = "目的", parentId = null) => {
  const done = addCircle(state, { name, purpose, parentId });
  assert.equal(done.error, undefined);
  return done.state;
};

test("the seed builds a nested org with a bot-filled role", () => {
  const state = seedState();
  assert.equal(state.circles.length, 3);
  assert.equal(state.roles.length, 3);
  assert.equal(state.bots.length, 1);
  const size = computeSize(state);
  assert.equal(size.totals.circles, 3);
  assert.equal(size.totals.roles, 3);
  assert.equal(size.totals.filled, 1);
  assert.equal(size.totals.open, 2);
  assert.equal(size.totals.bots, 1);
  const general = size.rows.find((row) => row.name === "全体サークル");
  assert.equal(general.subtreeRoles, 3);
  assert.equal(general.subtreeMembers, 1);
});

test("circle names and parents are validated", () => {
  let state = blankState();
  assert.equal(addCircle(state, { name: "", purpose: "目的", parentId: null }).error, "bad-name");
  assert.equal(addCircle(state, { name: "A", purpose: "", parentId: null }).error, "bad-purpose");
  assert.equal(addCircle(state, { name: "A", purpose: "目的", parentId: "c9" }).error, "unknown-parent");
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = circle(state, "子", "目的", general);
  const child = state.circles.find((item) => item.name === "子").id;
  assert.equal(moveCircle(state, { id: general, parentId: child }).error, "bad-parent");
  assert.equal(moveCircle(state, { id: child, parentId: child }).error, "bad-parent");
  const moved = moveCircle(state, { id: child, parentId: null });
  assert.equal(moved.error, undefined);
  assert.equal(moved.state.circles.find((item) => item.id === child).parentId, null);
});

test("a circle with children or roles cannot be removed", () => {
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = circle(state, "子", "目的", general);
  assert.equal(removeCircle(state, general).error, "circle-has-children");
  const child = state.circles.find((item) => item.name === "子").id;
  const withRole = addRole(state, { circleId: child, name: "見守り", purpose: "見守る", accountabilities: [], skills: [] });
  state = withRole.state;
  assert.equal(removeCircle(state, child).error, "circle-not-empty");
  state = removeRole(state, state.roles[0].id).state;
  state = removeCircle(state, child).state;
  assert.equal(state.circles.length, 1);
});

test("roles assign to bots and people, and unassign cleanly", () => {
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = addRole(state, { circleId: general, name: "記録係", purpose: "記録する", accountabilities: ["記録"], skills: ["notes"] }).state;
  const roleId = state.roles[0].id;
  state = addBot(state, { name: "Manimani", purpose: "", skills: [], circleIds: [general], roleIds: [] }).state;
  state = assignRole(state, { roleId, assignee: { kind: "bot", name: "Manimani" } }).state;
  assert.equal(state.roles[0].assignee.name, "Manimani");
  assert.ok(state.bots[0].roleIds.includes(roleId));
  state = assignRole(state, { roleId, assignee: { kind: "person", name: "Jun" } }).state;
  assert.equal(state.roles[0].assignee.name, "Jun");
  assert.ok(!state.bots[0].roleIds.includes(roleId));
  const size = computeSize(state);
  assert.equal(size.totals.people, 1);
  assert.equal(size.totals.filled, 1);
  state = assignRole(state, { roleId, assignee: null }).state;
  assert.equal(state.roles[0].assignee, null);
  assert.equal(computeSize(state).totals.open, 1);
});

test("bot profiles validate names, skills and approval", () => {
  let state = seedState();
  assert.equal(addBot(state, { name: "Manimani", purpose: "", skills: [] }).error, "bot-exists");
  assert.equal(addBot(state, { name: "", purpose: "", skills: [] }).error, "bad-name");
  assert.equal(addBot(state, { name: "New", purpose: "", skills: [], approval: "maybe" }).error, "bad-approval");
  const botId = state.bots[0].id;
  assert.equal(updateBot(state, { id: botId, approval: "maybe" }).error, "bad-approval");
  state = updateBot(state, { id: botId, purpose: "更新", skills: ["a", "b"], approval: "ask" }).state;
  assert.equal(state.bots[0].purpose, "更新");
  assert.deepEqual(state.bots[0].skills, ["a", "b"]);
  state = removeBot(state, botId).state;
  assert.equal(state.bots.length, 0);
  assert.equal(state.roles.find((role) => role.name === "見守り").assignee, null);
});

test("proposals open and then close once", () => {
  let state = blankState();
  state = addProposal(state, { title: "見守りを二人制に", detail: "夜間も見る" }).state;
  const id = state.proposals[0].id;
  assert.equal(state.proposals[0].status, "open");
  state = decideProposal(state, { id, accept: true }).state;
  assert.equal(state.proposals[0].status, "accepted");
  assert.equal(decideProposal(state, { id, accept: false }).error, "proposal-closed");
});

test("size rows carry depth, fill rate and subtree sums", () => {
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = circle(state, "子", "目的", general);
  const child = state.circles.find((item) => item.name === "子").id;
  state = addRole(state, { circleId: general, name: "R1", purpose: "p", assignee: { kind: "person", name: "A" } }).state;
  state = addRole(state, { circleId: child, name: "R2", purpose: "p" }).state;
  const size = computeSize(state);
  assert.equal(size.maxDepth, 1);
  const row = size.rows.find((item) => item.id === general);
  assert.equal(row.directRoles, 1);
  assert.equal(row.subtreeRoles, 2);
  assert.equal(row.fillRate, 1);
  const kid = size.rows.find((item) => item.id === child);
  assert.equal(kid.depth, 1);
  assert.equal(kid.fillRate, 0);
});

test("circlePath returns the root-to-circle breadcrumb for zoom", () => {
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = circle(state, "子", "目的", general);
  const child = state.circles.find((item) => item.name === "子").id;
  state = circle(state, "孫", "目的", child);
  const grand = state.circles.find((item) => item.name === "孫").id;
  assert.deepEqual(circlePath(state, grand).map((item) => item.name), ["全体", "子", "孫"]);
  assert.deepEqual(circlePath(state, general).map((item) => item.name), ["全体"]);
  assert.deepEqual(circlePath(state, "c9"), []);
});

test("the signed-in person has a readable name and a My Roles list", () => {
  assert.equal(personNameForAccount(null), null);
  assert.equal(personNameForAccount(""), null);
  assert.equal(personNameForAccount("did:key:zShort"), "did:key:zShort");
  const long = "did:pkh:eip155:1:0x0000000000000000000000000000000000000001";
  assert.equal(personNameForAccount(long), `${long.slice(0, 14)}…${long.slice(-8)}`);
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  const me = personNameForAccount(long);
  state = addRole(state, { circleId: general, name: "記録係", purpose: "記録する", assignee: { kind: "person", name: me } }).state;
  state = addRole(state, { circleId: general, name: "見守り", purpose: "見守る", assignee: { kind: "bot", name: "Manimani" } }).state;
  const mine = myRoles(state, me);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, "記録係");
  assert.deepEqual(myRoles(state, "someone-else"), []);
  assert.deepEqual(myRoles(state, null), []);
});

test("subtreeRoles collects the circle and its descendants", () => {
  let state = blankState();
  state = circle(state, "全体");
  const general = state.circles[0].id;
  state = circle(state, "子", "目的", general);
  const child = state.circles.find((item) => item.name === "子").id;
  state = addRole(state, { circleId: general, name: "R1", purpose: "p" }).state;
  state = addRole(state, { circleId: child, name: "R2", purpose: "p" }).state;
  assert.deepEqual(
    subtreeRoles(state, general).map((role) => role.name).sort(),
    ["R1", "R2"],
  );
  assert.deepEqual(subtreeRoles(state, child).map((role) => role.name), ["R2"]);
  assert.deepEqual(subtreeRoles(state, "c9"), []);
});

test("parseList splits commas, Japanese commas and lines", () => {
  assert.deepEqual(parseList("a, b、c\nd"), ["a", "b", "c", "d"]);
  assert.deepEqual(parseList("  , "), []);
});

test("the state survives storage round-trips and bad saves stay visible", () => {
  const seed = seedState();
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  saveSoshiki(storage, seed);
  assert.equal(store.get(SOSHIKI_KEY).includes("全体サークル"), true);
  assert.deepEqual(loadSoshiki(storage), seed);
  assert.deepEqual(settleSoshiki({ nope: true }), seedState());
  assert.deepEqual(loadSoshiki({ getItem: () => "{bad" }), seedState());
  const failing = { getItem: () => null, setItem: () => { throw new Error("denied"); } };
  assert.throws(() => saveSoshiki(failing, seed), /denied/);
});

test("the soshiki dapp stays local-only in the catalog", async () => {
  const { readFileSync } = await import("node:fs");
  const catalog = JSON.parse(readFileSync(new URL("../src/dapps.json", import.meta.url)));
  const soshiki = catalog.dapps.find((dapp) => dapp.id === "soshiki");
  assert.ok(soshiki);
  assert.equal(soshiki.offline, "local-core");
  assert.deepEqual(soshiki.remoteOperations, []);
  const docks = catalog.dapps.map((dapp) => dapp.dock);
  assert.equal(new Set(docks).size, docks.length);
});
