;; RFC 9180 A.2.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20Poly1305, base mode.
;; usage (from dapps/sanka): nbb -cp host test/host/hpke_test.cljs
(ns hpke-test
  (:require [sanka.hpke :as hpke]))

(defn- hex [text] (js/Buffer.from text "hex"))
(defn- show [b] (.toString b "hex"))

(def vector
  {:info "4f6465206f6e2061204772656369616e2055726e"
   :skE "f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600"
   :pkE "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a"
   :skR "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb"
   :pkR "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a"
   :shared "0bbe78490412b4bbea4812666f7916932b828bba79942424abb65244930d69a7"
   :key "ad2744de8e17f4ebba575b3f5f5a8fa1f69c2a07f6e7500bc60ca6e3e3ec1c91"
   :nonce "5c4d98150661b848853b547f"
   :exporter "a3b010d4994890e2c6968a36f64470d3c824c8f5029942feb11e7a74b2921922"
   :pt "4265617574792069732074727574682c20747275746820626561757479"
   :aad "436f756e742d30"
   :ct "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28"
   :exports [["" "4bbd6243b8bb54cec311fac9df81841b6fd61f56538a775e7c80a9f40160606e"]
             ["00" "8c1df14732580e5501b00f82b10a1647b40713191b7c1240ac80e2b68808ba69"]
             ["54657374436f6e74657874" "5acb09211139c43b3090489a9da433e8a30ee7188ba8b0a9a1ccf0c229283e53"]]})

(def failures (atom []))
(defn- check [name want got] (when-not (= want got) (swap! failures conj (str name " want " want " got " got))))

(let [{:keys [enc context]} (hpke/setup-sender (hex (:pkR vector)) (hex (:info vector)) (hex (:skE vector)))
      receiver (hpke/setup-receiver enc (hex (:skR vector)) (hex (:info vector)))
      sealed (hpke/seal context (hex (:aad vector)) (hex (:pt vector)))]
  (check "pkR from skR" (:pkR vector) (show (hpke/raw-public (hpke/private-key (hex (:skR vector))))))
  (check "enc" (:pkE vector) (show enc))
  (doseq [[side ctx] [["sender" context] ["receiver" receiver]]]
    (check (str side " shared_secret") (:shared vector) (show (:shared ctx)))
    (check (str side " key") (:key vector) (show (:key ctx)))
    (check (str side " base_nonce") (:nonce vector) (show (:nonce ctx)))
    (check (str side " exporter_secret") (:exporter vector) (show (:exporter ctx)))
    (doseq [[exporter-context value] (:exports vector)]
      (check (str side " export " exporter-context) value (show (hpke/export ctx (hex exporter-context) 32)))))
  (check "ct" (:ct vector) (show sealed))
  (check "open" (:pt vector) (some-> (hpke/open receiver (hex (:aad vector)) sealed) show))
  (let [tampered (js/Buffer.from sealed)]
    (aset tampered 0 (bit-xor (aget tampered 0) 1))
    (check "tampered ciphertext does not open" nil (hpke/open receiver (hex (:aad vector)) tampered)))
  (check "other aad does not open" nil (hpke/open receiver (hex "00") sealed))
  (let [other (hpke/setup-receiver enc (hpke/generate-private) (hex (:info vector)))]
    (check "other key does not open" nil (hpke/open other (hex (:aad vector)) sealed)))
  (let [other (hpke/setup-receiver enc (hex (:skR vector)) (hex "00"))]
    (check "other info does not open" nil (hpke/open other (hex (:aad vector)) sealed))))

(doseq [f @failures] (println "FAIL" f))
(println "hpke vector checks failures" (count @failures))
(js/process.exit (if (seq @failures) 1 0))
