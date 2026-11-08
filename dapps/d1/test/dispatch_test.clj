(ns dispatch-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [d1.dispatch :as dispatch]))

(def binding {:job "job-a" :node "node-a" :policy "policy-a"
              :artifact (str "sha256:" (apply str (repeat 64 "a"))) :lease "lease-a"})
(def request (merge binding {:demand 2 :provider-consent :signed-provider
                             :requester-consent :signed-requester}))

(defn fixture [overrides]
  (let [events (atom [])
        clock (atom [100 101])
        host {:clock (fn [] (let [t (first @clock)] (swap! clock #(if (next %) (vec (next %)) %)) t))
              :verify-consent (fn [role token b now]
                                (swap! events conj [:verify role])
                                {:authenticated? (= token (keyword (str "signed-" (name role))))
                                 :revoked? false :role (name role) :data-class "public"
                                 :binding b :expires 200})
              :reserve! (fn [b amount]
                          (swap! events conj :reserve)
                          {:status :reserved
                           :reservation {:verified? true :persisted? true :state :active
                                         :binding b :expires 190 :fence 1 :amount amount}
                           :capacity {:demand amount :qualified 10 :reserve 1 :committed 2
                                      :unmanaged 1 :fresh? true :dry-run? false}})
              :revalidate! (fn [_] (swap! events conj :revalidate) :valid)
              :launch! (fn [_] (swap! events conj :launch) {:status :started})}]
    [(merge host overrides) events clock]))

(deftest real-effects-require-all-stages
  (let [[host events _] (fixture {})]
    (is (= {:status :started} (dispatch/dispatch! host request)))
    (is (= [[:verify :provider] [:verify :requester] :reserve
            [:verify :provider] [:verify :requester] :revalidate :launch] @events)))
  (let [[host events _] (fixture {})]
    (is (= :consent-unverified (:cause (dispatch/dispatch! host (assoc request :requester-consent :forged)))))
    (is (not (some #{:reserve :launch} @events))))
  (let [[host events _] (fixture {:reserve! (fn [_ _] {:status :unknown})})]
    (is (= :reservation-unconfirmed (:cause (dispatch/dispatch! host request))))
    (is (not (some #{:launch} @events))))
  (let [[host events _] (fixture {:revalidate! (fn [_] :revoked)})]
    (is (= :revalidation-failed (:cause (dispatch/dispatch! host request))))
    (is (not (some #{:launch} @events))))
  (let [[host events _] (fixture {})]
    (is (= :consent-unverified (:cause (dispatch/dispatch! host (assoc request :demand 0)))))
    (is (empty? @events)))
  (let [[host events clock] (fixture {})]
    (reset! clock [101 100])
    (is (= :revalidation-failed (:cause (dispatch/dispatch! host request))))
    (is (not (some #{:launch} @events))))
  (let [[host events clock] (fixture {})]
    (reset! clock [100 200])
    (is (= :revalidation-failed (:cause (dispatch/dispatch! host request))))
    (is (not (some #{:launch} @events))))
  (let [[host events _] (fixture {})
        verify (:verify-consent host)
        calls (atom 0)
        changing (assoc host :verify-consent
                        (fn [role token b now]
                          (swap! calls inc)
                          (assoc (verify role token b now) :revoked? (> @calls 2))))]
    (is (= :revalidation-failed (:cause (dispatch/dispatch! changing request))))
    (is (not (some #{:launch} @events))))
  (let [[host events _] (fixture {})
        reserve (:reserve! host)
        changed (assoc host :reserve!
                       (fn [b amount] (assoc-in (reserve b amount) [:reservation :binding :lease] "other")))]
    (is (= :plan-refused (:cause (dispatch/dispatch! changed request))))
    (is (not (some #{:launch} @events))))
  (let [[host events _] (fixture {})
        reserve (:reserve! host)
        changed (assoc host :reserve! (fn [b _] (reserve b 1)))]
    (is (= :plan-refused (:cause (dispatch/dispatch! changed request))))
    (is (not (some #{:launch} @events))))
  (is (= :host-unavailable (:cause (dispatch/dispatch! {} request)))))

(let [r (run-tests 'dispatch-test)]
  (System/exit (if (zero? (+ (:fail r) (:error r))) 0 1)))
