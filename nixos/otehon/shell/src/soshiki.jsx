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
  computeSize,
  decideProposal,
  loadSoshiki,
  moveCircle,
  parseList,
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

function ChartTab({ state, apply }) {
  const [error, setError] = useState(null);
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
  const roots = childrenOf(state, null);
  const botNames = state.bots.map((bot) => bot.name);
  useEffect(() => {
    if (!state.circles.some((circle) => circle.id === roleCircle)) setRoleCircle(state.circles[0]?.id ?? "");
  }, [state.circles, roleCircle]);

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

export function Soshiki() {
  const [state, apply, saveFailed] = useSoshiki();
  const [tab, setTab] = useState("chart");
  const [manimani] = useManimani();
  const agents = manimani?.agents ?? [];

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
        {tab === "chart" ? <ChartTab state={state} apply={apply} /> : null}
        {tab === "bots" ? <BotsTab state={state} apply={apply} agents={agents} /> : null}
        {tab === "size" ? <SizeTab state={state} /> : null}
      </div>
    </main>
  );
}
