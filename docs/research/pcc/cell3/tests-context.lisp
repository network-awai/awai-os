(cw "~%RESULT neg-xv-args-position expected=NIL got=~x0~%" (check '((defn f (if-not a b c) :i64 1) (defn f (if (not a) b c) :i64 1)) '((if-not (2)))))
(cw "~%RESULT neg-xvi-let-binding-position expected=NIL got=~x0~%" (check '((let (if-not x y z) 1) (let (if (not x) y z) 1)) '((if-not (1)))))
(cw "~%RESULT neg-xvii-cond-arity expected=NIL got=~x0~%" (check '((cond a 1 b) (if a 1 (cond b))) '((cond-step ()))))
(cw "~%RESULT neg-xviii-not-shadowed expected=NIL got=~x0~%" (check '((defn f (not :i64) :i64 (if-not a b c)) (defn f (not :i64) :i64 (if (not a) b c))) '((if-not (4)))))
