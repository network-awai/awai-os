// Soshiki: Holaspirit-style organization design as an itonami dApp.
// Local-only. Circles nest, roles belong to one circle, bots hold profiles
// and fill roles. No network, no broker operation: the state stays in
// localStorage on this device (see loadSoshiki/saveSoshiki).

export const SOSHIKI_KEY = "otehon.soshiki.v1";
export const SOSHIKI_VERSION = 1;
export const MAX_NAME = 80;
export const MAX_PURPOSE = 280;
export const MAX_ITEMS = 12;
export const MAX_ITEM = 80;

const cleanLine = (value) => (typeof value === "string" ? value.trim() : "");

export function nameError(name) {
  const text = cleanLine(name);
  if (!text || text.length > MAX_NAME) return "bad-name";
  return null;
}

export function purposeError(purpose, { required = true } = {}) {
  const text = cleanLine(purpose);
  if (!text && required) return "bad-purpose";
  if (text.length > MAX_PURPOSE) return "bad-purpose";
  return null;
}

function listError(items) {
  if (!Array.isArray(items)) return "bad-list";
  if (items.length > MAX_ITEMS) return "bad-list";
  for (const item of items) {
    const text = cleanLine(item);
    if (!text || text.length > MAX_ITEM) return "bad-list";
  }
  return null;
}

// The signed-in person, shown as the owner in the chart. Same shortening
// as the shell sidebar. Null when signed out.
export function personNameForAccount(accountDid) {
  const did = cleanLine(accountDid);
  if (!did) return null;
  return did.length > 26 ? `${did.slice(0, 14)}…${did.slice(-8)}` : did;
}

// Holaspirit-style "My Roles": roles held by the named person.
export function myRoles(state, personName) {
  if (!personName) return [];
  return state.roles.filter((role) => role.assignee?.kind === "person" && role.assignee.name === personName);
}

