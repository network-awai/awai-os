; SURFACE-MODEL-EVAL cell 2 -- :logic mode, fuel-bounded model, per-pair defthm
; Corpus: kotoba-lang/kotoba-lang d3d5fff3 lang/surface-equivalence-corpus.edn
;   blob 93c9ed9cdf9491e49f8a24cb40f3857a25c09067
;   sha256 62ecf9ec6302a9828fea34e58148342b65b169b73a794d8595b84474ffc44514
; Scope: defn, cond, if-not, case (structural rewrites). Threading carries an
; accumulator and stays out; those pairs are evaluation-only in cell 1.
; Uniform rule: ref-name-p is constant NIL -- no function name is special.
; Termination comes from the fuel argument N (measure (nfix n)), not from
; structural descent. A result is exact only when N exceeds the term's depth.
(in-package "ACL2")

(defun ref-name-p (x)
  (declare (ignore x))
  nil)

(mutual-recursion
 (defun dg (x n)
   (declare (xargs :measure (nfix n)))
   (if (zp n)
       nil
     (cond ((atom x) x)
           ((eq (car x) 'defn)
            (list 'defn (cadr x) (caddr x) (cadddr x) (dg (car (cddddr x)) (- n 1))))
           ((eq (car x) 'cond) (dg-cond (cdr x) (- n 1)))
           ((eq (car x) 'if-not)
            (list 'if (dg (cadr x) (- n 1)) (dg (cadddr x) (- n 1)) (dg (caddr x) (- n 1))))
           ((eq (car x) 'case)
            (list 'let (list 't (dg (cadr x) (- n 1))) (dg-case-if 't (cddr x) (- n 1))))
           ((and (symbolp (car x)) (ref-name-p (car x)) (consp (cdr x)) (null (cddr x)))
            (list 'app (list 'ref (car x)) (dg (cadr x) (- n 1))))
           (t (cons (car x) (dg-list (cdr x) (- n 1)))))))
 (defun dg-list (xs n)
   (declare (xargs :measure (nfix n)))
   (if (zp n)
       nil
     (if (atom xs) nil (cons (dg (car xs) (- n 1)) (dg-list (cdr xs) (- n 1))))))
 (defun dg-cond (clauses n)
   (declare (xargs :measure (nfix n)))
   (if (zp n)
       nil
     (cond ((atom clauses) nil)
           ((eq (car clauses) :else) (dg (cadr clauses) (- n 1)))
           (t (list 'if (dg (car clauses) (- n 1)) (dg (cadr clauses) (- n 1))
                    (dg-cond (cddr clauses) (- n 1)))))))
 (defun dg-case-if (v rest n)
   (declare (xargs :measure (nfix n)))
   (if (zp n)
       nil
     (cond ((atom (cdr rest)) (dg (car rest) (- n 1)))
           (t (list 'if (list '= v (dg (car rest) (- n 1))) (dg (cadr rest) (- n 1))
                    (dg-case-if v (cddr rest) (- n 1))))))))

(defthm cond-vs-if
  (equal (dg '(defn run (n :i64) :i64 (cond (< n 0) 0 :else n)) 200)
         '(defn run (n :i64) :i64 (if (< n 0) 0 n)))
  :rule-classes nil)

(defthm cond-chain-vs-nested-if
  (equal (dg '(defn f (n :i64) :i64 (cond (< n 0) 1 (< n 5) 2 :else 3)) 200)
         '(defn f (n :i64) :i64 (if (< n 0) 1 (if (< n 5) 2 3))))
  :rule-classes nil)

(defthm cond-chain-vs-nested-if-control
  (not (equal (dg '(defn f (n :i64) :i64 (cond (< n 0) 1 (< n 5) 9 :else 3)) 200)
              '(defn f (n :i64) :i64 (if (< n 0) 1 (if (< n 5) 2 3)))))
  :rule-classes nil)

(defthm if-not-vs-swapped-if
  (equal (dg '(defn f (n :i64) :i64 (if-not (< n 0) 1 2)) 200)
         '(defn f (n :i64) :i64 (if (< n 0) 2 1)))
  :rule-classes nil)

(defthm if-not-vs-swapped-if-control
  (not (equal (dg '(defn f (n :i64) :i64 (if-not (< n 0) 1 3)) 200)
              '(defn f (n :i64) :i64 (if (< n 0) 2 1))))
  :rule-classes nil)

(defthm case-one-clause-vs-let-if
  (equal (dg '(defn f (n :i64) :i64 (case n 0 10 21)) 200)
         '(defn f (n :i64) :i64 (let (t n) (if (= t 0) 10 20))))
  :rule-classes nil)

(defthm case-one-clause-vs-let-if-control
  (not (equal (dg '(defn f (n :i64) :i64 (case n 0 11 20)) 200)
              '(defn f (n :i64) :i64 (let (t n) (if (= t 0) 10 20)))))
  :rule-classes nil)

(defthm case-two-clauses-vs-let-if
  (equal (dg '(defn f (n :i64) :i64 (case n 0 10 1 20 30)) 200)
         '(defn f (n :i64) :i64 (let (t n) (if (= t 0) 10 (if (= t 1) 20 30)))))
  :rule-classes nil)

(defthm case-two-clauses-vs-let-if-control
  (not (equal (dg '(defn f (n :i64) :i64 (case n 0 10 1 21 30)) 200)
              '(defn f (n :i64) :i64 (let (t n) (if (= t 0) 10 (if (= t 1) 20 30))))))
  :rule-classes nil)

