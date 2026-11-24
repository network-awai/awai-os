(cw "~%RESULT neg-x-else-as-metavar expected=NIL got=~x0~%" (check '((cond (< n 0) 1 (< n 5) 7) (if (< n 0) 1 7)) '((cond-2 ()))))
(cw "~%RESULT neg-xi-case-key-capture expected=NIL got=~x0~%" (check '((case n t 10 20) (let (t n) (if (= t t) 10 20))) '((case-1 ()))))
(cw "~%RESULT neg-xii-else-not-final expected=NIL got=~x0~%" (check '((cond :else 1 (< n 5) 2) (if :else 1 (cond (< n 5) 2))) '((cond-step ()))))
(cw "~%RESULT neg-xiii-fail-as-term expected=NIL got=~x0~%" (check '((cond a) :fail) '((cond-2 ()))))
