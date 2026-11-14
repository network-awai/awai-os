(ns awai.installer
  (:require [clojure.edn :as edn] [clojure.walk :as walk] [clojure.string :as str])
  (:import [javax.swing JFrame JPanel JLabel JButton JTextField JScrollPane BoxLayout SwingUtilities Timer BorderFactory UIManager]
           [java.awt BorderLayout Color Font Dimension GridLayout]
           [java.awt.event ActionListener]
           [java.nio.channels SocketChannel Channels]
           [java.net UnixDomainSocketAddress]
           [java.util Base64]))

(def palette {:bg "#ffffff" :surface "#f5f6f8" :selected "#cfddf2" :ink "#182332" :muted "#485c74" :line "#9aaabd" :focus "#1e50a2" :danger "#a32b29" :warning "#fff1d8"})
(defn color [k] (Color/decode (palette k)))
(defn font [size bold] (Font. "Noto Sans CJK JP" (if bold Font/BOLD Font/PLAIN) size))
(defn label [text size bold] (doto (JLabel. text) (.setFont (font size bold)) (.setForeground (color :ink))))
(defn panel [layout] (doto (JPanel. layout) (.setBackground (color :bg))))
(defn button [text action danger]
  (doto (JButton. text) (.setFont (font 18 true)) (.setBackground (color (if danger :danger :focus)))
    (.setForeground Color/WHITE) (.setFocusPainted true) (.setPreferredSize (Dimension. 240 48))
    (.addActionListener (reify ActionListener (actionPerformed [_ _] (action))))))
