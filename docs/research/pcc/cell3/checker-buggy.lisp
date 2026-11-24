; Cell 3 -- independent surface-rewrite checker (must not call the desugar model DG)
; Proof object: ((claim sugar pure) (steps ((rule path) ...)))
; The intermediate terms are NOT carried; the checker rebuilds every one.
(in-package "ACL2")

;; ---------------------------------------------------------------- rules as data
;; (name lhs-pattern rhs-template capture-flag)
(defconst *rules*
  '((if-not      (if-not :c :a :b)        (if (not :c) :a :b)             nil)
    (if-not-swap (if (not :c) :a :b)      (if :c :b :a)                   nil)
    (cond-2      (cond :t1 :e1 :else :e2) (if :t1 :e1 :e2)                nil)
    (cond-step   (cond :t1 :e1 . :rest)   (if :t1 :e1 (cond . :rest))     nil)
    (case-1      (case :e :k :r :d)       (let (t :e) (if (= t :k) :r :d)) t)))

(defun freep (v x)
  (if (atom x) (equal v x) (or (freep v (car x)) (freep v (cdr x)))))

;; ------------------------------------------------------------- match / rebuild
(defun match-pat (pat x al)
  (cond ((atom pat)
         (if (keywordp pat)
             (let ((hit (assoc-equal pat al)))
               (if hit (if (equal (cdr hit) x) al :fail) (cons (cons pat x) al)))
           (if (equal pat x) al :fail)))
        ((atom x) :fail)
        (t (let ((al1 (match-pat (car pat) (car x) al)))
             (if (eq al1 :fail) :fail (match-pat (cdr pat) (cdr x) al1))))))

(defun instantiate (tmpl al)
  (cond ((atom tmpl) (if (keywordp tmpl) (cdr (assoc-equal tmpl al)) tmpl))
        (t (cons (instantiate (car tmpl) al) (instantiate (cdr tmpl) al)))))

(defun rule-match (rule x)
  (let ((m (match-pat (cadr rule) x nil)))
    (if (eq m :fail)
        :fail
      (if (and (caddr rule)
               (or (freep 't (cdr (assoc-equal :r m)))
                   (freep 't (cdr (assoc-equal :d m)))))
          :fail
        m))))

;; ------------------------------------------------------- positions: fetch/embed
(defun fetch (x p)
  (if (endp p)
      x
    (if (and (consp x) (integerp (car p)) (<= 0 (car p)) (< (car p) (len x)))
        (fetch (nth (car p) x) (cdr p))
      :fail)))

(defun embed (x p v)
  (if (endp p)
      v
    (if (and (consp x) (integerp (car p)) (<= 0 (car p)) (< (car p) (len x)))
        (update-nth (car p) (embed (nth (car p) x) (cdr p) v) x)
      :fail)))

;; ------------------------------------- declarative one-step relation (no names)
(defun rewrites-at-rules (rules x p)
  (if (endp rules)
      nil
    (let ((sub (fetch x p)))
      (if (eq sub :fail)
          nil
        (let ((m (rule-match (car rules) sub)))
          (if (eq m :fail)
              (rewrites-at-rules (cdr rules) x p)
            (cons (embed x p (instantiate (caddr (car rules)) m))
                  (rewrites-at-rules (cdr rules) x p))))))))

;; declarative one-step: root redex, or recur into car / cdr (one-hole decomposition)
(defun root-step-rules (rules x u)
  (if (endp rules)
      nil
    (let ((m (rule-match (car rules) x)))
      (if (and (not (eq m :fail))
               (equal (instantiate (caddr (car rules)) m) u))
          t
        (root-step-rules (cdr rules) x u)))))

(defun root-step (x u)
  (if (root-step-rules *rules* x u) t nil))

(defun step-rel (x u)
  (if (root-step x u)
      t
    (if (and (consp x) (consp u))
        (if (step-rel (car x) (car u))
            (if (equal (cdr x) (cdr u)) t nil)
          (if (equal (car x) (car u)) (step-rel (cdr x) (cdr u)) nil))
      nil)))

(defun rtc (x u ts)
  (if (endp ts)
      (equal x u)
    (if (step-rel x (car ts)) (rtc (car ts) u (cdr ts)) nil)))

;; ------------------------------------------------------ procedural side: check
(defun find-rule (name rules)
  (if (endp rules)
      nil
    (if (equal name (car (car rules))) (car rules) (find-rule name (cdr rules)))))

(defun apply-step (x name p)
  (let ((rule (find-rule name *rules*)))
    (if (null rule)
        :fail
      (let ((sub (fetch x p)))
        (if (eq sub :fail)
            :fail
          (let ((m (rule-match rule sub)))
            (if (eq m :fail) :fail (embed x p (instantiate (caddr rule) m)))))))))

(defun run (x steps)
  (declare (xargs :measure (acl2-count steps)))
  (if (endp steps)
      x
    (let ((nxt (apply-step x (car (car steps)) (cadr (car steps)))))
      (if (eq nxt :fail) :fail (run nxt (cdr steps))))))

(defun terms-of (x steps)
  (declare (xargs :measure (acl2-count steps)))
  (if (endp steps)
      nil
    (let ((nxt (apply-step x (car (car steps)) (cadr (car steps)))))
      (if (eq nxt :fail) nil (cons nxt (terms-of nxt (cdr steps)))))))

(defun check (claim steps)
  (if (equal (run (car claim) steps) (cadr claim)) t nil))
