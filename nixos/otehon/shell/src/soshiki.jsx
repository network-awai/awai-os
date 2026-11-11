// Soshiki dApp: Holaspirit-style circles/roles, bot profiles and size view.
// Local-only itonami dApp. State lives in localStorage (soshiki.js); nothing
// leaves this device. Manimani agents appear as importable bot candidates.
import { useEffect, useMemo, useState } from "react";
import { useManimani } from "./manimani.jsx";
import {
  addBot,
  addCircle,
  addProposal,
  addRole,
  assignRole,
  childrenOf,
  circlePath,
  computeSize,
  decideProposal,
  loadSoshiki,
  moveCircle,
  myRoles,
  parseList,
  personNameForAccount,
  subtreeRoles,
  removeBot,
  removeCircle,
  removeRole,
  rolesOf,
  saveSoshiki,
  updateBot,
} from "./soshiki.js";

const TABS = [
  { id: "chart", label: "組織設計", sub: "Chart" },
  { id: "bots", label: "Bot", sub: "Profiles" },
  { id: "size", label: "サイズ", sub: "Size" },
];

const ERROR_TEXT = {
  "bad-name": "名前を1〜80文字で入れてください。",
  "bad-purpose": "目的を確認してください（サークル・ロールは必須、280文字まで）。",
  "bad-list": "箇条書きは12件まで、1件80文字までです。",
  "bad-metric": "メトリクスは80文字までです。",
  "bad-assignee": "アサインは Bot か Person と名前で指定します。",
  "bad-approval": "承認は auto か ask です。",
  "bad-parent": "その親サークルには移動できません。",
  "unknown-circle": "そのサークルはもうありません。",
  "unknown-parent": "その親サークルはもうありません。",
  "unknown-role": "そのロールはもうありません。",
  "unknown-bot": "そのBotはもうありません。",
  "unknown-proposal": "その提案はもうありません。",
  "proposal-closed": "その提案は決着済みです。",
  "circle-has-children": "子サークルがあるため消せません。先に子を移してください。",
  "circle-not-empty": "ロールがあるため消せません。先にロールを移すか消してください。",
  "bot-exists": "その名前のBotは登録済みです。",
};

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function useSoshiki() {
  const [state, setState] = useState(() => {
    const store = storage();
    if (!store) return loadSoshiki({ getItem: () => null });
    return loadSoshiki(store);
  });
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const store = storage();
    if (!store) {
      setSaveFailed(true);
      return;
    }
    try {
      saveSoshiki(store, state);
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [state]);
  const apply = (result) => {
    if (result?.error) return result.error;
    if (result?.state) setState(result.state);
    return null;
  };
  return [state, apply, saveFailed];
}

function Field({ label, children }) {
  return (
    <label className="soshiki-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

const SOSHIKI_UI_KEY = "otehon.soshiki.ui.v1";
const HIGHLIGHTS = [
  { id: "all", label: "すべて" },
  { id: "open", label: "空き" },
  { id: "bot", label: "Bot" },
  { id: "person", label: "人" },
];

// Holaspirit-style highlight of a role: open, bot-held or person-held.
function roleHighlight(role) {
  if (!role.assignee) return "open";
  return role.assignee.kind === "person" ? "person" : "bot";
}

function matchesQuery(text, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

function loadFocusId() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOSHIKI_UI_KEY));
    return typeof saved?.focusId === "string" ? saved.focusId : null;
  } catch {
    return null;
  }
}

// Size weight of a sub-circle card: Holaspirit scales a circle by the roles
// it contains. s/m/l by subtree role count.
function sizeClass(subtreeRoles) {
  if (subtreeRoles >= 5) return "l";
  if (subtreeRoles >= 2) return "m";
  return "s";
}

