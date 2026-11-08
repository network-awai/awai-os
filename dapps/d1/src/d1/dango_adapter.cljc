(ns d1.dango-adapter
  "Dango consent verifier for a trusted Otehon host.

  The host must supply pinned roots, trusted role and binding-to-resource
  mappings, and a verified, fresh revocation snapshot. This adapter does not
  fetch, authenticate, persist, or prevent rollback of that snapshot. It is
  not registered with the OS or available to an untrusted request."
  (:require [dango.chain :as chain]))

(defn- expiry-ms [decision]
  (let [s (get-in decision [:dango/effective :grant/expires])]
    (when (and (string? s) (= 12 (count s)) (every? #(<= (int \0) (int %) (int \9)) s))
      (* 1000 #?(:clj (Long/parseLong s) :cljs (js/parseInt s 10))))))

(defn make-verifier
  "Create dispatch's :verify-consent callback from host-owned configuration.

  load-revocations must return a verified snapshot {:cids <set> :as-of-ms n
  :expires-ms n}; nil, stale, future or malformed snapshots refuse. The host
  must authenticate and rollback-protect the snapshot before returning it.
  resource-of, holder-of and public-input? must derive their answers from the
  exact binding and trusted classification, not presentation-controlled facts.
  roots and kinds are pinned per role. max-revocation-age-ms is a trusted
  positive limit. This function does not implement those host obligations."
  [{:keys [load-revocations resource-of holder-of public-input? roots kinds max-revocation-age-ms]}]
  (when-not (and (fn? load-revocations) (fn? resource-of) (fn? holder-of) (fn? public-input?)
                 (map? roots) (map? kinds) (integer? max-revocation-age-ms)
                 (pos? max-revocation-age-ms))
    (throw (ex-info "dango host configuration required" {})))
  (fn [role presentation binding now]
    (let [snapshot (load-revocations)
          role-roots (get roots role)
          kind (get kinds role)
          resource (resource-of role binding)
          holder (holder-of role binding)]
      (when (and (contains? #{:provider :requester} role)
                 (integer? now) (pos? now)
                 (set? role-roots) (seq role-roots) (qualified-keyword? kind)
                 (= true (public-input? binding))
                 (string? resource) (not= "" resource)
                 (string? holder) (not= "" holder)
                 (map? snapshot) (set? (:cids snapshot))
                 (integer? (:as-of-ms snapshot)) (integer? (:expires-ms snapshot))
                 (<= 0 (:as-of-ms snapshot) now) (< now (:expires-ms snapshot))
                 (<= (- now (:as-of-ms snapshot)) max-revocation-age-ms))
        (let [decision (chain/verify presentation
                                    {:roots role-roots :revoked (:cids snapshot)
                                     :request {:req/kind kind :req/resource resource
                                               :req/holder holder :req/now (quot now 1000)}})
              expiry (expiry-ms decision)]
          (when (and (= true (:dango/allowed? decision)) (integer? expiry) (> expiry now))
            {:authenticated? true :revoked? false :role (name role)
             :data-class "public" :binding binding
             :expires (min expiry (:expires-ms snapshot))
             :dango-cids (:dango/cids decision)}))))))
