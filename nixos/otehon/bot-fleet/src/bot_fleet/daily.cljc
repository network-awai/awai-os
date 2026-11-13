(ns bot-fleet.daily
 "Otehon BB host: exact daily cron in fixed-offset owner-selected zones only.
 No inference of frequency, DST conversion or support for arbitrary cron.")
(defn compile-daily [job now]
 (let [expr (get-in job [:schedule :expr]) zone (:timezone job)
       match (when (string? expr) (re-matches #"([0-9]{1,2}) ([0-9]{1,2}) \* \* \*" expr))]
  (when-not (and (= "cron" (get-in job [:schedule :kind])) match
                 (contains? #{"Asia/Tokyo" "UTC" "Etc/UTC"} zone))
   (throw (ex-info "reviewed fixed-zone daily cron required" {})))
  (let [minute (Long/parseLong (nth match 1)) hour (Long/parseLong (nth match 2))
        _ (when-not (and (<= 0 minute 59) (<= 0 hour 23)) (throw (ex-info "invalid daily time" {})))
        current (.atZone (java.time.Instant/ofEpochMilli now) (java.time.ZoneId/of zone))
        today (-> current (.withHour (int hour)) (.withMinute (int minute)) (.withSecond 0) (.withNano 0))
        latest (if (.isAfter today current) (.minusDays today 1) today)]
   {:schedule {:type "interval" :every-ms 86400000} :initial-slot (.toEpochMilli (.toInstant latest))
    :source {:expr expr :timezone zone} :compilation "fixed-zone-daily-v1"
    :first-activation "latest-due-only"})))