function RoleDetail({ state, role, apply, setError, botNames, me }) {
  const [text, setText] = useState("");
  const circle = state.circles.find((item) => item.id === role.circleId);
  const assignSelf = () => {
    if (!me) return;
    setError(apply(assignRole(state, { roleId: role.id, assignee: { kind: "person", name: me } })));
    setText("");
  };
  const submit = () => {
    const raw = text.trim();
    if (!raw) {
      setError(apply(assignRole(state, { roleId: role.id, assignee: null })));
      setText("");
      return;
    }
    const kind = raw.startsWith("@") ? "person" : "bot";
    const name = raw.startsWith("@") ? raw.slice(1).trim() : raw;
    setError(apply(assignRole(state, { roleId: role.id, assignee: { kind, name } })));
    setText("");
  };
  return (
    <div className="soshiki-detail" data-role-detail={role.id}>
      <div className="soshiki-circle-head">
        <strong>
          <span className="hl-dot" data-hl={roleHighlight(role)} aria-hidden="true" />
          {role.name}
        </strong>
        <span className="muted">{circle ? circle.name : ""}</span>
      </div>
      <p>{role.purpose}</p>
      {role.accountabilities.length ? <p>責任: {role.accountabilities.join(" / ")}</p> : null}
      {role.skills.length ? <p className="muted">Skills: {role.skills.join(", ")}</p> : null}
      {role.metric ? <p className="muted">Metric: {role.metric}</p> : null}
      <p className="muted">
        担当: {role.assignee ? `${role.assignee.kind === "bot" ? "" : "@"}${role.assignee.name}` : "空き"}
      </p>
      <div className="soshiki-row">
        <input
          aria-label={`${role.name}のアサイン`}
          placeholder="Bot名か @人名、空で解除"
          value={text}
          list={`chart-bots-${role.id}`}
          onChange={(event) => setText(event.target.value)}
        />
        <datalist id={`chart-bots-${role.id}`}>
          {botNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="button" onClick={submit}>
          割当
        </button>
        {me ? (
          <button type="button" className="soshiki-quiet" onClick={assignSelf}>
            自分に割当
          </button>
        ) : null}
      </div>
      <p className="muted">削除・サークル移動は下の編集セクションで行います。</p>
    </div>
  );
}

// Holaspirit-style zoomable circle chart: the focused circle fills the view,
// its background zooms into a sub-circle, the breadcrumb zooms out, and the
// zoom stays saved on this device.
const MAX_NEST_DEPTH = 6;

// A branch stays visible while filtering when the circle itself matches or
// any role in its subtree passes the highlight and query filters.
function branchMatches(state, circle, query, highlight) {
  if (matchesQuery(`${circle.name} ${circle.purpose}`, query)) {
    if (highlight === "all") return true;
    return subtreeRoles(state, circle.id).some((role) => roleHighlight(role) === highlight);
  }
  return subtreeRoles(state, circle.id).some(
    (role) =>
      (highlight === "all" || roleHighlight(role) === highlight) &&
      matchesQuery(`${role.name} ${role.purpose}`, query),
  );
}

function RoleChip({ role, selected, onSelect }) {
  const assignee = role.assignee ? `${role.assignee.kind === "bot" ? "" : "@"}${role.assignee.name}` : "空き";
  return (
    <button
      type="button"
      className={selected ? "soshiki-chip active" : "soshiki-chip"}
      data-role={role.id}
      title={`${role.name}（${assignee}）: ${role.purpose}`}
      aria-expanded={selected}
      onClick={() => onSelect(selected ? null : role.id)}
    >
      <span className="hl-dot" data-hl={roleHighlight(role)} aria-hidden="true" />
      <span>{role.name}</span>
    </button>
  );
}

// Holaspirit-style nested circle: the box holds its roles as chips and its
// sub-circles as boxes inside it. Headers below the focus zoom on click.
function NestedCircle({ state, circle, depth, query, highlight, selectedRoleId, onSelectRole, onFocus, rows, members }) {
  const children = childrenOf(state, circle.id);
  const filtering = query.trim() !== "" || highlight !== "all";
  const directRoles = rolesOf(state, circle.id).filter(
    (role) =>
      (highlight === "all" || roleHighlight(role) === highlight) &&
      matchesQuery(`${role.name} ${role.purpose}`, query),
  );
  const visibleChildren = children.filter((child) => branchMatches(state, child, query, highlight));
  const row = rows.get(circle.id);
  const count = row?.subtreeRoles ?? subtreeRoles(state, circle.id).length;
  const head = (
    <>
      <strong>{circle.name}</strong>
      <span className="muted">
        {count} roles · {row?.subtreeMembers ?? 0} members
      </span>
      {depth === 0 ? null : <span className="soshiki-open">開く ›</span>}
    </>
  );
  return (
    <div className="soshiki-nest" data-circle={circle.id} data-depth={depth} data-size={sizeClass(count)}>
      {depth === 0 ? (
        <div className="soshiki-nest-headtext">{head}</div>
      ) : (
        <button type="button" className="soshiki-nest-head" data-zoom={circle.id} onClick={() => onFocus(circle.id)}>
          {head}
        </button>
      )}
      <p className="soshiki-purpose">{circle.purpose}</p>
      {members ? (
        <ul className="soshiki-members" aria-label="メンバー">
          {members.length === 0 ? <li className="muted">メンバーはまだいません。</li> : null}
          {members.map(([name, kind]) => (
            <li key={name} title={kind === "bot" ? "Bot" : "人"}>
              <span className="soshiki-avatar" data-kind={kind} aria-hidden="true">
                {(kind === "bot" ? "" : "@") + name[0]}
              </span>
              <span>{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {directRoles.length ? (
        <ul className="soshiki-chips" aria-label={`${circle.name}のロール`}>
          {directRoles.map((role) => (
            <li key={role.id}>
              <RoleChip role={role} selected={role.id === selectedRoleId} onSelect={onSelectRole} />
            </li>
          ))}
        </ul>
      ) : filtering ? (
        <p className="muted">合致するロールはありません。</p>
      ) : (
        <p className="muted">ロールはまだありません。</p>
      )}
      {depth < MAX_NEST_DEPTH && visibleChildren.length ? (
        <div className="soshiki-kids">
          {visibleChildren.map((child) => (
            <NestedCircle
              key={child.id}
              state={state}
              circle={child}
              depth={depth + 1}
              query={query}
              highlight={highlight}
              selectedRoleId={selectedRoleId}
              onSelectRole={onSelectRole}
              onFocus={onFocus}
              rows={rows}
              members={null}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChartView({ state, apply, setError, focusId, onFocus, query, highlight, selectedRoleId, onSelectRole, botNames, me }) {
  const roots = childrenOf(state, null);
  const focus = state.circles.find((circle) => circle.id === focusId) ?? roots[0] ?? null;
  const size = useMemo(() => computeSize(state), [state]);
  const rows = useMemo(() => new Map(size.rows.map((row) => [row.id, row])), [size]);
  if (!focus) return <p className="muted">サークルはまだありません。下の編集から作れます。</p>;
  const path = circlePath(state, focus.id);
  const directRoles = rolesOf(state, focus.id);
  const members = useMemo(() => {
    const seen = new Map();
    for (const role of directRoles) {
      if (role.assignee && !seen.has(role.assignee.name)) seen.set(role.assignee.name, role.assignee.kind);
    }
    for (const bot of state.bots) {
      if (bot.circleIds.includes(focus.id) && !seen.has(bot.name)) seen.set(bot.name, "bot");
    }
    return [...seen.entries()];
  }, [state.bots, directRoles, focus.id]);
  const selected = state.roles.find((role) => role.id === selectedRoleId) ?? null;

  return (
    <div data-chart-focus={focus.id}>
      <nav className="soshiki-crumb" aria-label="サークルのパンくず">
        {path.map((circle, index) =>
          index < path.length - 1 ? (
            <span key={circle.id}>
              <button type="button" className="soshiki-crumb-link" onClick={() => onFocus(circle.id)}>
                {circle.name}
              </button>
              <span aria-hidden="true"> › </span>
            </span>
          ) : (
            <strong key={circle.id} aria-current="page">
              {circle.name}
            </strong>
          ),
        )}
      </nav>
      <NestedCircle
        state={state}
        circle={focus}
        depth={0}
        query={query}
        highlight={highlight}
        selectedRoleId={selectedRoleId}
        onSelectRole={onSelectRole}
        onFocus={onFocus}
        rows={rows}
        members={members}
      />
      {selected ? <RoleDetail state={state} role={selected} apply={apply} setError={setError} botNames={botNames} me={me} /> : null}
    </div>
  );
}

function CircleNode({ state, circle, depth, apply, setError, botNames }) {
  const children = childrenOf(state, circle.id);
  const roles = rolesOf(state, circle.id);
  const [assignee, setAssignee] = useState({});
  const [parent, setParent] = useState(circle.parentId ?? "");

  const submitAssign = (roleId) => {
    const raw = (assignee[roleId] ?? "").trim();
    if (!raw) {
      setError(apply(assignRole(state, { roleId, assignee: null })));
      return;
    }
    const kind = raw.startsWith("@") ? "person" : "bot";
    const name = raw.startsWith("@") ? raw.slice(1).trim() : raw;
    setError(apply(assignRole(state, { roleId, assignee: { kind, name } })));
  };

  return (
    <li className="soshiki-circle" data-circle={circle.id} data-depth={depth}>
      <div className="soshiki-circle-head">
        <strong>{circle.name}</strong>
        <span className="muted">
          {roles.length} roles · {children.length} sub-circles
        </span>
      </div>
      <p className="soshiki-purpose">{circle.purpose}</p>
      {roles.length === 0 ? <p className="muted">ロールはまだありません。</p> : null}
      <ul className="soshiki-roles">
        {roles.map((role) => (
          <li key={role.id} className="soshiki-role" data-role={role.id}>
            <div className="soshiki-role-head">
              <span className="soshiki-role-name">{role.name}</span>
              <span className="muted">{role.assignee ? `${role.assignee.kind === "bot" ? "" : "@"}${role.assignee.name}` : "空き"}</span>
            </div>
            <p className="muted">{role.purpose}</p>
            {role.accountabilities.length ? <p>責任: {role.accountabilities.join(" / ")}</p> : null}
            {role.skills.length ? <p className="muted">Skills: {role.skills.join(", ")}</p> : null}
            {role.metric ? <p className="muted">Metric: {role.metric}</p> : null}
            <div className="soshiki-row">
              <input
                aria-label={`${role.name}のアサイン`}
                placeholder="Bot名か @人名、空で解除"
                value={assignee[role.id] ?? ""}
                list={`bots-${role.id}`}
                onChange={(event) => setAssignee((current) => ({ ...current, [role.id]: event.target.value }))}
              />
              <datalist id={`bots-${role.id}`}>
                {botNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button type="button" onClick={() => submitAssign(role.id)}>
                割当
              </button>
              <button type="button" className="soshiki-quiet" onClick={() => setError(apply(removeRole(state, role.id)))}>
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {children.length ? (
        <ul className="soshiki-children">
          {children.map((child) => (
            <CircleNode key={child.id} state={state} circle={child} depth={depth + 1} apply={apply} setError={setError} botNames={botNames} />
          ))}
        </ul>
      ) : null}
      <div className="soshiki-row">
        <select aria-label={`${circle.name}の親`} value={parent} onChange={(event) => setParent(event.target.value)}>
          <option value="">全体（親なし）</option>
          {state.circles
            .filter((item) => item.id !== circle.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => setError(apply(moveCircle(state, { id: circle.id, parentId: parent || null })))}
        >
          移動
        </button>
        <button type="button" className="soshiki-quiet" onClick={() => setError(apply(removeCircle(state, circle.id)))}>
          削除
        </button>
      </div>
    </li>
  );
}

function ChartTab({ state, apply, me, score, method, onAccount }) {
  const [error, setError] = useState(null);
  const mine = myRoles(state, me);
  const circleOf = (role) => state.circles.find((circle) => circle.id === role.circleId);
  const [circleName, setCircleName] = useState("");
  const [circlePurpose, setCirclePurpose] = useState("");
  const [circleParent, setCircleParent] = useState("");
  const [roleCircle, setRoleCircle] = useState(state.circles[0]?.id ?? "");
  const [roleName, setRoleName] = useState("");
  const [rolePurpose, setRolePurpose] = useState("");
  const [roleActs, setRoleActs] = useState("");
  const [roleSkills, setRoleSkills] = useState("");
  const [roleMetric, setRoleMetric] = useState("");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalDetail, setProposalDetail] = useState("");
  const [focusId, setFocusId] = useState(loadFocusId);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState("all");
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const roots = childrenOf(state, null);
  const botNames = state.bots.map((bot) => bot.name);
  useEffect(() => {
    if (!state.circles.some((circle) => circle.id === roleCircle)) setRoleCircle(state.circles[0]?.id ?? "");
  }, [state.circles, roleCircle]);
  useEffect(() => {
    if (focusId && !state.circles.some((circle) => circle.id === focusId)) {
      setFocusId(state.circles[0]?.id ?? null);
      setSelectedRoleId(null);
    }
  }, [state.circles, focusId]);
  useEffect(() => {
    try {
      localStorage.setItem(SOSHIKI_UI_KEY, JSON.stringify({ focusId }));
    } catch {
      // The chart still works for this session.
    }
  }, [focusId]);
  const onFocus = (id) => {
    setFocusId(id);
    setSelectedRoleId(null);
  };

  const submitCircle = (event) => {
    event.preventDefault();
    const failed = apply(addCircle(state, { name: circleName, purpose: circlePurpose, parentId: circleParent || null }));
    setError(failed);
    if (!failed) {
      setCircleName("");
      setCirclePurpose("");
    }
  };

  const submitRole = (event) => {
    event.preventDefault();
    const failed = apply(
      addRole(state, {
        circleId: roleCircle,
        name: roleName,
        purpose: rolePurpose,
        accountabilities: parseList(roleActs),
        skills: parseList(roleSkills),
        metric: roleMetric,
        assignee: null,
      }),
    );
    setError(failed);
    if (!failed) {
      setRoleName("");
      setRolePurpose("");
      setRoleActs("");
      setRoleSkills("");
      setRoleMetric("");
    }
  };

  const submitProposal = (event) => {
    event.preventDefault();
    const failed = apply(addProposal(state, { title: proposalTitle, detail: proposalDetail }));
    setError(failed);
    if (!failed) {
      setProposalTitle("");
      setProposalDetail("");
    }
  };

  return (
    <div>
      {error ? <p className="net-error">{ERROR_TEXT[error] ?? "入力を確認してください。"}</p> : null}
      {me ? (
        <section className="soshiki-me" aria-label="あなたのプロフィール" data-me={me}>
          <span className="soshiki-avatar" data-kind="person" aria-hidden="true">
            {"@" + me.replace(/^@/, "")[0]}
          </span>
          <div>
            <strong>あなた · {me}</strong>
            <span className="muted">
              Trust {score} · {method === "wallet" ? "Web3 wallet" : "Passkey"}
            </span>
          </div>
          {onAccount ? (
            <button type="button" className="soshiki-quiet" onClick={onAccount}>
              アカウントを開く
            </button>
          ) : null}
        </section>
      ) : (
        <p className="muted">サインインするとあなたがここに出ます。</p>
      )}
      <h2>My Roles</h2>
      {!me ? <p className="muted">—</p> : null}
      {me && mine.length === 0 ? (
        <p className="muted">あなたのロールはまだありません。ロールの詳細から「自分に割当」できます。</p>
      ) : null}
      {mine.length ? (
        <ul className="soshiki-rolegrid">
          {mine.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                className="soshiki-rolecard"
                data-my-role={role.id}
                onClick={() => {
                  onFocus(role.circleId);
                  setSelectedRoleId(role.id);
                }}
              >
                <span className="hl-dot" data-hl="person" aria-hidden="true" />
                <strong>{role.name}</strong>
                <span className="muted">{circleOf(role)?.name ?? ""}</span>
                <span className="soshiki-rolecard-purpose">{role.purpose}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="soshiki-chartbar">
        <input
          className="soshiki-search"
          aria-label="サークルとロールを検索"
          placeholder="検索: サークル・ロール名"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="soshiki-legend" role="group" aria-label="ハイライト絞り込み">
          {HIGHLIGHTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={highlight === item.id ? "soshiki-legend-btn active" : "soshiki-legend-btn"}
              aria-pressed={highlight === item.id}
              data-highlight={item.id}
              onClick={() => setHighlight(item.id)}
            >
              {item.id === "all" ? null : <span className="hl-dot" data-hl={item.id} aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <ChartView
        state={state}
        apply={apply}
        setError={setError}
        focusId={focusId}
        onFocus={onFocus}
        query={query}
        highlight={highlight}
        selectedRoleId={selectedRoleId}
        onSelectRole={setSelectedRoleId}
        botNames={botNames}
        me={me}
      />
      <h2>編集</h2>
      {roots.length === 0 ? <p className="muted">サークルはまだありません。下のフォームから作れます。</p> : null}
      <ul className="soshiki-tree">
        {roots.map((circle) => (
          <CircleNode key={circle.id} state={state} circle={circle} depth={0} apply={apply} setError={setError} botNames={botNames} />
        ))}
      </ul>
      <h2>サークルを追加</h2>
      <form className="soshiki-form" onSubmit={submitCircle}>
        <Field label="名前">
          <input aria-label="サークル名" value={circleName} onChange={(event) => setCircleName(event.target.value)} />
        </Field>
        <Field label="目的">
          <input aria-label="サークルの目的" value={circlePurpose} onChange={(event) => setCirclePurpose(event.target.value)} />
        </Field>
        <Field label="親サークル">
          <select value={circleParent} onChange={(event) => setCircleParent(event.target.value)}>
            <option value="">全体（親なし）</option>
            {state.circles.map((circle) => (
              <option key={circle.id} value={circle.id}>
                {circle.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="primary">
          サークルを作る
        </button>
      </form>
      <h2>ロールを追加</h2>
      <form className="soshiki-form" onSubmit={submitRole}>
        <Field label="所属サークル">
          <select aria-label="所属サークル" value={roleCircle} onChange={(event) => setRoleCircle(event.target.value)}>
            {state.circles.map((circle) => (
              <option key={circle.id} value={circle.id}>
                {circle.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ロール名">
          <input aria-label="ロール名" value={roleName} onChange={(event) => setRoleName(event.target.value)} />
        </Field>
        <Field label="目的">
          <input aria-label="ロールの目的" value={rolePurpose} onChange={(event) => setRolePurpose(event.target.value)} />
        </Field>
        <Field label="責任（カンマ区切り）">
          <input aria-label="ロールの責任" value={roleActs} onChange={(event) => setRoleActs(event.target.value)} />
        </Field>
        <Field label="スキル（カンマ区切り）">
          <input aria-label="ロールのスキル" value={roleSkills} onChange={(event) => setRoleSkills(event.target.value)} />
        </Field>
        <Field label="メトリクス">
          <input aria-label="ロールのメトリクス" value={roleMetric} onChange={(event) => setRoleMetric(event.target.value)} />
        </Field>
        <button type="submit" className="primary">
          ロールを作る
        </button>
      </form>
      <h2>ガバナンス提案</h2>
      {state.proposals.length === 0 ? <p className="muted">提案はまだありません。</p> : null}
      <ul className="soshiki-proposals">
        {state.proposals.map((proposal) => (
          <li key={proposal.id} data-proposal={proposal.id} data-status={proposal.status}>
            <strong>{proposal.title}</strong> <span className="muted">{proposal.status}</span>
            {proposal.detail ? <p className="muted">{proposal.detail}</p> : null}
            {proposal.status === "open" ? (
              <div className="soshiki-row">
                <button type="button" onClick={() => setError(apply(decideProposal(state, { id: proposal.id, accept: true })))}>
                  承認
                </button>
                <button
                  type="button"
                  className="soshiki-quiet"
                  onClick={() => setError(apply(decideProposal(state, { id: proposal.id, accept: false })))}
                >
                  却下
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="soshiki-form" onSubmit={submitProposal}>
        <Field label="提案タイトル">
          <input aria-label="提案タイトル" value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} />
        </Field>
        <Field label="詳細">
          <input aria-label="提案の詳細" value={proposalDetail} onChange={(event) => setProposalDetail(event.target.value)} />
        </Field>
        <button type="submit" className="primary">
          提案する
        </button>
      </form>
    </div>
  );
}

function BotsTab({ state, apply, agents }) {
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [skills, setSkills] = useState("");
  const [edits, setEdits] = useState({});
  const circleName = (id) => state.circles.find((circle) => circle.id === id)?.name ?? id;
  const roleName = (id) => state.roles.find((role) => role.id === id)?.name ?? id;
  const known = new Set(state.bots.map((bot) => bot.name));
  const candidates = (agents ?? []).filter((agent) => agent?.name && !known.has(agent.name));

  const submit = (event) => {
    event.preventDefault();
    const failed = apply(addBot(state, { name, purpose, skills: parseList(skills), circleIds: [], roleIds: [], approval: "ask" }));
    setError(failed);
    if (!failed) {
      setName("");
      setPurpose("");
      setSkills("");
    }
  };

  const saveEdit = (bot) => {
    const edit = edits[bot.id] ?? {};
    const failed = apply(
      updateBot(state, {
        id: bot.id,
        purpose: edit.purpose ?? bot.purpose,
        skills: parseList(edit.skills ?? bot.skills.join(", ")),
        approval: edit.approval ?? bot.approval,
      }),
    );
    setError(failed);
    if (!failed) setEdits((current) => ({ ...current, [bot.id]: undefined }));
  };

  return (
    <div>
      {error ? <p className="net-error">{ERROR_TEXT[error] ?? "入力を確認してください。"}</p> : null}
      {candidates.length ? (
        <>
          <h2>Manimaniのエージェントから登録</h2>
          <ul className="soshiki-bots">
            {candidates.map((agent) => (
              <li key={agent.id} data-agent={agent.id}>
                <strong>{agent.name}</strong>
                <span className="muted">{agent.approval === "auto" ? "自動で動く" : "先に確認する"}</span>
                <div className="soshiki-row">
                  <button
                    type="button"
                    onClick={() =>
                      setError(
                        apply(
                          addBot(state, {
                            name: agent.name,
                            purpose: "",
                            skills: [],
                            circleIds: [],
                            roleIds: [],
                            approval: agent.approval === "auto" ? "auto" : "ask",
                          }),
                        ),
                      )
                    }
                  >
                    プロフィールを作る
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>Botプロフィール</h2>
      {state.bots.length === 0 ? <p className="muted">Botはまだ登録されていません。</p> : null}
      <ul className="soshiki-bots">
        {state.bots.map((bot) => {
          const edit = edits[bot.id] ?? { purpose: bot.purpose, skills: bot.skills.join(", "), approval: bot.approval };
          return (
            <li key={bot.id} className="soshiki-bot" data-bot={bot.id}>
              <div className="soshiki-circle-head">
                <strong>{bot.name}</strong>
                <span className="muted">{bot.approval === "auto" ? "自動で動く" : "先に確認する"}</span>
              </div>
              {bot.purpose ? <p>{bot.purpose}</p> : <p className="muted">目的は未設定です。</p>}
              <p className="muted">Skills: {bot.skills.length ? bot.skills.join(", ") : "—"}</p>
              <p className="muted">サークル: {bot.circleIds.length ? bot.circleIds.map(circleName).join(" / ") : "—"}</p>
              <p className="muted">ロール: {bot.roleIds.length ? bot.roleIds.map(roleName).join(" / ") : "—"}</p>
              <div className="soshiki-form">
                <Field label="目的">
                  <input
                    aria-label={`${bot.name}の目的`}
                    value={edit.purpose ?? ""}
                    onChange={(event) => setEdits((current) => ({ ...current, [bot.id]: { ...edit, purpose: event.target.value } }))}
                  />
                </Field>
                <Field label="スキル（カンマ区切り）">
                  <input
                    aria-label={`${bot.name}のスキル`}
                    value={edit.skills ?? ""}
                    onChange={(event) => setEdits((current) => ({ ...current, [bot.id]: { ...edit, skills: event.target.value } }))}
                  />
                </Field>
                <Field label="承認">
                  <select
                    aria-label={`${bot.name}の承認`}
                    value={edit.approval ?? "ask"}
                    onChange={(event) => setEdits((current) => ({ ...current, [bot.id]: { ...edit, approval: event.target.value } }))}
                  >
                    <option value="auto">自動で動く</option>
                    <option value="ask">先に確認する</option>
                  </select>
                </Field>
                <div className="soshiki-row">
                  <button type="button" onClick={() => saveEdit(bot)}>
                    保存
                  </button>
                  <button type="button" className="soshiki-quiet" onClick={() => setError(apply(removeBot(state, bot.id)))}>
                    削除
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <h2>Botを追加</h2>
      <form className="soshiki-form" onSubmit={submit}>
        <Field label="名前">
          <input aria-label="Bot名" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="目的">
          <input aria-label="Botの目的" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </Field>
        <Field label="スキル（カンマ区切り）">
          <input aria-label="Botのスキル" value={skills} onChange={(event) => setSkills(event.target.value)} />
        </Field>
        <button type="submit" className="primary">
          Botを作る
        </button>
      </form>
    </div>
  );
}

function SizeTab({ state }) {
  const size = useMemo(() => computeSize(state), [state]);
  const maxRoles = Math.max(1, ...size.rows.map((row) => row.subtreeRoles));
  const maxMembers = Math.max(1, ...size.rows.map((row) => row.subtreeMembers));
  return (
    <div>
      <h2>全体</h2>
      <ul className="soshiki-totals" data-size-totals>
        <li>
          <strong>{size.totals.circles}</strong>
          <span>サークル</span>
        </li>
        <li>
          <strong>{size.totals.roles}</strong>
          <span>ロール</span>
        </li>
        <li>
          <strong>{size.totals.filled}</strong>
          <span>割当済み</span>
        </li>
        <li>
          <strong>{size.totals.open}</strong>
          <span>空き</span>
        </li>
        <li>
          <strong>{size.totals.bots}</strong>
          <span>Bot</span>
        </li>
        <li>
          <strong>{size.totals.people}</strong>
          <span>人</span>
        </li>
      </ul>
      <p className="muted">
        深さ {size.maxDepth} · 未決の提案 {size.totals.proposalsOpen}
      </p>
      <h2>サークル別</h2>
      {size.rows.length === 0 ? <p className="muted">サークルはまだありません。</p> : null}
      <ul className="soshiki-sizes">
        {size.rows.map((row) => (
          <li key={row.id} data-size-row={row.id}>
            <div className="soshiki-circle-head">
              <strong>{row.name}</strong>
              <span className="muted">
                {row.subtreeRoles} roles · {row.subtreeMembers} members
              </span>
            </div>
            <div className="soshiki-meter-row">
              <span>ロール</span>
              <div className="meter" role="img" aria-label={`${row.name}のロール ${row.subtreeRoles}`}>
                <span style={{ width: `${Math.round((100 * row.subtreeRoles) / maxRoles)}%` }} />
              </div>
              <span className="muted">{row.subtreeRoles}</span>
            </div>
            <div className="soshiki-meter-row">
              <span>人数</span>
              <div className="meter" role="img" aria-label={`${row.name}の人数 ${row.subtreeMembers}`}>
                <span style={{ width: `${Math.round((100 * row.subtreeMembers) / maxMembers)}%` }} />
              </div>
              <span className="muted">{row.subtreeMembers}</span>
            </div>
            <p className="muted">
              直下 {row.directRoles} roles（空き {row.open}）· 直下 {row.directMembers} members
              {row.fillRate === null ? "" : ` · 充足率 ${Math.round(100 * row.fillRate)}%`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Soshiki({ account, score = 0, onAccount }) {
  const [state, apply, saveFailed] = useSoshiki();
  const [tab, setTab] = useState("chart");
  const [manimani] = useManimani();
  const agents = manimani?.agents ?? [];
  const me = personNameForAccount(account?.accountDid);
  const method = account?.method;

  return (
    <main className="chat net-view" data-soshiki>
      <div className="net-body soshiki-body">
        <h1>Soshiki</h1>
        <p className="muted">サークルとロールで組織を作り、Botにプロフィールを持たせる。すべてこのデバイスに保存します。</p>
        {saveFailed ? <p className="net-error">保存できませんでした。この画面の変更はこの表示の間だけ有効です。</p> : null}
        <div className="soshiki-tabs" role="tablist" aria-label="Soshiki views">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "soshiki-tab active" : "soshiki-tab"}
              data-tab={item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              <span className="muted"> {item.sub}</span>
            </button>
          ))}
        </div>
        {tab === "chart" ? <ChartTab state={state} apply={apply} me={me} score={score} method={method} onAccount={onAccount} /> : null}
        {tab === "bots" ? <BotsTab state={state} apply={apply} agents={agents} /> : null}
        {tab === "size" ? <SizeTab state={state} /> : null}
      </div>
    </main>
  );
}
