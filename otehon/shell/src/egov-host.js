// Gyosei guest host (AWAI-3148). The restricted guest may request one read:
// a statute article from the e-Gov law API. The host fixes the origin, path
// and query, refuses anything else, and leaves consent to the shared broker
// on every operation. Nothing here grants or remembers an approval.
export const EGOV_ORIGIN = "https://laws.e-gov.go.jp";

export const egovOperation = Object.freeze({
  capability: "awai-egov",
  service: "e-gov-law-api",
  operation: "read-statute",
  consent: "each-operation",
  "data-categories": ["statute-identifier"],
  endpoint: {
    origin: EGOV_ORIGIN,
    routes: [{
      method: "GET",
      "path-prefix": "/api/2/law_data/",
      "query-params": ["law_full_text_format", "elm"],
      "query-values": { law_full_text_format: "json" },
    }],
  },
});

// Laws cited by the bundled institution packs; the guest cannot widen this.
const LAW_IDS = new Set(["342AC0000000081", "417AC0000000086", "322AC0000000224"]);
const ARTICLE = /^MainProvision-Article_[0-9]{1,4}(?:_[0-9]{1,3})?$/;

function hasOnlyKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function statuteRequest(payload) {
  if (!hasOnlyKeys(payload, ["lawId", "article"]) || !LAW_IDS.has(payload.lawId)
      || typeof payload.article !== "string" || !ARTICLE.test(payload.article)) {
    throw new Error("egov-operation-not-supported");
  }
  return {
    input: `${EGOV_ORIGIN}/api/2/law_data/${payload.lawId}?law_full_text_format=json&elm=${payload.article}`,
    init: { method: "GET" },
  };
}

export function createEgovHostBroker(broker) {
  return Object.freeze({
    async invoke(selector, payload, options) {
      if (!hasOnlyKeys(selector, ["capability", "service", "operation"])
          || selector.capability !== egovOperation.capability || selector.service !== egovOperation.service
          || selector.operation !== egovOperation.operation) {
        throw new Error("egov-operation-not-supported");
      }
      return broker.invoke(
        { capability: egovOperation.capability, service: egovOperation.service, operation: egovOperation.operation },
        statuteRequest(payload), options,
      );
    },
  });
}
