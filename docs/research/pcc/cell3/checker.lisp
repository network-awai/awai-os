; Cell 3 -- independent surface-rewrite checker (must not call the desugar model DG)
; Proof object: ((claim sugar pure) (steps ((rule path) ...)))
; Metavariables are the ?-symbols in *metavars*; every other atom is a literal, so
; :else matches only :else.  Refusal is a multiple value, so it can never be
; mistaken for a term.
(in-package "ACL2")

(defconst *metavars* '(?c ?a ?b ?t1 ?e1 ?e2 ?e ?k ?r ?d ?rest))

;; rule = (name lhs-pattern rhs-template capture-flag)
(defconst *rules*
  '((if-not      (if-not ?c ?a ?b)        (if (not ?c) ?a ?b)              nil)
    (if-not-swap (if (not ?c) ?a ?b)      (if ?c ?b ?a)                    nil)
    (cond-2      (cond ?t1 ?e1 :else ?e2) (if ?t1 ?e1 ?e2)                 nil)
    (cond-step   (cond ?t1 ?e1 . ?rest)     (if ?t1 ?e1 (cond . ?rest))      nil)))
;; case-1 is absent: its correctness theorem (rules-correct.lisp) is not proved,
;; and a rule that is not proved correct does not belong in the table.

(defun freep (v x)
  (if (atom x) (equal v x) (or (freep v (car x)) (freep v (cdr x)))))

(defun match-pat (pat x al)
  (cond ((member-eq pat *metavars*)
         (let ((hit (assoc-eq pat al)))
           (if hit (if (equal (cdr hit) x) al :fail) (cons (cons pat x) al))))
        ((atom pat) (if (equal pat x) al :fail))
        ((atom x) :fail)
        (t (let ((al1 (match-pat (car pat) (car x) al)))
             (if (eq al1 :fail) :fail (match-pat (cdr pat) (cdr x) al1))))))

(defun instantiate (tmpl al)
  (cond ((member-eq tmpl *metavars*) (cdr (assoc-eq tmpl al)))
        ((atom tmpl) tmpl)
        (t (cons (instantiate (car tmpl) al) (instantiate (cdr tmpl) al)))))

;; side conditions a pattern alone cannot express
(defun guard-ok (rule m x)
  (cond ((equal (car rule) 'cond-step)
         (and (consp (cdr (assoc-eq '?rest m)))     ; at least one clause follows
              (not (equal (cadr x) :else))))       ; :else may only be final
        ((equal (car rule) 'cond-2)
         (not (equal (cadr x) :else)))             ; the test may not be :else itself
        (t t)))

(defun rule-match (rule x)
  (let ((m (match-pat (cadr rule) x nil)))
    (if (eq m :fail) :fail (if (guard-ok rule m x) m :fail))))

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

;; (mv ok term); ok is nil on any refusal, so :fail never travels as a term
(defun apply-step (x name p)
  (let ((rule (find-rule name *rules*)))
    (if (null rule)
        (mv nil nil)
      (let ((sub (fetch x p)))
        (if (eq sub :fail)
            (mv nil nil)
          (let ((m (rule-match rule sub)))
            (if (eq m :fail)
                (mv nil nil)
              (mv t (embed x p (instantiate (caddr rule) m))))))))))

(defun run (x steps)
  (declare (xargs :measure (acl2-count steps)))
  (if (endp steps)
      (mv t x)
    (mv-let (ok nxt)
            (apply-step x (car (car steps)) (cadr (car steps)))
            (if ok (run nxt (cdr steps)) (mv nil nil)))))

(defun terms-of (x steps)
  (declare (xargs :measure (acl2-count steps)))
  (if (endp steps)
      nil
    (mv-let (ok nxt)
            (apply-step x (car (car steps)) (cadr (car steps)))
            (if ok (cons nxt (terms-of nxt (cdr steps))) nil))))

(defun check (claim steps)
  (mv-let (ok res) (run (car claim) steps)
          (if ok (equal res (cadr claim)) nil)))
