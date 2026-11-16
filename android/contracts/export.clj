(require '[cheshire.core :as json] '[itonami.store.domain :as d])
(spit (first *command-line-args*)
      (json/generate-string {:palette d/palette :descriptor (d/runtime-descriptor)}))
