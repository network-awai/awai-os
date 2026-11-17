(ns awai.drive.bridge (:require [awai.drive.domain :as d] [awai.drive.encrypted :as encrypted]))
(aset js/window "AwaiDriveCore" #js {"schema" d/schema "limits" (clj->js d/limits) "validName" d/valid-name? "validPath" d/valid-path?})

(aset js/window "AwaiDriveEncrypted" #js {"newRecord" encrypted/new-record "sealSnapshot" encrypted/seal-snapshot "openSnapshot" encrypted/open-snapshot "sha256" encrypted/sha})