// "a, b, c" -> ["a", "b", "c"]. Used by the role/bot forms.
export function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanLine(item)).filter(Boolean);
  return cleanLine(value)
    .split(/[,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function freshId(state, prefix) {
  const next = Number.isFinite(state.nextId) && state.nextId > 0 ? state.nextId : 1;
  return [`${prefix}${next}`, { ...state, nextId: next + 1 }];
}

export function blankState() {
  return { version: SOSHIKI_VERSION, nextId: 1, circles: [], roles: [], bots: [], proposals: [] };
}

export function seedState() {
  let state = blankState();
  const add = (maker, args) => {
    const done = maker(state, args);
    if (done.error) throw new Error(done.error);
    state = done.state;
  };
  add(addCircle, { name: "全体サークル", purpose: "このデバイスの仕事をサークルとロールで回す", parentId: null });
  const general = state.circles[0].id;
  add(addCircle, { name: "くらし", purpose: "暮らしの見守りと記録", parentId: general });
  add(addCircle, { name: "しごと", purpose: "仕事の記録と予定", parentId: general });
  const kurashi = state.circles.find((circle) => circle.name === "くらし").id;
  const shigoto = state.circles.find((circle) => circle.name === "しごと").id;
  add(addRole, {
    circleId: general,
    name: "リードリンク",
    purpose: "全体の目的を保ち、サークルをつなぐ",
    accountabilities: ["サークルの目的を言葉にする", "空きロールを見つけて埋める"],
    skills: ["facilitation"],
    metric: "空きロールの数",
    assignee: null,
  });
  add(addRole, {
    circleId: kurashi,
    name: "見守り",
    purpose: "暮らしのリズムを見守る",
    accountabilities: ["異変に気づいて知らせる"],
    skills: ["monitoring"],
    metric: "",
    assignee: { kind: "bot", name: "Manimani" },
  });
  add(addRole, {
    circleId: shigoto,
    name: "記録係",
    purpose: "仕事の記録を残す",
    accountabilities: ["予定と記録を残す"],
    skills: ["notes"],
    metric: "",
    assignee: null,
  });
  add(addBot, {
    name: "Manimani",
    purpose: "このデバイスで動き、他のエージェントを調整する",
    skills: ["schedule", "memory", "approvals"],
    circleIds: [general, kurashi],
    roleIds: [],
    approval: "auto",
  });
  // Link the seeded 見守り role to the Manimani profile.
  const mimamori = state.roles.find((role) => role.name === "見守り");
  const manimani = state.bots.find((bot) => bot.name === "Manimani");
  if (mimamori && manimani && !manimani.roleIds.includes(mimamori.id)) {
    state = {
      ...state,
      bots: state.bots.map((bot) => (bot.id === manimani.id ? { ...bot, roleIds: [...bot.roleIds, mimamori.id] } : bot)),
    };
  }
  return state;
}

function circleById(state, id) {
  return state.circles.find((circle) => circle.id === id) ?? null;
}

function descendantsOf(state, id) {
  const children = state.circles.filter((circle) => circle.parentId === id);
  const out = [];
  for (const child of children) {
    out.push(child.id);
    out.push(...descendantsOf(state, child.id));
  }
  return out;
}

export function childrenOf(state, parentId) {
  return state.circles.filter((circle) => circle.parentId === parentId);
}

// Root-to-circle breadcrumb for the zoomable chart. Unknown ids give [].
export function circlePath(state, id) {
  const byId = new Map(state.circles.map((circle) => [circle.id, circle]));
  const path = [];
  let current = byId.get(id) ?? null;
  let guard = 0;
  while (current && guard <= state.circles.length) {
    path.unshift(current);
    current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
    guard += 1;
  }
  return current ? [] : path;
}

export function rolesOf(state, circleId) {
  return state.roles.filter((role) => role.circleId === circleId);
}

// All roles in the circle and its descendants, for nested rendering.
export function subtreeRoles(state, circleId) {
  const ids = [circleId];
  for (let i = 0; i < ids.length; i++) {
    for (const child of childrenOf(state, ids[i])) ids.push(child.id);
  }
  const wanted = new Set(ids);
  return state.roles.filter((role) => wanted.has(role.circleId));
}

export function addCircle(state, { name, purpose, parentId = null }) {
  if (nameError(name)) return { error: "bad-name" };
  if (purposeError(purpose)) return { error: "bad-purpose" };
  if (parentId !== null && !circleById(state, parentId)) return { error: "unknown-parent" };
  const [id, withId] = freshId(state, "c");
  return {
    state: {
      ...withId,
      circles: [...withId.circles, { id, name: cleanLine(name), purpose: cleanLine(purpose), parentId }],
    },
  };
}

export function moveCircle(state, { id, parentId }) {
  const circle = circleById(state, id);
  if (!circle) return { error: "unknown-circle" };
  if (parentId === id) return { error: "bad-parent" };
  if (parentId !== null) {
    if (!circleById(state, parentId)) return { error: "unknown-parent" };
    if (descendantsOf(state, id).includes(parentId)) return { error: "bad-parent" };
  }
  return {
    state: { ...state, circles: state.circles.map((item) => (item.id === id ? { ...item, parentId } : item)) },
  };
}

export function removeCircle(state, id) {
  if (!circleById(state, id)) return { error: "unknown-circle" };
  if (state.circles.some((circle) => circle.parentId === id)) return { error: "circle-has-children" };
  if (state.roles.some((role) => role.circleId === id)) return { error: "circle-not-empty" };
  return {
    state: {
      ...state,
      circles: state.circles.filter((circle) => circle.id !== id),
      bots: state.bots.map((bot) => ({ ...bot, circleIds: bot.circleIds.filter((circleId) => circleId !== id) })),
    },
  };
}

export function addRole(
  state,
  { circleId, name, purpose, accountabilities = [], skills = [], metric = "", assignee = null },
) {
  if (!circleById(state, circleId)) return { error: "unknown-circle" };
  if (nameError(name)) return { error: "bad-name" };
  if (purposeError(purpose)) return { error: "bad-purpose" };
  if (listError(accountabilities)) return { error: "bad-list" };
  if (listError(skills)) return { error: "bad-list" };
  if (cleanLine(metric).length > MAX_ITEM) return { error: "bad-metric" };
  const checked = checkAssignee(assignee);
  if (checked) return { error: checked };
  const [id, withId] = freshId(state, "r");
  let next = {
    ...withId,
    roles: [
      ...withId.roles,
      {
        id,
        circleId,
        name: cleanLine(name),
        purpose: cleanLine(purpose),
        accountabilities: accountabilities.map(cleanLine),
        skills: skills.map(cleanLine),
        metric: cleanLine(metric),
        assignee: normalizeAssignee(assignee),
      },
    ],
  };
  if (assignee?.kind === "bot") next = linkBotRole(next, assignee.name, id, circleId);
  return { state: next };
}

function checkAssignee(assignee) {
  if (assignee === null || assignee === undefined) return null;
  if (typeof assignee !== "object") return "bad-assignee";
  if (assignee.kind !== "bot" && assignee.kind !== "person") return "bad-assignee";
  if (nameError(assignee.name)) return "bad-assignee";
  return null;
}

function normalizeAssignee(assignee) {
  if (!assignee) return null;
  return { kind: assignee.kind, name: cleanLine(assignee.name) };
}

function linkBotRole(state, botName, roleId, circleId) {
  return {
    ...state,
    bots: state.bots.map((bot) => {
      if (bot.name !== botName) return bot;
      return {
        ...bot,
        roleIds: bot.roleIds.includes(roleId) ? bot.roleIds : [...bot.roleIds, roleId],
        circleIds: bot.circleIds.includes(circleId) ? bot.circleIds : [...bot.circleIds, circleId],
      };
    }),
  };
}

export function assignRole(state, { roleId, assignee }) {
  const role = state.roles.find((item) => item.id === roleId) ?? null;
  if (!role) return { error: "unknown-role" };
  const checked = checkAssignee(assignee);
  if (checked) return { error: checked };
  const previousBot = role.assignee?.kind === "bot" ? role.assignee.name : null;
  let next = {
    ...state,
    roles: state.roles.map((item) => (item.id === roleId ? { ...item, assignee: normalizeAssignee(assignee) } : item)),
  };
  if (previousBot) {
    next = {
      ...next,
      bots: next.bots.map((bot) =>
        bot.name === previousBot ? { ...bot, roleIds: bot.roleIds.filter((id) => id !== roleId) } : bot,
      ),
    };
  }
  if (assignee?.kind === "bot") next = linkBotRole(next, assignee.name, roleId, role.circleId);
  return { state: next };
}

export function removeRole(state, id) {
  const role = state.roles.find((item) => item.id === id) ?? null;
  if (!role) return { error: "unknown-role" };
  return {
    state: {
      ...state,
      roles: state.roles.filter((item) => item.id !== id),
      bots: state.bots.map((bot) => ({ ...bot, roleIds: bot.roleIds.filter((roleId) => roleId !== id) })),
    },
  };
}

export function addBot(
  state,
  { name, purpose = "", skills = [], circleIds = [], roleIds = [], approval = "ask" },
) {
  if (nameError(name)) return { error: "bad-name" };
  if (purposeError(purpose, { required: false })) return { error: "bad-purpose" };
  if (listError(skills)) return { error: "bad-list" };
  if (approval !== "auto" && approval !== "ask") return { error: "bad-approval" };
  if (state.bots.some((bot) => bot.name === cleanLine(name))) return { error: "bot-exists" };
  for (const circleId of circleIds) {
    if (!circleById(state, circleId)) return { error: "unknown-circle" };
  }
  for (const roleId of roleIds) {
    if (!state.roles.some((role) => role.id === roleId)) return { error: "unknown-role" };
  }
  const [id, withId] = freshId(state, "b");
  return {
    state: {
      ...withId,
      bots: [
        ...withId.bots,
        {
          id,
          name: cleanLine(name),
          purpose: cleanLine(purpose),
          skills: skills.map(cleanLine),
          circleIds: [...new Set(circleIds)],
          roleIds: [...new Set(roleIds)],
          approval,
        },
      ],
    },
  };
}

export function updateBot(state, { id, purpose, skills, approval, circleIds }) {
  const bot = state.bots.find((item) => item.id === id) ?? null;
  if (!bot) return { error: "unknown-bot" };
  const next = { ...bot };
  if (purpose !== undefined) {
    if (purposeError(purpose, { required: false })) return { error: "bad-purpose" };
    next.purpose = cleanLine(purpose);
  }
  if (skills !== undefined) {
    if (listError(skills)) return { error: "bad-list" };
    next.skills = skills.map(cleanLine);
  }
  if (approval !== undefined) {
    if (approval !== "auto" && approval !== "ask") return { error: "bad-approval" };
    next.approval = approval;
  }
  if (circleIds !== undefined) {
    for (const circleId of circleIds) {
      if (!circleById(state, circleId)) return { error: "unknown-circle" };
    }
    next.circleIds = [...new Set(circleIds)];
  }
  return { state: { ...state, bots: state.bots.map((item) => (item.id === id ? next : item)) } };
}

export function removeBot(state, id) {
  const bot = state.bots.find((item) => item.id === id) ?? null;
  if (!bot) return { error: "unknown-bot" };
  return {
    state: {
      ...state,
      bots: state.bots.filter((item) => item.id !== id),
      roles: state.roles.map((role) =>
        role.assignee?.kind === "bot" && role.assignee.name === bot.name ? { ...role, assignee: null } : role,
      ),
    },
  };
}

export function addProposal(state, { title, detail = "" }) {
  if (nameError(title)) return { error: "bad-name" };
  if (cleanLine(detail).length > MAX_PURPOSE) return { error: "bad-purpose" };
  const [id, withId] = freshId(state, "p");
  return {
    state: {
      ...withId,
      proposals: [
        ...withId.proposals,
        { id, title: cleanLine(title), detail: cleanLine(detail), status: "open", at: Date.now() },
      ],
    },
  };
}

export function decideProposal(state, { id, accept }) {
  const proposal = state.proposals.find((item) => item.id === id) ?? null;
  if (!proposal) return { error: "unknown-proposal" };
  if (proposal.status !== "open") return { error: "proposal-closed" };
  return {
    state: {
      ...state,
      proposals: state.proposals.map((item) => (item.id === id ? { ...item, status: accept ? "accepted" : "rejected" } : item)),
    },
  };
}

// Size visualization input: totals plus one row per circle with subtree sums.
// Members are distinct assignee names across roles plus direct bot memberships.
export function computeSize(state) {
  const byCircle = new Map(state.circles.map((circle) => [circle.id, circle]));
  const depthOf = (id) => {
    let depth = 0;
    let current = byCircle.get(id);
    while (current?.parentId) {
      depth += 1;
      current = byCircle.get(current.parentId);
      if (depth > 100) break;
    }
    return depth;
  };
  const subtreeIds = (id) => [id, ...descendantsOf(state, id)];
  const roles = (ids) => state.roles.filter((role) => ids.includes(role.circleId));
  const membersOfRoles = (roleList) => new Set(roleList.map((role) => role.assignee?.name).filter(Boolean));
  const directBots = (id) => state.bots.filter((bot) => bot.circleIds.includes(id)).map((bot) => bot.name);

  const rows = state.circles.map((circle) => {
    const direct = rolesOf(state, circle.id);
    const filled = direct.filter((role) => role.assignee).length;
    const subtree = roles(subtreeIds(circle.id));
    const members = new Set([...membersOfRoles(subtree), ...subtreeMemberBots(state, subtreeIds(circle.id))]);
    const directMembers = new Set([...membersOfRoles(direct), ...directBots(circle.id)]);
    return {
      id: circle.id,
      name: circle.name,
      depth: depthOf(circle.id),
      directRoles: direct.length,
      filled,
      open: direct.length - filled,
      fillRate: direct.length === 0 ? null : filled / direct.length,
      directMembers: directMembers.size,
      subtreeRoles: subtree.length,
      subtreeMembers: members.size,
    };
  });

  const filled = state.roles.filter((role) => role.assignee).length;
  const people = new Set(
    state.roles.map((role) => role.assignee).filter((item) => item?.kind === "person").map((item) => item.name),
  );
  return {
    totals: {
      circles: state.circles.length,
      roles: state.roles.length,
      filled,
      open: state.roles.length - filled,
      bots: state.bots.length,
      people: people.size,
      proposalsOpen: state.proposals.filter((item) => item.status === "open").length,
    },
    maxDepth: rows.reduce((max, row) => Math.max(max, row.depth), 0),
    rows: rows.sort((a, b) => b.subtreeRoles - a.subtreeRoles || a.name.localeCompare(b.name, "ja")),
  };
}

function subtreeMemberBots(state, ids) {
  const names = new Set();
  for (const bot of state.bots) {
    if (bot.circleIds.some((id) => ids.includes(id))) names.add(bot.name);
  }
  return names;
}

function validShape(state) {
  return (
    state !== null &&
    typeof state === "object" &&
    state.version === SOSHIKI_VERSION &&
    Array.isArray(state.circles) &&
    Array.isArray(state.roles) &&
    Array.isArray(state.bots) &&
    Array.isArray(state.proposals)
  );
}

export function settleSoshiki(saved) {
  if (!validShape(saved)) return seedState();
  return { ...blankState(), ...saved, version: SOSHIKI_VERSION };
}

export function loadSoshiki(storage) {
  try {
    const raw = storage.getItem(SOSHIKI_KEY);
    if (!raw) return seedState();
    return settleSoshiki(JSON.parse(raw));
  } catch {
    return seedState();
  }
}

// Throws when the write fails so the UI can warn instead of pretending it saved.
export function saveSoshiki(storage, state) {
  storage.setItem(SOSHIKI_KEY, JSON.stringify(state));
}
