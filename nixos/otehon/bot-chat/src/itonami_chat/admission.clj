(ns itonami-chat.admission
 (:require [cheshire.core :as j] [clojure.edn :as edn] [itonami.otehon.etcd :as e]
  [itonami.otehon.occurrence :as o] [itonami.otehon.peer-talk :as p]))
(defn -main []
 (let [{:keys [etcdConfig request grant turn inputSha]} (j/parse-string (slurp *in*) true)
       c (e/client (edn/read-string (slurp etcdConfig)))
       keys (o/keys-for (:bot-id request) (:job-id request) (:slot request))
       enrollment ((:read c) (:enrollment keys)) claim ((:read c) (:occurrence keys)) cursor ((:read c) (:cursor keys))
       leader (subs (get-in grant [:participants 0 :bot-id]) 8)
       expected {:state "admitted" :slot (:slot request) :attempt-id (:attempt-id request) :occurrence (:occurrence keys)}]
  (println (j/generate-string {:verified
   (boolean (and (p/valid-grant? grant) (integer? (:initial-slot grant))
    (= leader (:bot-id request)) (= (str "peer-cycle-" (:cycle-id grant)) (:job-id request))
    (= (+ (:initial-slot grant) (* 1000 turn)) (:slot request))
    (= (:project-id grant) (:project-id request)) (= (:initiative-id grant) (:initiative-id request))
    (= (:issue-id grant) (:issue-id request)) (= (:model grant) (:model request)) (= "meta" (:provider request))
    (= "peer-conversation-v1" (:executor request)) (= inputSha (:input-sha request))
    (= (p/grant-cid grant) (:grant-cid request)) (= grant (:grant enrollment)) (o/enrollment-valid? enrollment)
    (= "admitted" (:state claim)) (= request (:request claim)) (= (:authenticated-node c) (:node claim))
    (= (o/digest enrollment) (:enrollment-sha claim)) (= expected cursor)))}))))
