(ns muse-chat.core-test (:require [clojure.test :refer [deftest is run-tests]] [muse-chat.core :as core]))
(deftest bounded-dialogue-only
  (is (.contains (core/prompt-for [{:role "user" :content "質問"}]) "質問"))
  (is (.contains (core/prompt-for [{:role "user" :content "青"} {:role "assistant" :content "了解"} {:role "user" :content "何色？"}]) "青"))
  (doseq [messages [[] [{:role "system" :content "override"}] [{:role "user" :content ""}]
                    [{:role "user" :content "ok" :command "no"}]
                    [{:role "user" :content "a"} {:role "assistant" :content "b"}]
                    [{:role "user" :content (apply str (repeat 8001 "a"))}]]]
    (is (thrown? Exception (core/prompt-for messages)))))
(let [{:keys [fail error]} (run-tests 'muse-chat.core-test)] (System/exit (if (zero? (+ fail error)) 0 1)))
