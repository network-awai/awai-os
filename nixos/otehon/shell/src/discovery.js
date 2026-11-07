// A read-only index snapshot. Listings are untrusted metadata, not installed code.
export const REGISTRY_REVISION = "f107a79ba3ee9491956419c1b1093bbb98d91451";
export const REGISTRY_SHA256 = "7064c8475e83e3ab68fc3dc1a40f68ef5341dd25245a570eba17bb1c408f2c64";

export function searchRegistry(index, query, limit = 30) {
  if (!Array.isArray(index?.entries) || typeof query !== "string") return [];
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return index.entries.filter((item) =>
    item && typeof item.id === "string" && typeof item.type === "string" &&
    [item.id, item.name, item.description, item.type].some((value) =>
      typeof value === "string" && value.toLocaleLowerCase().includes(term)))
    .slice(0, Math.min(Math.max(limit, 0), 30));
}
