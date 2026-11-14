(ns shell.styles.main
  "The OS shell stylesheet as Garden data. Generates dist/assets/main.css
  through styles.build. Values that must stay byte-identical (shorthands,
  font stacks, functions like min() and var()) are plain strings; simple
  selectors and single identifiers are keywords."
  (:require [garden.core :as garden]
            [garden.stylesheet :refer [at-media]]))

(def styles
  [[":root"
    {:--bg "#15181c" :--surface "#1b1f24" :--surface-low "#22272d"
     :--surface-raised "#2a3037" :--surface-hover "#2f363e" :--surface-selected "#38424c"
     :--mark "#33424f" :--fg "#eef1f4" :--secondary-text "#c4ccd3"
     :--muted "#aeb8c2" :--muted-soft "#b5bec8" :--disabled-bg "#414951"
     :--border-strong "#5a636d" :--focus "#7fb4e6" :--success-text "#7ddc9a"
     :--warning-bg "#3a3227" :--warning-text "#e8c48a" :--error "#f09a8a"}]
   [":root[data-theme=\"Asa\"]"
    {:color-scheme "light" :--bg "#ffffff" :--surface "#f5f6f8" :--surface-low "#eef1f5"
     :--surface-raised "#e7ebf1" :--surface-hover "#dce4ee" :--surface-selected "#cfddf2"
     :--mark "#d1dff1" :--fg "#182332" :--secondary-text "#344359"
     :--muted "#485c74" :--muted-soft "#3e5168" :--disabled-bg "#d7dee7"
     :--border-strong "#9aaabd" :--focus "#1e50a2" :--success-text "#17623c"
     :--warning-bg "#fff1d8" :--warning-text "#754700" :--error "#a32b29"}]
   [":root[data-theme=\"Hiru\"]"
    {:color-scheme "light" :--bg "#eaf7ff" :--surface "#dceffc" :--surface-low "#d3eafb"
     :--surface-raised "#c7e2f6" :--surface-hover "#b6d9f3" :--surface-selected "#a8cfed"
     :--mark "#a9d1ed" :--fg "#102b43" :--secondary-text "#284b65"
     :--muted "#355b76" :--muted-soft "#325671" :--disabled-bg "#bdd5e6"
     :--border-strong "#7a9db7" :--focus "#1e50a2" :--success-text "#17623c"
     :--warning-bg "#fff1d8" :--warning-text "#754700" :--error "#a32b29"}]
   [":root"
    {:color-scheme "dark"
     :font-family "\"Noto Sans JP\", \"Noto Sans CJK JP\", \"DejaVu Sans\", sans-serif"
     :background "var(--bg)"
     :color "var(--fg)"}]
   [:* {:box-sizing "border-box"}]
   [:body {:margin 0}]
   ["ul, ol" {:margin 0 :padding 0 :list-style "none"}]
   ["button, textarea" {:font "inherit" :color "inherit"}]
   [:button {:border 0 :cursor "pointer"}]
   ["button:focus-visible, textarea:focus-visible"
    {:outline "2px solid var(--focus)" :outline-offset "1px"}]
   [:.shell {:display "grid" :grid-template-columns "248px minmax(0, 1fr)" :height "100vh"}]
   [".shell.with-panel" {:grid-template-columns "248px minmax(0, 1fr) 320px"}]
   [:.sidebar {:display "flex" :flex-direction "column" :min-height 0
                :padding "16px 10px 12px" :background "var(--surface)"}]
   [:.brand {:display "flex" :align-items "center" :gap "10px"
             :padding "0 8px 12px" :font-size "17px" :font-weight 600}]
   [:.brand-logo {:display "block" :flex "none" :width "40px" :height "40px" :border-radius "9px"}]
   [:.setup-logo {:display "block" :width "96px" :height "96px"
                  :margin "0 auto 24px" :border-radius "20px"}]
   [:.new-chat {:width "100%" :padding "9px 10px" :border-radius "8px"
                 :background "var(--surface-raised)" :font-size "14px" :text-align "left"}]
   [".new-chat:hover, .dapp:hover" {:background "var(--surface-hover)"}]
   [".new-chat.active, .dapp.active" {:background "var(--surface-selected)"}]
   [:.contexts {:flex 1 :min-height 0 :margin-top "4px" :overflow-y "auto"}]
   [".sidebar h2" {:margin "12px 8px 4px" :color "var(--muted)"
                    :font-size "12px" :font-weight 600}]
   [:.dapp {:display "flex" :align-items "center" :gap "9px" :width "100%"
             :padding "5px 8px" :border-radius "8px" :background "transparent"
             :font-size "14px" :text-align "left"}]
   [:.mark {:display "grid" :flex "none" :place-items "center" :width "22px" :height "22px"
             :border-radius "6px" :background "var(--mark)" :font-size "12px" :font-weight 600}]
   [:.count {:margin-left "auto" :color "var(--muted)" :font-size "12px"}]
   [".sidebar footer" {:display "flex" :align-items "flex-end" :justify-content "space-between"
                        :padding "10px 8px 0" :font-size "12px"}]
   [:.service {:display "flex" :gap "6px"}]
   [".service.up span:last-child" {:color "var(--success-text)"}]
   [".service.down span:last-child" {:color "var(--error)"}]
   [:time {:color "var(--muted)" :font-variant-numeric "tabular-nums"}]
   [:.chat {:display "flex" :flex-direction "column" :min-width 0 :min-height 0}]
   [:.thread {:flex 1 :min-height 0 :overflow-y "auto" :padding "32px 24px 16px"}]
   [:.empty {:max-width "560px" :margin "26vh auto 0" :text-align "center"}]
   [".empty h1" {:margin 0 :font-size "28px" :font-weight 600}]
   [".empty p" {:margin "12px 0 0" :color "var(--muted-soft)"
                 :font-size "15px" :line-height 1.45}]
   [:.messages {:display "flex" :flex-direction "column" :gap "12px"
                 :max-width "720px" :margin "0 auto"}]
   [".messages li" {:align-self "flex-end" :max-width "80%" :padding "10px 14px"
                     :border-radius "16px" :background "var(--surface-raised)"
                     :line-height 1.45 :overflow-wrap "anywhere" :white-space "pre-wrap"}]
   [:.dock {:padding "0 24px 14px"}]
   [:.composer {:display "flex" :align-items "flex-end" :gap "8px" :max-width "720px"
                 :margin "0 auto" :padding "10px 10px 10px 16px" :border-radius "20px"
                 :background "var(--surface-raised)"}]
   [".composer textarea" {:flex 1 :max-height "160px" :padding "6px 0" :border 0
                           :background "transparent" :line-height 1.4 :resize "none"}]
   [".composer textarea:focus-visible" {:outline 0}]
   [".composer:focus-within" {:box-shadow "0 0 0 2px var(--focus)"}]
   [".composer button" {:padding "7px 14px" :border-radius "14px" :background "var(--fg)"
                         :color "var(--bg)" :font-size "14px" :font-weight 600}]
   [".composer button:disabled" {:background "var(--disabled-bg)" :color "var(--muted)"
                                  :cursor "default"}]
   [:.notice {:max-width "720px" :margin "8px auto 0" :color "var(--muted)"
               :font-size "12px" :text-align "center"}]
   [:.panel {:min-height 0 :overflow-y "auto" :padding "22px 20px" :background "var(--surface)"
              :font-size "14px" :line-height 1.45}]
   [:.panel-head {:display "flex" :align-items "center" :justify-content "space-between" :gap "8px"}]
   [".panel h2" {:margin 0 :font-size "17px" :font-weight 600}]
   [:.tag {:flex "none" :padding "2px 8px" :border-radius "10px" :background "var(--warning-bg)"
            :color "var(--warning-text)" :font-size "12px"}]
   [".panel p" {:margin "12px 0" :color "var(--secondary-text)"}]
   [".panel dl" {:margin "16px 0"}]
   [".panel dt, .panel h3" {:margin "14px 0 4px" :color "var(--muted)"
                             :font-size "12px" :font-weight 600}]
   [".panel dd" {:margin 0}]
   [".operations li" {:display "flex" :flex-direction "column" :gap "2px" :padding "10px 0"
                       :border-top "1px solid var(--surface-hover)" :color "var(--secondary-text)"
                       :font-size "13px"}]
   [".operations .title" {:color "var(--fg)" :font-weight 600}]
   [:.setup {:display "flex" :flex-direction "column" :align-items "center"
              :justify-content "center" :gap "28px" :height "100vh" :padding "24px"}]
   [:.setup-card {:display "flex" :flex-direction "column" :align-items "center" :gap "16px"
                   :width "min(440px, 100%)" :text-align "center"}]
   [".setup-card h1" {:margin 0 :font-size "30px" :font-weight 600}]
   [".setup-card h1.hello" {:margin-bottom "40px" :font-size "56px"}]
   [".setup-card p" {:margin 0 :color "var(--secondary-text)" :line-height 1.5}]
   [".primary, .secondary" {:min-height "46px" :padding "10px 24px" :border-radius "12px"
                             :font-size "15px" :font-weight 600}]
   [".setup-card .primary, .setup-card .secondary" {:width "100%"}]
   [:.primary {:background "var(--fg)" :color "var(--bg)"}]
   [:.secondary {:background "var(--surface-raised)"}]
   [".muted, .setup-card p.muted" {:color "var(--muted)" :font-size "13px"}]
   [".problem, .setup-card p.problem" {:color "var(--error)"}]
   [:.choices {:width "100%" :overflow "hidden" :border-radius "12px" :background "var(--surface-low)"}]
   [".choices li + li" {:border-top "1px solid var(--surface-hover)"}]
   [".choices button" {:display "flex" :justify-content "space-between" :width "100%"
                        :padding "13px 16px" :background "transparent" :text-align "left"}]
   [:.link-pending {:display "flex" :flex-direction "column" :align-items "center" :gap "8px"}]
   [:.qr {:width "232px" :height "232px" :border-radius "10px"}]
   [:.code {:color "var(--fg)" :font-size "18px" :font-variant-numeric "tabular-nums"}]
   [:.progress {:display "flex" :gap "8px"}]
   [".progress li" {:width "7px" :height "7px" :border-radius "50%" :background "var(--disabled-bg)"}]
   [".progress li.current" {:background "var(--fg)"}]
   [:.account-id {:overflow-wrap "anywhere"}]
   [:.account-button {:display "flex" :align-items "center" :gap "8px" :width "100%"
                       :margin-top "8px" :padding "8px" :border-radius "8px"
                       :background "var(--surface-raised)" :font-size "12px" :text-align "left"}]
   [".account-button.active, .account-button:hover" {:background "var(--surface-selected)"}]
   [".account-button .title" {:overflow "hidden" :text-overflow "ellipsis" :white-space "nowrap"}]
   [:.account-view {:overflow-y "auto"}]
   [:.account-body {:display "flex" :flex-direction "column" :gap "12px" :width "min(620px, 100%)"
                     :margin "0 auto" :padding "48px 24px"}]
   [".account-body h1, .account-body h2, .account-body p" {:margin 0}]
   [".account-body h1" {:font-size "28px"}]
   [".account-body h2" {:margin-top "16px" :font-size "18px"}]
   [:.sources {:overflow "hidden" :border-radius "12px" :background "var(--surface-low)"
                :font-size "14px"}]
   [".sources li" {:display "flex" :align-items "center" :justify-content "space-between"
                    :gap "12px" :min-height "48px" :padding "8px 14px"}]
   [".sources li + li" {:border-top "1px solid var(--surface-hover)"}]
   [".sources button" {:padding "6px 12px" :border-radius "8px" :background "var(--surface-selected)"
                        :font-size "13px"}]
   [".operations button.locked" {:align-self "flex-start" :margin-top "4px" :padding "4px 8px"
                                  :border-radius "8px" :background "var(--warning-bg)"
                                  :color "var(--warning-text)" :font-size "12px"}]
   [".empty .primary" {:margin-top "20px"}]
   [:.field {:display "flex" :flex-direction "column" :gap "6px" :width "100%"
              :color "var(--secondary-text)" :font-size "13px" :text-align "left"}]
   [".field input, .field textarea" {:width "100%" :padding "10px 12px"
                                      :border "1px solid var(--surface-selected)"
                                      :border-radius "10px" :background "var(--surface)"
                                      :color "var(--fg)"
                                      :font "12px/1.4 \"DejaVu Sans Mono\", monospace"
                                      :resize "none"}]
   [:.setup-card {:max-height "100vh" :overflow-y "auto"}]
   [".composer .tool" {:background "var(--surface-selected)" :color "var(--fg)" :font-weight 500}]
   [".messages li.media" {:display "flex" :flex-direction "column" :gap "8px" :max-width "100%"}]
   [".messages .media img" {:max-width "100%" :border-radius "10px"}]
   [".messages .media audio" {:width "320px" :max-width "100%"}]
   [".manimani-link" {:display "flex" :align-items "center" :gap "8px" :margin-top "4px"}]
   [".manimani-link .dot" {:width "8px" :height "8px" :border-radius "50%"
                            :background "#8a8f98" :flex "none"}]
   [".manimani-link .dot[data-status=\"ready\"]" {:background "#3fb68b"}]
   [".manimani-link .dot[data-status=\"paused\"]" {:background "#d9a441"}]
   [".manimani" {:display "grid" :grid-template-columns "minmax(0, 1fr) 300px"
                  :min-height 0 :flex 1}]
   [".manimani-chat" {:display "flex" :flex-direction "column" :min-height 0 :overflow "hidden"}]
   [".manimani-messages" {:flex 1 :overflow-y "auto" :padding "24px" :display "flex"
                           :flex-direction "column" :gap "10px"}]
   [".manimani-message" {:max-width "80%" :padding "8px 12px" :border-radius "12px"
                          :white-space "pre-wrap" :overflow-wrap "anywhere"}]
   [".manimani-message[data-role=\"user\"]" {:align-self "flex-end"
                                              :background "rgba(127, 127, 127, 0.18)"}]
   [".manimani-message[data-role=\"agent\"], .manimani-message[data-role=\"task\"], .manimani-message[data-role=\"notice\"]"
    {:opacity 0.75 :font-size "14px"}]
   [".manimani-composer" {:display "flex" :gap "8px" :padding "12px 24px 20px"}]
   [".manimani-composer input" {:flex 1 :min-width 0 :padding "10px 12px" :border-radius "10px"
                                 :border "1px solid rgba(127, 127, 127, 0.4)"
                                 :background "transparent" :color "inherit" :font "inherit"}]
   [".manimani-side" {:border-left "1px solid rgba(127, 127, 127, 0.25)" :padding "16px"
                       :overflow-y "auto" :display "flex" :flex-direction "column" :gap "18px"
                       :font-size "14px"}]
   [".manimani-side h2" {:font-size "12px" :margin "0 0 6px" :opacity 0.7}]
   [".manimani-side ul" {:list-style "none" :margin 0 :padding 0 :display "grid" :gap "6px"}]
   [".manimani-side li" {:overflow-wrap "anywhere"}]
   [".manimani-actions" {:display "flex" :gap "6px" :margin-top "4px"}]
   [".manimani-launchers" {:flex-wrap "wrap"}]
   [".voice-status" {:margin "0 24px 12px" :color "var(--secondary-text)" :font-size "12px"}]
   [".voice-status:empty" {:display "none"}]
   [".voice-bezel" {:position "fixed" :inset "2px" :z-index 100
                     :border "3px solid var(--focus)" :border-radius "16px"
                     :box-shadow "inset 0 0 30px var(--focus)" :pointer-events "none"
                     :transition "opacity .12s"}]
   (at-media {:prefers-reduced-motion "reduce"}
             [".voice-bezel" {:transition "none" :opacity ".5 !important"}])
   [:.net-view {:overflow-y "auto"}]
   [:.net-body {:width "min(620px, 100%)" :margin "0 auto" :padding "48px 24px"
                 :display "flex" :flex-direction "column" :gap "12px"}]
   [".net-body h1" {:margin 0 :font-size "28px"}]
   [".net-body h2" {:margin "16px 0 0" :font-size "15px"}]
   [".net-body p" {:margin 0}]
   [:.net-list {:display "flex" :flex-direction "column"}]
   [".net-list li" {:display "flex" :align-items "center" :gap "10px" :padding "9px 0"
                     :border-top "1px solid var(--surface-hover)" :font-size "14px"}]
   [".net-list li:first-child" {:border-top 0}]
   [".net-list .muted" {:margin-left "auto"}]
   [".net-list button" {:padding "6px 12px" :border-radius "8px"
                         :background "var(--surface-selected)" :font-size "13px" :flex "none"}]
   [:.net-dot {:width "8px" :height "8px" :border-radius "50%" :background "#8a8f98" :flex "none"}]
   [:.net-up {:background "#3fb68b"}]
   [:.net-down {:background "var(--error)"}]
   [:.net-form {:display "flex" :flex-direction "column" :gap "10px"}]
   [".net-form label" {:display "flex" :flex-direction "column" :gap "6px" :font-size "13px"
                        :color "var(--secondary-text)"}]
   [".net-form input" {:padding "10px 12px" :border-radius "10px"
                        :border "1px solid var(--surface-selected)" :background "var(--surface)"
                        :color "inherit" :font "inherit"}]
   [".net-form input[type=\"range\"]" {:padding 0 :accent-color "var(--focus)"}]
   [".net-form .primary" {:min-height "44px"}]
   [:.net-error {:color "var(--error)" :font-size "13px"}]
   [:.dock-cluster {:position "fixed" :bottom "12px" :z-index 20 :display "flex"
                     :flex-direction "column" :gap "8px" :max-width "min(360px, 40vw)"}]
   [:.dock-left {:left "12px" :align-items "flex-start"}]
   [:.dock-right {:right "12px" :align-items "flex-end"}]
   [:.dock-buttons {:display "flex" :gap "8px"}]
   [:.dock-button {:display "flex" :align-items "baseline" :gap "8px" :padding "7px 12px"
                    :border-radius "10px" :background "var(--surface-low)" :font-size "12px"
                    :white-space "nowrap"}]
   [".dock-button:hover" {:background "var(--surface-raised)"}]
   [".dock-button.active" {:background "var(--surface-selected)"}]
   [:.dock-label {:color "var(--secondary-text)" :font-weight 600}]
   [:.dock-value {:color "var(--muted)" :font-variant-numeric "tabular-nums"}]
   [:.dock-panel {:width "320px" :max-width "80vw" :max-height "min(52vh, 420px)"
                   :overflow-y "auto" :border-radius "12px" :background "var(--surface)"
                   :padding "14px 16px" :font-size "13px" :line-height 1.45}]
   [:.dock-panel-head {:display "flex" :align-items "center" :justify-content "space-between"
                        :margin-bottom "8px"}]
   [".dock-panel-head h2" {:margin 0 :font-size "14px" :font-weight 600}]
   [:.dock-close {:padding "2px 10px" :border-radius "8px" :background "var(--surface-raised)"
                   :font-size "14px"}]
   [:.dock-list {:display "flex" :flex-direction "column"}]
   [".dock-list li" {:display "flex" :align-items "center" :gap "8px" :padding "7px 0"
                      :border-top "1px solid var(--surface-hover)"}]
   [".dock-list li:first-child" {:border-top 0}]
   [".dock-list .muted" {:margin-left "auto" :text-align "right"}]
   [:.dot {:width "8px" :height "8px" :border-radius "50%" :background "#8a8f98" :flex "none"}]
   [:.dot-up {:background "#3fb68b"}]
   [:.dot-down {:background "var(--error)"}]
   [:.dot-internal {:background "var(--border-strong)"}]
   [:.dock-facts {:margin "8px 0"}]
   [".dock-facts dt" {:color "var(--muted)" :font-size "12px" :font-weight 600}]
   [".dock-facts dd" {:margin "0 0 8px" :overflow-wrap "anywhere"}]
   [".dock-panel .secondary" {:width "100%" :min-height "40px" :margin-top "4px"}]
   [:.meter {:height "6px" :overflow "hidden" :border-radius "3px"
              :background "var(--surface-raised)" :margin "10px 0 4px"}]
   [".meter span" {:display "block" :height "100%" :background "var(--focus)"}]
   [:.theme-switcher {:position "fixed" :z-index 50 :top "12px" :right "14px" :display "flex"
                       :gap "3px" :margin 0 :padding "4px" :border "1px solid var(--border-strong)"
                       :border-radius "12px" :background "var(--surface)"}]
   [".theme-switcher legend" {:position "absolute" :width "1px" :height "1px" :overflow "hidden"
                               :clip-path "inset(50%)"}]
   [".theme-switcher button" {:padding "6px 10px" :border-radius "8px" :background "transparent"
                               :color "var(--fg)" :font-size "12px"}]
   [".theme-switcher button[aria-pressed=\"true\"]" {:background "var(--surface-selected)"
                                                      :font-weight 700}]
   [".setup" {:padding-top "64px"}]
   [:.soshiki-body {:width "min(760px, 100%)"}]
   [".soshiki-body h2" {:margin "22px 0 8px" :font-size "15px"}]
   [:.soshiki-tabs {:display "flex" :gap "8px" :margin "16px 0 4px"}]
   [:.soshiki-tab {:padding "8px 14px" :border-radius "10px" :background "var(--surface-raised)"
                    :font-size "14px"}]
   [".soshiki-tab:hover" {:background "var(--surface-hover)"}]
   [".soshiki-tab.active" {:background "var(--surface-selected)"}]
   [".soshiki-tab .muted" {:font-size "12px"}]
   [".soshiki-tree, .soshiki-children" {:display "flex" :flex-direction "column" :gap "10px"}]
   [:.soshiki-children {:margin "10px 0 0 16px" :padding-left "12px"
                         :border-left "1px solid var(--surface-hover)"}]
   [".soshiki-circle, .soshiki-bot, .soshiki-sizes li, .soshiki-proposals li"
    {:border-radius "12px" :background "var(--surface-low)" :padding "12px 14px"}]
   [:.soshiki-circle-head {:display "flex" :align-items "baseline" :justify-content "space-between"
                            :gap "10px"}]
   [:.soshiki-purpose {:margin "6px 0" :color "var(--secondary-text)" :font-size "14px"}]
   [:.soshiki-roles {:display "flex" :flex-direction "column" :gap "8px" :margin-top "8px"}]
   [:.soshiki-role {:border-top "1px solid var(--surface-hover)" :padding-top "8px" :font-size "13px"}]
   [".soshiki-role p" {:margin "4px 0"}]
   [:.soshiki-role-head {:display "flex" :justify-content "space-between" :gap "8px"}]
   [:.soshiki-role-name {:font-weight 600 :color "var(--fg)"}]
   [:.soshiki-row {:display "flex" :gap "8px" :margin-top "8px" :flex-wrap "wrap"}]
   [".soshiki-row input, .soshiki-row select" {:flex 1 :min-width "140px" :padding "8px 10px"
                                                :border-radius "8px"
                                                :border "1px solid var(--surface-selected)"
                                                :background "var(--surface)" :color "inherit"
                                                :font "inherit" :font-size "13px"}]
   [".soshiki-row button, .soshiki-form .primary" {:padding "8px 14px" :border-radius "8px"
                                                    :background "var(--fg)" :color "var(--bg)"
                                                    :font-size "13px" :font-weight 600}]
   [:.soshiki-quiet {:background "var(--surface-selected) !important"
                      :color "var(--fg) !important" :font-weight "500 !important"}]
   [:.soshiki-form {:display "flex" :flex-direction "column" :gap "10px" :margin-top "8px"}]
   [:.soshiki-field {:display "flex" :flex-direction "column" :gap "6px" :font-size "13px"
                      :color "var(--secondary-text)"}]
   [".soshiki-field input, .soshiki-field select" {:padding "10px 12px" :border-radius "10px"
                                                    :border "1px solid var(--surface-selected)"
                                                    :background "var(--surface)" :color "var(--fg)"
                                                    :font "inherit" :font-size "13px"}]
   [".soshiki-bots, .soshiki-sizes, .soshiki-proposals" {:display "flex" :flex-direction "column"
                                                          :gap "10px"}]
   [".soshiki-bots p" {:margin "4px 0" :font-size "13px"}]
   [:.soshiki-totals {:display "flex" :gap "8px" :flex-wrap "wrap"}]
   [".soshiki-totals li" {:flex 1 :min-width "88px" :border-radius "12px"
                           :background "var(--surface-low)" :padding "10px 12px" :text-align "center"
                           :display "flex" :flex-direction "column" :gap "2px"}]
   [".soshiki-totals strong" {:font-size "20px" :font-variant-numeric "tabular-nums"}]
   [".soshiki-totals span" {:color "var(--muted)" :font-size "12px"}]
   [:.soshiki-meter-row {:display "grid" :grid-template-columns "40px minmax(0, 1fr) 32px"
                          :align-items "center" :gap "8px" :font-size "12px"}]
   [".soshiki-meter-row .meter" {:margin "6px 0"}]
   [".soshiki-sizes .muted, .soshiki-bots .muted" {:font-size "12px"}]
   [:.soshiki-chartbar {:display "flex" :flex-direction "column" :gap "8px" :margin "12px 0 4px"}]
   [:.soshiki-search {:width "100%" :padding "10px 12px" :border-radius "10px"
                       :border "1px solid var(--surface-selected)" :background "var(--surface)"
                       :color "var(--fg)" :font "inherit" :font-size "13px"}]
   [:.soshiki-legend {:display "flex" :gap "6px" :flex-wrap "wrap"}]
   [:.soshiki-legend-btn {:display "flex" :align-items "center" :gap "6px" :padding "6px 12px"
                           :border-radius "10px" :background "var(--surface-raised)" :font-size "12px"}]
   [".soshiki-legend-btn:hover" {:background "var(--surface-hover)"}]
   [".soshiki-legend-btn.active" {:background "var(--surface-selected)" :font-weight 600}]
   [:.hl-dot {:width "8px" :height "8px" :border-radius "50%" :background "var(--muted)"
               :flex "none" :display "inline-block"}]
   [".hl-dot[data-hl=\"open\"]" {:background "var(--warning-text)"}]
   [".hl-dot[data-hl=\"bot\"]" {:background "var(--focus)"}]
   [".hl-dot[data-hl=\"person\"]" {:background "var(--success-text)"}]
   [:.soshiki-crumb {:display "flex" :flex-wrap "wrap" :align-items "baseline" :gap "2px"
                      :margin "12px 0 8px" :font-size "13px"}]
   [:.soshiki-crumb-link {:background "transparent" :color "var(--focus)" :padding "2px 4px"
                           :border-radius "6px" :font-size "13px"}]
   [".soshiki-crumb-link:hover" {:background "var(--surface-raised)"}]
   [:.soshiki-nest {:border-radius "12px" :background "var(--surface-low)" :padding "14px 16px"}]
   [".soshiki-nest .soshiki-nest" {:background "var(--surface-raised)"}]
   [".soshiki-nest .soshiki-nest .soshiki-nest" {:background "var(--surface-low)"}]
   [".soshiki-nest .soshiki-nest .soshiki-nest .soshiki-nest" {:background "var(--surface-raised)"}]
   [".soshiki-nest-head, .soshiki-nest-headtext" {:display "flex" :align-items "baseline"
                                                   :justify-content "space-between" :gap "10px"
                                                   :width "100%" :font-size "18px"}]
   [".soshiki-nest-head" {:background "transparent" :color "inherit" :font "inherit"
                           :text-align "left" :padding 0}]
   [".soshiki-nest-head:hover strong" {:text-decoration "underline"}]
   [".soshiki-nest[data-size=\"l\"] > .soshiki-nest-head strong, .soshiki-nest[data-size=\"l\"] > .soshiki-nest-headtext strong"
    {:font-size "19px"}]
   [".soshiki-nest[data-depth=\"1\"] > .soshiki-nest-head, .soshiki-nest[data-depth=\"1\"] > .soshiki-nest-headtext"
    {:font-size "15px"}]
   [:.soshiki-kids {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(220px, 1fr))"
                     :gap "10px" :margin-top "10px"}]
   [:.soshiki-chips {:display "flex" :flex-wrap "wrap" :gap "6px" :margin-top "10px"}]
   [:.soshiki-chip {:display "inline-flex" :align-items "center" :gap "6px" :padding "5px 12px"
                     :border-radius "10px" :background "var(--surface-selected)" :font-size "13px"}]
   [".soshiki-chip:hover" {:filter "brightness(1.08)"}]
   [".soshiki-chip.active" {:box-shadow "0 0 0 2px var(--focus)"}]
   [:.soshiki-members {:display "flex" :flex-wrap "wrap" :gap "8px 14px" :margin-top "10px"}]
   [".soshiki-members li" {:display "flex" :align-items "center" :gap "6px" :font-size "13px"}]
   [:.soshiki-avatar {:display "grid" :place-items "center" :width "28px" :height "28px"
                       :border-radius "50%" :background "var(--mark)" :color "var(--fg)"
                       :font-size "13px" :font-weight 600 :flex "none"}]
   [:.soshiki-rolegrid {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(170px, 1fr))"
                         :gap "10px"}]
   [:.soshiki-rolecard {:display "flex" :flex-direction "column" :align-items "flex-start" :gap "4px"
                         :width "100%" :min-height "88px" :border-radius "12px"
                         :background "var(--surface-raised)" :padding "12px 14px" :text-align "left"
                         :font-size "13px"}]
   [".soshiki-rolecard:hover" {:background "var(--surface-hover)"}]
   [".soshiki-rolecard .muted" {:font-size "12px"}]
   [:.soshiki-open {:margin-left "auto" :flex "none" :color "var(--focus)" :font-size "12px"}]
   [:.soshiki-rolecard-purpose {:display "-webkit-box" :-webkit-line-clamp 2 :-webkit-box-orient "vertical"
                                 :overflow "hidden" :color "var(--secondary-text)" :font-size "12px"}]
   [:.soshiki-detail {:margin-top "10px" :border-radius "12px" :background "var(--surface-low)"
                       :padding "12px 14px" :font-size "13px"}]
   [".soshiki-detail p" {:margin "6px 0"}]
   [".soshiki-detail strong" {:display "flex" :align-items "center" :gap "8px"}]
   [:.soshiki-me {:display "flex" :flex-wrap "wrap" :align-items "center" :gap "10px"
                   :border-radius "12px" :background "var(--surface-low)" :padding "12px 14px"
                   :margin-top "12px" :font-size "13px"}]
   [".soshiki-me div" {:display "flex" :flex-direction "column" :gap "2px" :flex "1 1 180px"
                        :min-width 0}]
   [".soshiki-me strong" {:overflow-wrap "break-word"}]
   [".soshiki-me .muted" {:font-size "12px"}]
   [".soshiki-me button" {:margin-left "auto" :flex "none" :padding "8px 14px" :border-radius "8px"
                           :font-size "13px"}]
   [:.fs-preview {:max-width "1040px" :margin "0 auto" :padding "32px 20px"}]
   [:.fs-reliability {:display "grid" :gap "18px" :min-width 0}]
   [".fs-reliability h1, .fs-reliability h2, .fs-reliability h3, .fs-reliability p" {:margin 0}]
   [".fs-reliability h1" {:font-size "30px"}]
   [".fs-reliability h2" {:font-size "18px" :margin-top "8px"}]
   [".fs-reliability h3" {:font-size "14px" :font-weight 500}]
   [:.fs-verdict {:color "var(--warning-text)" :padding-top "8px"}]
   [:.fs-summary {:display "grid" :grid-template-columns "repeat(auto-fit, minmax(min(100%, 210px), 1fr))" :gap "24px" :align-items "center"}]
   [".fs-summary p" {:margin-bottom "10px"}]
   [:.fs-overall {:position "relative" :max-width "240px" :text-align "center"}]
   [".fs-overall svg" {:width "100%" :display "block"}]
   [".fs-overall strong" {:position "absolute" :top "48%" :left 0 :right 0 :font-size "25px" :font-weight 500}]
   [".fs-overall > span" {:display "block" :font-size "13px" :color "var(--muted)"}]
   [:.fs-import {:display "grid" :gap "8px" :font-size "14px"}]
   [".fs-import input" {:max-width "100%" :font "inherit"}]
   [:.fs-grid {:display "grid" :grid-template-columns "repeat(auto-fit, minmax(min(100%, 205px), 1fr))" :gap "14px"}]
   [:.fs-stat {:display "grid" :gap "8px" :padding "16px" :background "var(--surface)" :border-radius "10px" :min-width 0}]
   [:.fs-stat-value {:font-size "25px" :font-variant-numeric "tabular-nums"}]
   [".fs-stat .muted" {:font-size "12px"}]
   [:.fs-track {:height "8px" :background "var(--surface-selected)" :border-radius "4px" :overflow "hidden"}]
   [".fs-track > span" {:display "block" :height "100%" :background "var(--focus)"}]
   [:.fs-unknown {:opacity 0.45}]
   [:.fs-nodes {:display "grid" :gap "8px" :padding-bottom "12px"}]
   [".fs-nodes li" {:display "flex" :justify-content "space-between" :gap "16px"}]
   [:.fs-cid {:overflow-wrap "anywhere" :display "block" :padding-top "8px"}]
   [:.fs-footnote {:color "var(--muted)" :font-size "13px"}]
   ])
