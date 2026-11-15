(require '[clojure.edn :as edn] '[otehon.ipld-forest :as catalog] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as blocks] '[kotobase.storage.core :as contract])
(import '[java.nio.file Files Paths StandardCopyOption])
(let [dir (first *command-line-args*)
      root "bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala"
      second-root "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"
      nonce-ref (str "nonce/v1/" root)
      nonce {:ref-name nonce-ref :marker-cid second-root}
      fixture (or (System/getenv "IPLD_SPLIT_FIXTURES") "nixos/otehon/storage/test/fixtures/prolly-forest/split")
      parts [{:root-cid root :path (str fixture "/0.forest")}
             {:root-cid second-root :path (str fixture "/1.forest")}]]
  (store/init! dir)
  (catalog/publish-file-group! dir "kotobase-blocks/a" root [(first parts)] 1)
  (let [before (store/read-store dir)
        reason (try (catalog/publish-file-group-and-ref! dir "kotobase-blocks/z" root parts 2 "receipt" nil root
                       (fn [_ _] false) nonce true) nil (catch Exception e (:type (ex-data e))))]
    (assert (= :closure-rejected reason)) (assert (= before (store/read-store dir))))
  (assert (:published? (catalog/publish-file-group-and-ref! dir "kotobase-blocks/z" root parts 2 "receipt" nil root
                           (fn [get-block target] (and (= root target) (every? #(some? (get-block %)) [root second-root]))) nonce true)))
  (let [s (store/read-store dir)
        log (edn/read-string (slurp (str dir "/" (get-in s [:root :log]) ".edn")))
        frame (last (get-in log [:value :frames]))]
    (assert (= :put-many (:op frame)))
    (assert (= #{"awai.ipld-forest-group/kotobase-blocks/z" "awai.kotobase-ref/receipt"
                 "awai.kotobase-group-binding/receipt" (str "awai.kotobase-ref/" nonce-ref)
                 (str "awai.kotobase-group-binding/" nonce-ref)}
               (set (map first (get-in frame [:payload :puts]))))))
  (assert (= root (:target (catalog/recover-bound-ref dir "receipt"))))
  (assert (= :missing-group-binding (try (catalog/recover-bound-ref dir "legacy") nil (catch Exception e (:type (ex-data e))))))
  (let [before (store/read-store dir)
        reason (try (catalog/publish-file-group-and-ref! dir "kotobase-blocks/z" root parts 3 "receipt" root root
                       (fn [_ _] true)) nil (catch Exception e (:type (ex-data e))))]
    (assert (= :group-binding-required reason))
    (assert (= before (store/read-store dir))))
  (catalog/publish-file-group! dir "kotobase-blocks/z" root [(first parts)] 3)
  (assert (= :invalid-group-binding (try (catalog/recover-bound-ref dir "receipt") nil (catch Exception e (:type (ex-data e))))))
  (catalog/publish-file-group! dir "kotobase-blocks/z" root parts 4)
  (assert (= root (:target (catalog/recover-bound-ref dir "receipt"))))
  (let [before (store/read-store dir) group (catalog/recover-group dir "kotobase-blocks/z")
        sha (get-in group [:group :archives 1 :archive-sha])
        original (Paths/get (str (store/forest-file-path dir sha)) (make-array String 0))
        saved (Paths/get (str dir "/saved-test-pack.forest") (make-array String 0))
        db (blocks/open-backend dir (str dir "/stage") "/nonexistent/forest-tool")]
   (Files/move original saved (make-array java.nio.file.CopyOption 0))
   (let [missing (try (catalog/recover-group dir "kotobase-blocks/z") :unexpected (catch Exception e (:type (ex-data e))))
         strict (try (catalog/recover-bound-ref dir "receipt") :unexpected (catch Exception e (:type (ex-data e))))
         ref (contract/-read-ref db "receipt") value (contract/get-block db root)
         after (store/read-store dir)]
    (assert (= :missing-forest missing)) (assert (= :missing-forest strict)) (assert (= root (:cid ref))) (assert (some? value))
    (assert (= before after))
    (prn {:specific-group :missing-forest :strict-bound-read :refused :legacy-global-cid-read :succeeded-from-other-group :root-unchanged true}))))
(shutdown-agents)
