; Cell 3 -- rule correctness, shown independently of the rule table and of MATCH-PAT.
; A tiny evaluator over the surface/pure language; one variable-quantified theorem
; per rule: for every environment, the two sides evaluate to the same value.
(in-package "ACL2")

(defun lookup (v env)
  (if (endp env) :undef
    (if (equal (car (car env)) v) (cdr (car env)) (lookup v (cdr env)))))

(defun free-of (v x)
  (if (atom x) (equal v x) (or (free-of v (car x)) (free-of v (cdr x)))))

(mutual-recursion
 (defun ev-cond (clauses env)
   (declare (xargs :measure (acl2-count clauses)))
  (if (endp clauses)
      :stuck
    (if (eq (car clauses) :else)
        (if (endp (cddr clauses)) (evl (cadr clauses) env) :stuck)
      (if (evl (car clauses) env)
          (evl (cadr clauses) env)
        (ev-cond (cddr clauses) env)))))

 (defun ev-case-branches (v rest env)
   (declare (xargs :measure (acl2-count rest)))
  (if (endp rest)
      :stuck
    (if (endp (cdr rest))
        (evl (car rest) env)
      (if (equal v (evl (car rest) env))
          (evl (cadr rest) env)
        (ev-case-branches v (cddr rest) env)))))

(defun evl (x env)
  (declare (xargs :measure (acl2-count x)))
  (cond ((integerp x) x)
        ((eq x t) t)
        ((eq x nil) nil)
        ((symbolp x) (lookup x env))
        ((consp x)
         (let ((h (car x)))
           (cond ((eq h 'if)
                  (if (evl (cadr x) env) (evl (caddr x) env) (evl (cadddr x) env)))
                 ((eq h 'if-not)
                  (if (evl (cadr x) env) (evl (cadddr x) env) (evl (caddr x) env)))
                 ((eq h 'not) (not (evl (cadr x) env)))
                 ((eq h '=) (equal (evl (cadr x) env) (evl (caddr x) env)))
                 ((eq h '<) (< (evl (cadr x) env) (evl (caddr x) env)))
                 ((eq h '+) (+ (evl (cadr x) env) (evl (caddr x) env)))
                 ((eq h 'let)
                  (evl (caddr x) (cons (cons (car (cadr x)) (evl (cadr (cadr x)) env)) env)))
                 ((eq h 'cond) (ev-cond (cdr x) env))
                 ((eq h 'case)
                  (if (endp (cdr x))
                      :stuck
                    (ev-case-branches (evl (cadr x) env) (cddr x) env)))
                 (t :stuck))))
        (t :stuck)))

)

;; ------------------------------------------------------------ one theorem per rule
(defthm rule-if-not
  (equal (evl (list 'if-not c a b) env)
         (evl (list 'if (list 'not c) a b) env)))

(defthm rule-if-not-swap
  (equal (evl (list 'if (list 'not c) a b) env)
         (evl (list 'if c b a) env)))

(defthm evl-ignore-unbound
  (implies (not (free-of v x))
           (equal (evl x (cons (cons v y) env)) (evl x env)))
  :hints (("Goal" :induct (evl x env))))

(defthm rule-cond-2
  (implies (not (equal t1 :else))
           (equal (evl (list 'cond t1 e1 :else e2) env)
                  (evl (list 'if t1 e1 e2) env))))

(defthm rule-cond-step
  (implies (and (consp rest)
                (not (equal (car rest) :else))
                (not (equal t1 :else)))
           (equal (evl (cons 'cond (cons t1 (cons e1 rest))) env)
                  (evl (list 'if t1 e1 (cons 'cond rest)) env))))

(defthm rule-case-1
  (implies (and (not (free-of 't k))
                (not (free-of 't r))
                (not (free-of 't d)))
           (equal (evl (list 'case e k r d) env)
                  (evl (list 'let (list 't e)
                            (list 'if (list '= 't k) r d))
                      env)))
  :hints (("Goal" :do-not-induct t
                  :use ((:instance evl-ignore-unbound
                                   (v 't) (x k) (y (evl e env)))
                        (:instance evl-ignore-unbound
                                   (v 't) (x r) (y (evl e env)))
                        (:instance evl-ignore-unbound
                                   (v 't) (x d) (y (evl e env)))))))
