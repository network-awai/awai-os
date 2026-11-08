(ns d1.dispatch
  "Otehon host orchestration over trusted effect adapters.

  This namespace does not implement crypto, a durable reservation store or an
  OCI runtime. The trusted embedding host must provide those adapters; never
  obtain them or their verified facts from a request. No adapter is installed
  by this namespace. An unknown result fails closed."
  (:require [d1.core :as core]))

(defn- binding [request]
  (select-keys request [:job :node :policy :artifact :lease]))

(defn- verified-consents [host request now]
  (let [verify (:verify-consent host)]
    (when (fn? verify)
      {:provider (verify :provider (:provider-consent request) (binding request) now)
       :requester (verify :requester (:requester-consent request) (binding request) now)})))

(defn- scoped? [consent role expected now]
  (and (map? consent) (= true (:authenticated? consent))
       (= false (:revoked? consent)) (= role (:role consent))
       (= "public" (:data-class consent)) (= expected (:binding consent))
       (integer? (:expires consent)) (> (:expires consent) now)))

(defn dispatch!
  "Execute a contribution only via a trusted host.

  :reserve! must perform one atomic durable reservation and return its capacity
  snapshot and signed/scoped reservation. :revalidate! must check the exact
  reservation, lease, revocation and fence with current authority immediately
  before launch; :launch! must enforce that fence and the plan's limits at the
  effect boundary. Returned :unknown never authorizes retry or release.
  An adapter exception is not a successful result; the host must reconcile any
  reservation whose outcome is unknown."
  [host request]
  (if-not (and (map? host) (map? request)
               (every? fn? (map host [:clock :verify-consent :reserve! :revalidate! :launch!])))
    {:status :refused :cause :host-unavailable}
    (let [now ((:clock host))
          expected (binding request)
          valid-input? (and (integer? now) (pos? now)
                            (= 5 (count expected))
                            (every? #(and (string? %) (not= "" %)) (vals expected))
                            (integer? (:demand request)) (pos? (:demand request)))
          consents (when valid-input? (verified-consents host request now))]
      (if-not (and valid-input?
                   (scoped? (:provider consents) "provider" expected now)
                   (scoped? (:requester consents) "requester" expected now))
        {:status :refused :cause :consent-unverified}
        (let [held ((:reserve! host) (binding request) (:demand request))]
          (if-not (= :reserved (:status held))
            {:status :unknown :cause :reservation-unconfirmed}
            (let [plan (core/contribution-dispatch-plan
                        (merge (binding request)
                               {:now now :provider-consent (:provider consents)
                                :requester-consent (:requester consents)
                                :reservation (:reservation held) :capacity (:capacity held)}))]
              (if-not (and (= :launch-plan (:decision plan))
                           (= (:demand request) (get-in held [:capacity :demand])))
                {:status :refused :cause :plan-refused :plan plan :reservation :held}
                (let [fresh-now ((:clock host))
                      fresh-consents (verified-consents host request fresh-now)
                      fresh-plan (core/contribution-dispatch-plan
                                   (merge (binding request)
                                          {:now fresh-now :provider-consent (:provider fresh-consents)
                                           :requester-consent (:requester fresh-consents)
                                           :reservation (:reservation held) :capacity (:capacity held)}))
                      fresh (when (and (integer? fresh-now) (>= fresh-now now)
                                       (= :launch-plan (:decision fresh-plan)))
                              ((:revalidate! host) fresh-plan))]
                  (if-not (= :valid fresh)
                    {:status :unknown :cause :revalidation-failed :reservation :held}
                    ((:launch! host) fresh-plan)))))))))))
