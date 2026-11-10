export const THEME_KEY = "otehon.theme.v1";
export const THEMES = ["Asa", "Hiru", "Yoru"];

export function readTheme(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage).getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : "Asa";
  } catch {
    return "Asa";
  }
}

export function saveTheme(storage, theme) {
  if (!THEMES.includes(theme)) return false;
  try {
    (storage ?? globalThis.localStorage).setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
