// Accessibility audit over Chrome's accessibility tree (DevTools Accessibility domain).
// It reads what a screen reader would be given: roles and accessible names. It is not a screen
// reader, and it does not judge whether a name is a good one.

// Roles a person operates or navigates by. Each must have a non-empty accessible name.
const NAMED = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "tab",
  "image",
  "img",
  "navigation",
  "complementary",
  "region",
  "dialog",
  "alertdialog",
  "form",
]);

const value = (field) => (field && typeof field.value === "string" ? field.value.trim() : "");

// nodes: the result of Accessibility.getFullAXTree. lang: document.documentElement.lang.
export function auditTree(nodes, { lang }) {
  const findings = [];
  const live = nodes.filter((node) => !node.ignored);
  for (const node of live) {
    const role = value(node.role);
    if (NAMED.has(role) && !value(node.name)) findings.push(`unnamed-${role}`);
  }
  const roles = live.map((node) => value(node.role));
  const mains = roles.filter((role) => role === "main").length;
  if (mains !== 1) findings.push(`main-count-${mains}`);
  if (!roles.includes("heading")) findings.push("no-heading");
  if (!lang) findings.push("no-lang");
  // Two landmarks of one role need different names, or a screen reader cannot tell them apart.
  for (const role of ["navigation", "complementary", "region"]) {
    const names = live.filter((node) => value(node.role) === role).map((node) => value(node.name));
    if (new Set(names).size !== names.length) findings.push(`duplicate-${role}-name`);
  }
  return findings;
}

export function summarize(nodes) {
  return nodes
    .filter((node) => !node.ignored && NAMED.has(value(node.role)))
    .map((node) => `${value(node.role)}:${value(node.name) || "(no name)"}`);
}
