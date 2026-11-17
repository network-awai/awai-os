(ns awai.drive.bridge (:require [awai.drive.domain :as d]))
(aset js/window "AwaiDriveCore" #js {"schema" d/schema "limits" (clj->js d/limits) "validName" d/valid-name? "validPath" d/valid-path?})
