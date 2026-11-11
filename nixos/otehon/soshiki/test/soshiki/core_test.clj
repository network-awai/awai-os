(ns soshiki.core-test
  "Mirrors shell/test/soshiki.test.js case for case: the .cljc twin must
  decide exactly what the JS twin decides. Run it with Babashka:
  bb -cp src:test test/soshiki/core_test.clj"
  (:require [clojure.test :refer [deftest is run-tests testing]]
            [soshiki.core :as core]))

(defn- circle [state name & [purpose parent-id]]
  (let [done (core/add-circle state {:name name :purpose (or purpose "目的") :parent-id parent-id})]
    (is (nil? (:error done)))
    (:state done)))

(deftest seed-builds-a-nested-org-with-a-bot-filled-role
  (let [state (core/seed-state)
        size (core/compute-size state)]
    (is (= 3 (count (:circles state))))
    (is (= 3 (count (:roles state))))
    (is (= 1 (count (:bots state))))
    (is (= {:circles 3 :roles 3 :filled 1 :open 2 :bots 1 :people 0 :proposals-open 0}
           (:totals size)))
    (let [general (first (filter #(= "全体サークル" (:name %)) (:rows size)))]
      (is (= 3 (:subtree-roles general)))
      (is (= 1 (:subtree-members general))))))

(deftest circle-names-and-parents-are-validated
  (let [state (core/blank-state)]
    (is (= "bad-name" (:error (core/add-circle state {:name "" :purpose "目的" :parent-id nil}))))
    (is (= "bad-purpose" (:error (core/add-circle state {:name "A" :purpose "" :parent-id nil}))))
    (is (= "unknown-parent" (:error (core/add-circle state {:name "A" :purpose "目的" :parent-id "c9"}))))
    (let [state (circle state "全体")
          general (:id (first (:circles state)))
          state (circle state "子" "目的" general)
          child (:id (first (filter #(= "子" (:name %)) (:circles state))))]
      (is (= "bad-parent" (:error (core/move-circle state {:id general :parent-id child}))))
      (is (= "bad-parent" (:error (core/move-circle state {:id child :parent-id child}))))
      (let [moved (core/move-circle state {:id child :parent-id nil})]
        (is (nil? (:error moved)))
        (is (nil? (:parent-id (core/circle-by-id (:state moved) child))))))))

(deftest a-circle-with-children-or-roles-cannot-be-removed
  (let [state (circle (core/blank-state) "全体")
        general (:id (first (:circles state)))
        state (circle state "子" "目的" general)
        child (:id (first (filter #(= "子" (:name %)) (:circles state))))]
    (is (= "circle-has-children" (:error (core/remove-circle state general))))
    (let [state (:state (core/add-role state {:circle-id child :name "見守り" :purpose "見守る"}))]
      (is (= "circle-not-empty" (:error (core/remove-circle state child))))
      (let [state (:state (core/remove-role state (:id (first (:roles state)))))]
        (is (= 1 (count (:circles (:state (core/remove-circle state child))))))))))

(deftest roles-assign-to-bots-and-people-and-unassign-cleanly
  (let [state (circle (core/blank-state) "全体")
        general (:id (first (:circles state)))
        state (:state (core/add-role state {:circle-id general :name "記録係" :purpose "記録する"
                                             :accountabilities ["記録"] :skills ["notes"]}))
        role-id (:id (first (:roles state)))
        state (:state (core/add-bot state {:name "Manimani" :circle-ids [general]}))
        state (:state (core/assign-role state {:role-id role-id :assignee {:kind "bot" :name "Manimani"}}))]
    (is (= "Manimani" (:name (:assignee (first (:roles state))))))
    (is (= [role-id] (:role-ids (first (:bots state)))))
    (let [state (:state (core/assign-role state {:role-id role-id :assignee {:kind "person" :name "Jun"}}))]
      (is (= "Jun" (:name (:assignee (first (:roles state))))))
      (is (empty? (:role-ids (first (:bots state)))))
      (is (= 1 (:people (:totals (core/compute-size state)))))
      (let [state (:state (core/assign-role state {:role-id role-id :assignee nil}))]
        (is (nil? (:assignee (first (:roles state)))))
        (is (= 1 (:open (:totals (core/compute-size state)))))))))

(deftest bot-profiles-validate-names-skills-and-approval
  (let [state (core/seed-state)]
    (is (= "bot-exists" (:error (core/add-bot state {:name "Manimani"}))))
    (is (= "bad-name" (:error (core/add-bot state {:name ""}))))
    (is (= "bad-approval" (:error (core/add-bot state {:name "New" :approval "maybe"}))))
    (let [bot-id (:id (first (:bots state)))]
      (is (= "bad-approval" (:error (core/update-bot state {:id bot-id :approval "maybe"}))))
      (let [state (:state (core/update-bot state {:id bot-id :purpose "更新" :skills ["a" "b"] :approval "ask"}))]
        (is (= "更新" (:purpose (first (:bots state)))))
        (is (= ["a" "b"] (:skills (first (:bots state)))))
        (let [state (:state (core/remove-bot state bot-id))]
          (is (empty? (:bots state)))
          (is (nil? (:assignee (first (filter #(= "見守り" (:name %)) (:roles state)))))))))))

(deftest proposals-open-and-then-close-once
  (let [state (:state (core/add-proposal (core/blank-state) 1000 {:title "見守りを二人制に" :detail "夜間も見る"}))
        id (:id (first (:proposals state)))]
    (is (= "open" (:status (first (:proposals state)))))
    (let [state (:state (core/decide-proposal state {:id id :accept true}))]
      (is (= "accepted" (:status (first (:proposals state)))))
      (is (= "proposal-closed" (:error (core/decide-proposal state {:id id :accept false})))))))

(deftest size-rows-carry-depth-fill-rate-and-subtree-sums
  (let [state (circle (core/blank-state) "全体")
        general (:id (first (:circles state)))
        state (circle state "子" "目的" general)
        child (:id (first (filter #(= "子" (:name %)) (:circles state))))
        state (:state (core/add-role state {:circle-id general :name "R1" :purpose "p"
                                             :assignee {:kind "person" :name "A"}}))
        state (:state (core/add-role state {:circle-id child :name "R2" :purpose "p"}))
        size (core/compute-size state)]
    (is (= 1 (:max-depth size)))
    (let [row (first (filter #(= general (:id %)) (:rows size)))]
      (is (= 1 (:direct-roles row)))
      (is (= 2 (:subtree-roles row)))
      (is (= 1 (:fill-rate row))))
    (let [kid (first (filter #(= child (:id %)) (:rows size)))]
      (is (= 1 (:depth kid)))
      (is (= 0 (:fill-rate kid))))))

(deftest circle-path-returns-the-root-to-circle-breadcrumb
  (let [state (circle (core/blank-state) "全体")
        general (:id (first (:circles state)))
        state (circle state "子" "目的" general)
        child (:id (first (filter #(= "子" (:name %)) (:circles state))))
        state (circle state "孫" "目的" child)
        grand (:id (first (filter #(= "孫" (:name %)) (:circles state))))]
    (is (= ["全体" "子" "孫"] (mapv :name (core/circle-path state grand))))
    (is (= ["全体"] (mapv :name (core/circle-path state general))))
    (is (= [] (core/circle-path state "c9")))))

(deftest the-signed-in-person-has-a-readable-name-and-a-my-roles-list
  (is (nil? (core/person-name-for-account nil)))
  (is (nil? (core/person-name-for-account "")))
  (is (= "did:key:zShort" (core/person-name-for-account "did:key:zShort")))
  (let [long "did:pkh:eip155:1:0x0000000000000000000000000000000000000001"]
    (is (= (str (subs long 0 14) "…" (subs long (- (count long) 8)))
           (core/person-name-for-account long)))
    (let [state (circle (core/blank-state) "全体")
          general (:id (first (:circles state)))
          me (core/person-name-for-account long)
          state (:state (core/add-role state {:circle-id general :name "記録係" :purpose "記録する"
                                               :assignee {:kind "person" :name me}}))
          state (:state (core/add-role state {:circle-id general :name "見守り" :purpose "見守る"
                                               :assignee {:kind "bot" :name "Manimani"}}))
          mine (core/my-roles state me)]
      (is (= 1 (count mine)))
      (is (= "記録係" (:name (first mine))))
      (is (= [] (core/my-roles state "someone-else")))
      (is (= [] (core/my-roles state nil))))))

(deftest subtree-roles-collects-the-circle-and-its-descendants
  (let [state (circle (core/blank-state) "全体")
        general (:id (first (:circles state)))
        state (circle state "子" "目的" general)
        child (:id (first (filter #(= "子" (:name %)) (:circles state))))
        state (:state (core/add-role state {:circle-id general :name "R1" :purpose "p"}))
        state (:state (core/add-role state {:circle-id child :name "R2" :purpose "p"}))]
    (is (= ["R1" "R2"] (sort (map :name (core/subtree-roles state general)))))
    (is (= ["R2"] (mapv :name (core/subtree-roles state child))))
    (is (= [] (core/subtree-roles state "c9")))))

(deftest parse-list-splits-commas-japanese-commas-and-lines
  (is (= ["a" "b" "c" "d"] (core/parse-list "a, b、c\nd")))
  (is (= [] (core/parse-list "  , "))))

(deftest bad-shapes-fall-back-to-the-seed
  (is (= (core/seed-state) (core/settle-soshiki {:nope true}))))

(let [{:keys [fail error]} (run-tests 'soshiki.core-test)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
