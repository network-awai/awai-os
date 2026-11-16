// AWAI-2962: finite target morphs, not a persistent particle simulation.
// The canvas is decoration; semantic HTML remains operable at every frame.
export const MOTION_PATTERNS = Object.freeze([
  { id: "assemble", title: "01 · あつまる", action: "はじめる", duration: 900,
    detail: "粒子が集まり、次の一歩の輪郭になる。起動・初回表示。" },
  { id: "focus", title: "02 · 気配が寄る", action: "選ぶ", duration: 420,
    detail: "青と赤の気配が選択した要素を包む。フォーカス・選択。" },
  { id: "confirm", title: "03 · 応える", action: "決定する", duration: 560,
    detail: "触れた粒子が収束し、短い波で決定を返す。ボタン・完了。" },
  { id: "transfer", title: "04 · 受け渡す", action: "移動する", duration: 800,
    detail: "同じ粒子が出発点から移り、行き先を構成する。移動・保存。" },
  { id: "open", title: "05 · ひらく", action: "ひらく", duration: 760,
    detail: "小さなかたまりが広がり、一枚の場所になる。アプリ・パネル。" },
]);
export const PARTICLE_PALETTE = Object.freeze({ shiro: "#ffffff", ao: "#1e50a2", aka: "#bc002d", kuro: "#14110f" });
const fract = n => n - Math.floor(n);
const lerp = (a, b, t) => a + (b - a) * t;
function pill(t) {
  const a = t * Math.PI * 2;
  return [0.5 + Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.35 * 0.32,
    0.55 + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.65 * 0.12];
}
export function particlePose(pattern, index, count, progress) {
  if (!MOTION_PATTERNS.some(p => p.id === pattern) || !Number.isInteger(index) ||
      index < 0 || index >= count || count < 1 || !Number.isFinite(progress)) throw Error("invalid-motion-input");
  const p = Math.min(1, Math.max(0, progress));
  const t = 1 - (1 - p) ** 3;
  const u = (index + 0.5) / count;
  const a = index * 2.399963229728653;
  const depth = Math.sin(a * 0.7);
  const cloud = [0.5 + Math.cos(a) * Math.sqrt(u) * 0.38,
    0.5 + Math.sin(a) * Math.sqrt(u) * 0.34];
  const ring = pill(u);
  let from = cloud;
  let to = ring;
  if (pattern === "focus") from = [0.5 + Math.cos(a) * 0.43, 0.5 + Math.sin(a) * 0.28];
  if (pattern === "confirm") {
    from = ring;
    to = u < 0.35 ? [lerp(.39, .47, u / .35), lerp(.52, .63, u / .35)] :
      [lerp(.47, .65, (u - .35) / .65), lerp(.63, .38, (u - .35) / .65)];
  }
  if (pattern === "transfer") {
    const ox = (fract(index * .61803398875) - .5) * .2;
    const oy = (fract(index * .75487766625) - .5) * .22;
    from = [.25 + ox, .53 + oy]; to = [.75 + ox, .53 + oy];
  }
  if (pattern === "open") {
    const petal = 0.1 + 0.05 * Math.cos(a * 4);
    from = [.5 + Math.cos(a) * petal, .5 + Math.sin(a) * petal];
    to = [.18 + fract(index * .61803398875) * .64, .2 + u * .56];
  }
  return { x: lerp(from[0], to[0], t),
    y: lerp(from[1], to[1], t) - (pattern === "transfer" ? Math.sin(t * Math.PI) * .18 : 0),
    radius: 1.1 + (depth + 1) * .65,
    color: index % 10 < 5 ? "ao" : index % 10 < 7 ? "aka" :
      (pattern === "focus" || pattern === "transfer") ? (index % 10 === 9 ? "shiro" : "kuro") :
      (index % 10 === 9 ? "kuro" : "shiro"),
    alpha: .2 + .75 * u };
}

export function mountParticleMotion(canvas, pattern, {
  count = 240, host = window, doc = document,
} = {}) {
  const definition = MOTION_PATTERNS.find(p => p.id === pattern);
  if (!definition) throw Error("unknown-motion-pattern");
  if (!Number.isInteger(count) || count < 1 || count > 320) throw Error("particle-budget-exceeded");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { play() {}, dispose() {} };
  const reduced = host.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0, alive = true, progress = 1, start, renderable = true;
  const size = () => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(host.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return box;
  };
  let box = size();
  const cancel = () => { host.cancelAnimationFrame(raf); raf = 0; };
  function draw(p) {
    progress = p;
    ctx.clearRect(0, 0, box.width, box.height);
    for (let i = 0; i < count; i++) {
      const point = particlePose(pattern, i, count, p);
      ctx.globalAlpha = point.alpha;
      ctx.fillStyle = PARTICLE_PALETTE[point.color];
      ctx.beginPath(); ctx.arc(point.x * box.width, point.y * box.height, point.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function frame(time) {
    if (!alive || doc.hidden) { cancel(); return; }
    if (reduced.matches || doc.documentElement.dataset.reduceMotion === "true") { stop(); return; }
    start ??= time;
    const p = Math.min(1, (time - start) / definition.duration);
    draw(p);
    if (p < 1) raf = host.requestAnimationFrame(frame); else raf = 0;
  }
  const stop = () => { cancel(); draw(1); };
  const visibility = () => { if (doc.hidden) stop(); };
  const motionPreference = () => { if (reduced.matches) stop(); };
  const resize = new ResizeObserver(() => { if (renderable) { box = size(); draw(progress); } });
  resize.observe(canvas);
  const stage = canvas.parentElement;
  const rendering = skipped => {
    renderable = !skipped;
    if (skipped) { cancel(); progress = 1; }
    else { box = size(); draw(progress); }
  };
  const contentVisibility = event => rendering(event.skipped);
  stage.addEventListener("contentvisibilityautostatechange", contentVisibility);
  const visible = !('contentVisibility' in doc.documentElement.style)
    ? new IntersectionObserver(entries => rendering(!entries[0].isIntersecting)) : null;
  visible?.observe(canvas);
  doc.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", motionPreference);
  draw(1);
  return {
    play() {
      cancel(); start = undefined;
      if (!alive || !renderable || doc.hidden) return;
      if (reduced.matches || doc.documentElement.dataset.reduceMotion === "true") {
        draw(1); return;
      }
      draw(0); raf = host.requestAnimationFrame(frame);
    },
    dispose() {
      alive = false; cancel(); resize.disconnect(); visible?.disconnect();
      stage.removeEventListener("contentvisibilityautostatechange", contentVisibility);
      doc.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", motionPreference);
    },
  };
}