(defn rpc [op & args]
  (with-open [ch (SocketChannel/open (UnixDomainSocketAddress/of "/run/otehon-install/control.sock"))]
    (let [out (Channels/newOutputStream ch) in (java.io.BufferedReader. (java.io.InputStreamReader. (Channels/newInputStream ch) "UTF-8"))
          request (str (str/join "\t" (cons op (map #(.encodeToString (Base64/getEncoder) (.getBytes (str %) "UTF-8")) args))) "\n")]
      (.write out (.getBytes request "UTF-8")) (.flush out)
      (let [response (walk/keywordize-keys (edn/read-string (.readLine in)))]
        (if (:ok response) (:value response) (throw (ex-info (:error response) {})))))))
(defonce state (atom {:page :welcome :devices [] :selected nil :error nil :status {}}))
(defonce window (atom nil))
(declare render!)
(defn change! [m] (swap! state merge m) (render!))
(defn task! [f]
  (future (try (f) (catch Exception e (SwingUtilities/invokeLater #(change! {:error (.getMessage e)}))))))
(defn list! [] (task! #(let [r (rpc "LIST")] (SwingUtilities/invokeLater (fn [] (change! {:page :devices :devices (:devices r) :rawBytes (:rawBytes r) :error nil}))))))
(defn add! [p c] (.add p c) c)
(defn line! [p s] (add! p (label s 18 false)))
(defn gap! [p n] (add! p (javax.swing.Box/createVerticalStrut n)))
(defn card [title body]
  (let [p (panel (GridLayout. 0 1 0 8))]
    (.setBorder p (BorderFactory/createCompoundBorder (BorderFactory/createLineBorder (color :line)) (BorderFactory/createEmptyBorder 16 20 16 20)))
    (add! p (label title 20 true)) (doseq [s body] (line! p s)) p))
(defn render! []
  (let [{:keys [page devices selected status error rawBytes]} @state
        root (panel (BorderLayout.)) header (panel (BorderLayout.)) footer (panel (BorderLayout.))
        sidebar (panel (GridLayout. 0 1 0 12)) main (panel nil) content (panel (BorderLayout.))]
    (.setLayout main (BoxLayout. main BoxLayout/Y_AXIS))
    (.setBorder header (BorderFactory/createEmptyBorder 16 32 16 32)) (.setPreferredSize header (Dimension. 1280 72))
    (.add header (label "Awai Otehon" 24 true) BorderLayout/WEST)
    (.add header (label "USB から起動中" 18 true) BorderLayout/EAST)
    (.setBorder sidebar (BorderFactory/createEmptyBorder 32 24 32 24)) (.setPreferredSize sidebar (Dimension. 256 600))
    (doseq [s ["1  はじめに" "2  保存先を選ぶ" "3  上書きを確認" "4  インストール" "5  完了"]] (add! sidebar (label s 18 true)))
    (.setBorder main (BorderFactory/createEmptyBorder 32 48 24 48))
    (.setBorder footer (BorderFactory/createEmptyBorder 12 32 12 32)) (.setPreferredSize footer (Dimension. 1280 72))
    (case page
      :welcome (do
        (add! main (label "この PC に Awai をインストール" 34 true)) (gap! main 16)
        (line! main "いまは USB 上のインストーラーで動いています。")
        (gap! main 24) (add! main (card "始める前に" ["必要なデータをバックアップしてください。" "AC 電源と USB を接続したままにしてください。" "選んだ保存先のデータはすべて消去されます。" "インストール後、USB を抜いて内蔵 NVMe から起動します。 "]))
        (.add footer (button "保存先を選ぶ →" list! false) BorderLayout/EAST)
        (.add footer (button "文字での操作（tty2）" #(task! (fn [] (rpc "TEXT"))) false) BorderLayout/WEST))
      :devices (do
        (add! main (label "Awai を保存するディスク" 34 true)) (gap! main 12)
        (line! main "USB や使用中のディスクは選べません。型番・容量・シリアルを確認してください。") (gap! main 16)
        (doseq [d devices]
          (let [blocked (or (:used d) (:readOnly d) (:ambiguous d) (<= (:size d) (or rawBytes Long/MAX_VALUE)))
                b (button (format "%s  %.1f GB  [%s]%s" (:model d) (/ (:size d) 1e9) (:serial d) (if blocked " — 選択不可" ""))
                          #(task! (fn [] (let [r (rpc "SELECT" (:id d))] (SwingUtilities/invokeLater (fn [] (change! {:page :confirm :selected r :error nil})))))) false)]
            (.setEnabled b (not blocked)) (add! main b) (gap! main 12)))
        (.add footer (button "再読み込み" list! false) BorderLayout/EAST))
      :confirm (let [d (:target selected) serial (JTextField.) erase (JTextField.)
                     install (button "消去してインストール" #(let [s (.getText serial) e (.getText erase)]
                               (task! (fn [] (let [r (rpc "INSTALL" (:ticket selected) s e)]
                                 (SwingUtilities/invokeLater (fn [] (change! {:page :progress :status r :error nil}))))))) true)]
        (add! main (label "この保存先を消去します" 34 true)) (gap! main 16)
        (add! main (card (str (:model d) "  /  " (:path d)) [(str "シリアル: " (:serial d)) (format "容量: %.1f GB" (/ (:size d) 1e9)) "既存の OS・ファイル・パーティションはすべて削除されます。 "]))
        (gap! main 16) (line! main "保存先のシリアルをそのまま入力")
        (doseq [field [serial erase]] (.setFont field (font 20 false)) (.setMaximumSize field (Dimension. 896 44)))
        (add! main serial) (SwingUtilities/invokeLater #(.requestFocusInWindow serial)) (gap! main 12) (line! main "確認のため ERASE と入力") (add! main erase)
        (.setEnabled install false)
        (let [listener (reify javax.swing.event.DocumentListener
                         (insertUpdate [_ _] (.setEnabled install (and (= (.getText serial) (:serial d)) (= (.getText erase) "ERASE"))))
                         (removeUpdate [_ _] (.setEnabled install (and (= (.getText serial) (:serial d)) (= (.getText erase) "ERASE"))))
                         (changedUpdate [_ _] nil))]
          (.addDocumentListener (.getDocument serial) listener) (.addDocumentListener (.getDocument erase) listener))
        (.add footer install BorderLayout/EAST)
        (.add footer (button "← 保存先へ戻る" list! false) BorderLayout/WEST))
      :progress (let [phase (:phase status) done (or (:done status) 0) total (or (:total status) 0)]
        (add! main (label (get {"verify" "USB の OS データを確認" "write" "NVMe に書き込んでいます" "readback" "書き込んだ内容を照合" "complete" "インストールが完了しました" "failed" "インストールを完了できませんでした" "cancelled" "書込み前に中止しました"} phase "処理状況") 34 true))
        (gap! main 20) (line! main (:message status "")) (gap! main 24)
        (add! main (card "実際の処理状況" [(format "%.2f / %.2f GB" (/ done 1e9) (/ total 1e9)) (str "経過 " (:elapsed status 0) " 秒  / 最終更新 " (:lastUpdateAgo status 0) " 秒前")]))
        (gap! main 20)
        (cond
          (= phase "complete") (do (line! main "電源を切ったら USB を抜いて、この PC の電源を入れてください。")
            (line! main "次回は内蔵 NVMe から起動し、データ保護の設定に進みます。")
            (.add footer (button "電源を切る" #(task! (fn [] (rpc "POWEROFF"))) false) BorderLayout/EAST))
          (= phase "verify") (.add footer (button "書込み前に中止" #(task! (fn [] (rpc "CANCEL"))) false) BorderLayout/WEST)
          (#{"failed" "cancelled"} phase) (do
            (when (:writeStarted status) (line! main "保存先は一部変更された可能性があります。正常起動できるとは限りません。"))
            (line! main (str "診断: " (:error status "なし")))
            (.add footer (button "保存先から確認し直す" list! false) BorderLayout/EAST)))))
    (when error (gap! main 16) (line! main (str "確認: " error)))
    (.add content sidebar BorderLayout/WEST) (.add content (JScrollPane. main) BorderLayout/CENTER)
    (.add root header BorderLayout/NORTH) (.add root content BorderLayout/CENTER) (.add root footer BorderLayout/SOUTH)
    (.setContentPane @window root) (.revalidate @window) (.repaint @window)))
(defn -main [& _]
  (UIManager/setLookAndFeel (UIManager/getCrossPlatformLookAndFeelClassName))
  (SwingUtilities/invokeLater
    (fn []
      (reset! window (doto (JFrame. "Awai Otehon — インストール") (.setDefaultCloseOperation JFrame/DO_NOTHING_ON_CLOSE) (.setUndecorated true) (.setSize 1280 800)))
      (render!) (.setVisible @window true)
      (.setFullScreenWindow (.getDefaultScreenDevice (java.awt.GraphicsEnvironment/getLocalGraphicsEnvironment)) @window)
      (.start (Timer. 1000 (reify ActionListener (actionPerformed [_ _]
        (when (= :progress (:page @state)) (task! #(let [s (rpc "STATUS")] (SwingUtilities/invokeLater (fn [] (change! {:status s})))))))))))))
