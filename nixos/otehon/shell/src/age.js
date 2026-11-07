// A self-declaration, stored only on this device and scoped to the linked account.
// This is not age verification or a parental-control guarantee.
export const AGE_BANDS = Object.freeze(["under-13", "13-17", "18-plus"]);
const KEY_PREFIX = "otehon.age.v1:";
const RATING_LEVEL = Object.freeze({ general: 0, teen: 1, adult: 2 });
const AGE_LEVEL = Object.freeze({ "under-13": 0, "13-17": 1, "18-plus": 2 });

function keyFor(accountDid) {
  return typeof accountDid === "string" && accountDid.startsWith("did:") && accountDid.length <= 512
    ? KEY_PREFIX + accountDid
    : null;
}

export function readAgeBand(accountDid, storage) {
  const key = keyFor(accountDid);
  if (!key) return null;
  try {
    const band = (storage ?? globalThis.localStorage).getItem(key);
    return AGE_BANDS.includes(band) ? band : null;
  } catch {
    return null;
  }
}

export function saveAgeBand(accountDid, band, storage) {
  const key = keyFor(accountDid);
  if (!key || !AGE_BANDS.includes(band)) return false;
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(key, band);
    return target.getItem(key) === band;
  } catch {
    return false;
  }
}

// Unlabelled or invalid external content is hidden. The producer of content
// must supply a trustworthy classification; there is no classifier here.
export function allowsContent(ageBand, rating) {
  if (!Object.hasOwn(AGE_LEVEL, ageBand) || !Object.hasOwn(RATING_LEVEL, rating)) return false;
  return RATING_LEVEL[rating] <= AGE_LEVEL[ageBand];
}

// Existing string entries are messages the local user wrote in this preview.
// Structured entries represent content from a future connected source.
export function displayMessage(message, ageBand) {
  if (typeof message === "string") return message;
  if (message && typeof message.text === "string" && allowsContent(ageBand, message.rating)) {
    return message.text;
  }
  return null;
}
