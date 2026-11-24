; Cell 3 soundness lemmas -- loaded after checker.lisp
(in-package "ACL2")

(defthm find-rule-member
  (implies (find-rule name rules)
           (member-equal (find-rule name rules) rules)))

(defthm root-step-rules-member
  (implies (and (member-equal rule rules)
                (not (eq (rule-match rule x) :fail))
                (equal (instantiate (caddr rule) (rule-match rule x)) u))
           (root-step-rules rules x u)))

(defthm root-step-by-rule
  (implies (not (eq (rule-match rule (fetch x p)) :fail))
           (root-step (fetch x p)
                      (instantiate (caddr rule) (rule-match rule (fetch x p)))))
  :hints (("Goal" :use ((:instance root-step-rules-member
                                   (rules *rules*)
                                   (u (instantiate (caddr rule)
                                                   (rule-match rule (fetch x p)))))))))

(defthm step-rel-update-nth
  (implies (and (integerp i) (<= 0 i) (< i (len x))
                (step-rel (nth i x) y))
           (step-rel x (update-nth i y x)))
  :hints (("Goal" :induct (nth i x))))

(defthm step-rel-of-embed
  (implies (step-rel (fetch x p) y)
           (step-rel x (embed x p y)))
  :hints (("Goal" :induct (fetch x p))))

(defthm apply-step-is-step-rel
  (implies (not (equal (apply-step x name p) :fail))
           (step-rel x (apply-step x name p)))
  :hints (("Goal" :induct (apply-step x name p))))

(defthm check-sound
  (implies (check claim steps)
           (rtc (car claim) (cadr claim) (terms-of (car claim) steps)))
  :hints (("Goal" :induct (terms-of (car claim) steps))))
