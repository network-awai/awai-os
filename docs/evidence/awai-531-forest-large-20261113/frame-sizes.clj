(import '[java.io RandomAccessFile] '[java.nio ByteBuffer ByteOrder])
(defn le [b off] (.getLong (doto (ByteBuffer/wrap b off 8) (.order ByteOrder/LITTLE_ENDIAN))))
(defn u32 [b off] (bit-and 0xffffffff (.getInt (doto (ByteBuffer/wrap b off 4) (.order ByteOrder/LITTLE_ENDIAN)))))
(defn read-at [^RandomAccessFile f start n] (let [b (byte-array n)] (.seek f start) (.readFully f b) b))
(doseq [file *command-line-args*]
 (with-open [f (RandomAccessFile. file "r")]
  (let [footer (- (.length f) 16) ft (read-at f footer 16) index (- (le ft 8) 8)
        head (read-at f index 8) index-bytes (read-at f (+ index 8) (u32 head 4))
        positions (->> (range 32 (count index-bytes) 16)
                       (keep (fn [i] (let [h (le index-bytes i) p (le index-bytes (+ i 8))] (when (not= h -1) p)))) distinct sort vec)
        ends (concat (rest positions) [index])]
   (prn {:file file :indexed-frames (count positions) :index-bytes (- footer index)
         :frame-stored-bytes (mapv - ends positions) :frame-offsets positions}))))
