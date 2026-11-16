import { MOTION_PATTERNS, mountParticleMotion } from "./particle-motion.js";
import { createBroker } from "./runtime.js";
import { installFeedback } from "./feel.js";

// Static browser-only design lab: no external operations or account changes.
createBroker("motion-lab/index.html", []);
const cleanupFeedback = installFeedback();
const region = document.querySelector("#patterns");
const controllers = [];
for (const pattern of MOTION_PATTERNS) {
  const card = document.createElement("article");
  card.className = `motion-card pattern-${pattern.id}`;
  card.innerHTML = `<header><span class="eyebrow">AWAI MOTION</span><h2></h2><p></p></header>
    <div class="stage"><canvas aria-hidden="true"></canvas>
      <button class="demo-action" type="button"></button>
      <span class="stage-note" aria-hidden="true"></span>
    </div><p class="demo-status" role="status">ローカルデモ · 操作できます</p>`;
  card.querySelector("h2").textContent = pattern.title;
  card.querySelector("header p").textContent = pattern.detail;
  const action = card.querySelector("button");
  action.textContent = pattern.action;
  const note = card.querySelector(".stage-note");
  note.textContent = pattern.id === "transfer" ? "ここから　　　　　　　　　ここへ" : "しろ・あお・あか・くろ。";
  region.append(card);
  const motion = mountParticleMotion(card.querySelector("canvas"), pattern.id);
  controllers.push(motion);
  let count = 0;
  action.addEventListener("click", () => {
    count += 1;
    card.querySelector(".demo-status").textContent = `デモを実行しました · ${count} 回`;
    motion.play(); // UI state changes immediately; never wait for decoration.
  });
  if (pattern.id === "focus") {
    action.addEventListener("focus", () => motion.play());
    action.addEventListener("pointerenter", () => motion.play());
  }
}
document.querySelector("#replay").addEventListener("click", () => controllers.forEach(c => c.play()));
window.addEventListener("pagehide", () => {
  controllers.forEach(c => c.dispose()); cleanupFeedback();
}, { once: true });
