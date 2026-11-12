// The endpoint is a separate local platform service, never the app origin.
// The canonical broker obtains a fresh trusted choice before every request.
export async function readExistingProfiles(broker, signal) {
  const response = await broker.invoke(
    { capability: "awai-profile-catalog", service: "local-itonami-profiles", operation: "list-profiles" },
    { input: "https://127.0.0.1:8777/v1/itonami/profiles", init: { method: "GET" } },
    signal ? { signal } : {},
  );
  if (!response.ok) throw new Error("profile-catalog-unavailable");
  const body = await response.json();
  if (body?.schema !== "awai.itonami.profile-catalog.v1" || !Array.isArray(body.profiles)
      || body.profiles.length > 10000) throw new Error("invalid-profile-catalog");
  const ids = new Set();
  return body.profiles.map(row => {
    if (!row || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id)
        || ids.has(row.id) || typeof row.description !== "string" || row.description.length > 280
        || !Array.isArray(row.skills) || row.skills.length > 12
        || row.skills.some(skill => typeof skill !== "string" || !skill.trim() || skill.length > 80)) {
      throw new Error("invalid-profile-catalog");
    }
    ids.add(row.id);
    return { id: row.id, description: row.description, skills: [...row.skills] };
  });
}
