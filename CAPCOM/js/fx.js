/* fx.js — the ambient background: floating pixels drifting up with a slow
   sway, and the occasional thin contrail streak. Mission Control's mood,
   not a screensaver: low alpha, few particles, DPR capped at 1, paused when
   the tab hides, and reduced to a static sprinkle when the OS asks for
   reduced motion. Reads the theme each frame so the toggle just works. */

const PIXELS = 46;
const STREAKS = 4;

export function mountFx() {
  const canvas = document.getElementById('fx');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  let w = 0, hgt = 0;

  const size = () => {
    w = canvas.width = window.innerWidth;
    hgt = canvas.height = window.innerHeight;
  };
  size();
  window.addEventListener('resize', size);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const COLORS = ['#10CFC9', '#009845', '#EDF3F9'];

  const px = Array.from({ length: PIXELS }, () => ({
    x: rnd(0, 1), y: rnd(0, 1), s: rnd(1.5, 3.5),
    v: rnd(6, 20), sway: rnd(10, 40), ph: rnd(0, Math.PI * 2),
    a: rnd(0.05, 0.22), c: COLORS[Math.floor(rnd(0, COLORS.length))],
  }));
  const lines = Array.from({ length: STREAKS }, () => ({
    x: rnd(-0.2, 1), y: rnd(0.05, 0.9), len: rnd(70, 180),
    v: rnd(14, 30), a: rnd(0.04, 0.09),
  }));

  const light = () => document.documentElement.dataset.theme === 'light';

  function draw(dt, t) {
    ctx.clearRect(0, 0, w, hgt);
    const dim = light() ? 0.45 : 1; // whisper in light mode
    for (const p of px) {
      p.y -= (p.v * dt) / hgt;
      if (p.y < -0.02) { p.y = 1.02; p.x = rnd(0, 1); }
      const sway = Math.sin(t / 2400 + p.ph) * p.sway;
      ctx.globalAlpha = p.a * dim;
      // Light mode: all pixels go Qlik Green (Travis's call) — the mixed
      // Sky/white set reads as dust on white; green reads as brand.
      ctx.fillStyle = light() ? '#009845' : p.c;
      ctx.fillRect(p.x * w + sway, p.y * hgt, p.s, p.s);
    }
    for (const l of lines) {
      l.x += (l.v * dt) / w;
      if (l.x > 1.1) { l.x = -0.25; l.y = rnd(0.05, 0.9); l.len = rnd(70, 180); }
      const x0 = l.x * w;
      const grad = ctx.createLinearGradient(x0, 0, x0 + l.len, 0);
      grad.addColorStop(0, 'rgba(16,207,201,0)');
      grad.addColorStop(1, light() ? 'rgba(0,101,128,0.5)' : 'rgba(16,207,201,0.6)');
      ctx.globalAlpha = l.a * dim;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, l.y * hgt);
      ctx.lineTo(x0 + l.len, l.y * hgt);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { draw(0, 0); return; } // one static sprinkle, no loop

  let last = performance.now();
  function frame(t) {
    if (!document.hidden) {
      const dt = Math.min(0.05, (t - last) / 1000);
      draw(dt, t);
    }
    last = t;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
