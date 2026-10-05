/* E Beetle · 2.5D animated forest banner with flat 2D beetles.
 *
 * Renders into <div id="scene">: a stack of parallax layers (far forest → mist → mid forest →
 * light rays → hero trunk & branches → spores → blurred foreground leaves → contrast veil).
 * The big layers are static SVG painted once; everything that moves is a small composited
 * sprite animated with transform/opacity only, so the scene stays light even on phones.
 */
(function () {
  'use strict';

  const scene = document.getElementById('scene');
  if (!scene || scene.childElementCount) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isCompact = () => window.innerWidth < 720;

  /* ---------- design space ---------- */
  // Art is authored in a 1600×1000 world; FOCUS (hero trunk + main branch) stays in view on any screen.
  const WORLD = { w: 1600, h: 1000 };
  const FOCUS = { x: 1120, y: 560 };
  const BLEED = { x: 60, top: 50, bottom: 170 }; // must match the .sc-layer insets in banner.css

  /* ---------- helpers ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(0x0eb3e7); // deterministic: the forest looks the same on every visit
  const R = (a, b) => a + rnd() * (b - a);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const n1 = (v) => Math.round(v * 10) / 10;

  // Catmull-Rom spline through points → smooth cubic Bézier path.
  function smoothPath(p, closed) {
    const n = p.length;
    let d = `M${n1(p[0][0])},${n1(p[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = p[i], c = p[(i + 1) % n];
      const e = p[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      d += `C${n1(b[0] + (c[0] - a[0]) / 6)},${n1(b[1] + (c[1] - a[1]) / 6)} ` +
           `${n1(c[0] - (e[0] - b[0]) / 6)},${n1(c[1] - (e[1] - b[1]) / 6)} ${n1(c[0])},${n1(c[1])}`;
    }
    return closed ? d + 'Z' : d;
  }

  // Quadratic-Bézier limb with tapering width.
  function makeBranch(p0, p1, p2, w0, w1) {
    const at = (t) => {
      const u = 1 - t;
      return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
    };
    const tan = (t) => {
      const x = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      const y = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
      const l = Math.hypot(x, y) || 1;
      return { x: x / l, y: y / l };
    };
    const width = (t) => lerp(w0, w1, t);
    // Point on the upper surface: offset the centre line along the normal that points up the screen.
    const top = (t) => {
      const c = at(t), d = tan(t), h = width(t) / 2;
      let nx = d.y, ny = -d.x;
      if (ny > 0) { nx = -nx; ny = -ny; }
      return { x: c.x + nx * h, y: c.y + ny * h };
    };
    let length = 0;
    let prev = at(0);
    for (let i = 1; i <= 40; i++) { const q = at(i / 40); length += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    return { at, tan, width, top, length };
  }

  /* ---------- palette ---------- */
  const MOSS = ['#4c7c2c', '#5c8f34', '#6ca23d', '#3d6b27', '#7fb247'];
  const LEAF_MAIN = ['#2f6a35', '#3b7d3c', '#2a5d31', '#468a43'];
  const LEAF_FRONT = ['#123a20', '#174628', '#1c522d'];
  const LEAF_MID = ['#4f8c5a', '#5a9a62', '#47805a'];
  const BARK = { lit: '#7d6a4f', mid: '#57452f', deep: '#3a2c1e', dark: '#21180f' };

  /* ---------- shape builders (return SVG markup) ---------- */
  function leafPath(L, W, bend) {
    return `M0,0 C${n1(W * 1.15)},${n1(-L * 0.2)} ${n1(W * 0.9 + bend)},${n1(-L * 0.78)} ${n1(bend)},${n1(-L)} ` +
           `C${n1(-W * 0.9 + bend)},${n1(-L * 0.78)} ${n1(-W * 1.15)},${n1(-L * 0.2)} 0,0Z`;
  }
  // A leaf whose base sits at (x, y); angle 0 points up, 90 right, 180 down.
  function leaf(x, y, angle, L, W, fill, vein, bend = 0) {
    let veins = '';
    for (let i = 1; i <= 5; i++) {
      const t = i / 6, yy = -L * t, bx = bend * t * t;
      const w = W * Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.85;
      veins += `M${n1(bx)},${n1(yy)} Q${n1(bx + w * 0.5)},${n1(yy - L * 0.04)} ${n1(bx + w)},${n1(yy - L * 0.11)} ` +
               `M${n1(bx)},${n1(yy)} Q${n1(bx - w * 0.5)},${n1(yy - L * 0.04)} ${n1(bx - w)},${n1(yy - L * 0.11)} `;
    }
    return `<g transform="translate(${n1(x)},${n1(y)}) rotate(${n1(angle)})">` +
      `<path d="${leafPath(L, W, bend)}" fill="${fill}"/>` +
      `<path d="M0,0 Q${n1(bend * 0.35)},${n1(-L * 0.5)} ${n1(bend)},${n1(-L)}" stroke="${vein}" stroke-width="${n1(Math.max(1, W * 0.07))}" fill="none" stroke-linecap="round"/>` +
      `<path d="${veins}" stroke="${vein}" stroke-width="${n1(Math.max(0.6, W * 0.035))}" fill="none" opacity=".65"/></g>`;
  }

  // A fern frond: curved rachis with alternating leaflets.
  function frond(angle, L, curl, light, dark) {
    const p1 = { x: curl * 0.3, y: -L * 0.62 }, p2 = { x: curl, y: -L };
    let out = `<path d="M0,0 Q${n1(p1.x)},${n1(p1.y)} ${n1(p2.x)},${n1(p2.y)}" stroke="${dark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    const count = Math.round(L / 8);
    for (let i = 2; i < count; i++) {
      const t = i / count, u = 1 - t;
      const cx = 2 * u * t * p1.x + t * t * p2.x, cy = 2 * u * t * p1.y + t * t * p2.y;
      const tx = 2 * u * p1.x + 2 * t * (p2.x - p1.x), ty = 2 * u * p1.y + 2 * t * (p2.y - p1.y);
      const a = Math.atan2(ty, tx) * 180 / Math.PI;
      const len = (1 - t) * L * 0.2 + 4;
      for (const s of [-1, 1]) {
        out += `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(len / 2)}" ry="${n1(Math.max(1.5, len * 0.2))}" ` +
               `transform="rotate(${n1(a + s * 62)} ${n1(cx)} ${n1(cy)}) translate(${n1(len / 2)} 0)" fill="${(i + (s > 0 ? 1 : 0)) % 2 ? light : dark}"/>`;
      }
    }
    return `<g transform="rotate(${n1(angle)})">${out}</g>`;
  }

  function mossClump(x, y, r, count) {
    // a soft flat cushion, many small tufts on top, then sunlit specks
    let s = `<ellipse cx="${n1(x)}" cy="${n1(y + r * 0.15)}" rx="${n1(r * 0.95)}" ry="${n1(r * 0.5)}" fill="#3a6526" opacity=".9"/>`;
    for (let i = 0; i < count * 1.6; i++) {
      const a = R(0, Math.PI * 2), d = Math.sqrt(rnd()) * r;
      s += `<circle cx="${n1(x + Math.cos(a) * d)}" cy="${n1(y + Math.sin(a) * d * 0.55)}" r="${n1(R(r * 0.12, r * 0.26))}" fill="${pick(MOSS)}"/>`;
    }
    for (let i = 0; i < count * 0.6; i++) {
      const a = R(0, Math.PI * 2), d = Math.sqrt(rnd()) * r * 0.85;
      s += `<circle cx="${n1(x + Math.cos(a) * d - r * 0.15)}" cy="${n1(y - Math.abs(Math.sin(a)) * d * 0.45)}" r="${n1(R(1, 2.6))}" fill="#b4dc74" opacity=".9"/>`;
    }
    return s;
  }

  // Point across a limb: u = 1 is the upper surface, u = -1 the underside.
  function across(b, t, u) {
    const c = b.at(t), d = b.tan(t), h = b.width(t) / 2;
    let nx = d.y, ny = -d.x;
    if (ny > 0) { nx = -nx; ny = -ny; }
    return [c.x + nx * h * u, c.y + ny * h * u];
  }
  function band(b, u0, u1, fill, opacity) {
    const a = [], z = [];
    for (let i = 0; i <= 28; i++) { const t = i / 28; a.push(across(b, t, u0)); z.push(across(b, t, u1)); }
    return `<path d="${smoothPath(a.concat(z.reverse()), true)}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`;
  }
  // Limb with cylindrical shading; colours = [base, highlight, shadow].
  function branchShape(b, colors) {
    const tip = b.at(1);
    return band(b, 1, -1, colors[0], 1) + band(b, 1, 0.3, colors[1], 0.75) + band(b, -0.4, -1, colors[2], 0.7) +
      `<circle cx="${n1(tip.x)}" cy="${n1(tip.y)}" r="${n1(b.width(1) / 2)}" fill="${colors[0]}"/>`;
  }

  function branchBark(b) {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const u = R(-0.75, 0.75), t0 = R(0, 0.7), t1 = Math.min(1, t0 + R(0.15, 0.4));
      const pts = [];
      for (let j = 0; j <= 5; j++) {
        const t = lerp(t0, t1, j / 5), c = b.at(t), d = b.tan(t), h = b.width(t) / 2;
        pts.push([c.x + d.y * h * u, c.y - d.x * h * u]);
      }
      s += `<path d="${smoothPath(pts)}" stroke="${rnd() < 0.6 ? '#1c140c' : '#a08b6c'}" stroke-opacity=".35" stroke-width="${n1(R(1, 2.6))}" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  }

  function shelfFungus(x, y, w, dir) {
    // dir: -1 grows out of the left edge, 1 out of the right edge
    let s = '';
    for (let i = 0; i < 3; i++) {
      const ww = w * (1 - i * 0.22), yy = y + i * w * 0.32, xx = x + dir * i * 2;
      const tipX = xx + dir * ww;
      s += `<path d="M${n1(xx)},${n1(yy)} C${n1(xx + dir * ww * 0.5)},${n1(yy - ww * 0.32)} ${n1(tipX)},${n1(yy - ww * 0.18)} ${n1(tipX)},${n1(yy + ww * 0.04)} ` +
           `C${n1(xx + dir * ww * 0.6)},${n1(yy + ww * 0.2)} ${n1(xx + dir * ww * 0.2)},${n1(yy + ww * 0.14)} ${n1(xx)},${n1(yy + ww * 0.12)}Z" fill="#d9b77c"/>` +
           `<path d="M${n1(xx + dir * ww * 0.15)},${n1(yy - ww * 0.02)} C${n1(xx + dir * ww * 0.5)},${n1(yy - ww * 0.22)} ${n1(tipX - dir * 6)},${n1(yy - ww * 0.1)} ${n1(tipX - dir * 3)},${n1(yy + ww * 0.02)}" stroke="#f3e2b8" stroke-width="2" fill="none" opacity=".85"/>` +
           `<path d="M${n1(xx)},${n1(yy + ww * 0.12)} C${n1(xx + dir * ww * 0.3)},${n1(yy + ww * 0.17)} ${n1(xx + dir * ww * 0.7)},${n1(yy + ww * 0.16)} ${n1(tipX)},${n1(yy + ww * 0.04)}" stroke="#9c7442" stroke-width="2" fill="none"/>`;
    }
    return s;
  }

  function bromeliad(x, y, size) {
    let s = '';
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = -150 + (120 * i) / (n - 1) + R(-6, 6);
      const L = size * R(0.75, 1.1);
      s += leaf(x, y, a + 90, L, L * 0.13, i % 2 ? '#3f8a3a' : '#57a046', '#9ad27a', R(-6, 6));
    }
    s += `<path d="M${x - 4},${y} C${x - 3},${y - size * 0.45} ${x + 3},${y - size * 0.45} ${x + 4},${y}Z" fill="#d2543c"/>`;
    s += `<path d="M${x - 1.5},${y - size * 0.1} L${x},${y - size * 0.62} L${x + 1.5},${y - size * 0.1}Z" fill="#f08a5c"/>`;
    return s;
  }

  /* ---------- layers & sprites ---------- */
  const layers = [];
  const beetles = [];

  function addLayer(cls, depth) {
    const node = document.createElement('div');
    node.className = 'sc-layer ' + cls;
    scene.appendChild(node);
    const layer = { node, depth, art: null, sprites: [], tx: 0, ty: 0 };
    layers.push(layer);
    return layer;
  }

  function setArt(layer, inner) {
    layer.node.insertAdjacentHTML('afterbegin',
      `<svg class="sc-art" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" focusable="false">${inner}</svg>`);
    layer.art = layer.node.firstElementChild;
  }

  // A sprite is a small composited element anchored at world point (x, y).
  // (w, h) is its box in world units and (ox, oy) the anchor inside that box; markup is drawn around (0, 0).
  function addSprite(layer, o) {
    const node = document.createElement('div');
    node.className = 'sc-sprite' + (o.cls ? ' ' + o.cls : '');
    const inner = document.createElement('div');
    inner.className = 'sc-inner' + (o.sway && !reduceMotion ? ' sc-sway' : '');
    inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(-o.ox)} ${n1(-o.oy)} ${n1(o.w)} ${n1(o.h)}" focusable="false">${o.html}</svg>`;
    node.appendChild(inner);
    layer.node.appendChild(node);
    if (o.sway) {
      inner.style.setProperty('--amp', n1(o.sway.amp) + 'deg');
      inner.style.setProperty('--dur', n1(o.sway.dur) + 's');
      inner.style.setProperty('--delay', n1(-R(0, o.sway.dur * 2)) + 's');
    }
    const s = { node, inner, x: o.x || 0, y: o.y || 0, w: o.w, h: o.h, ox: o.ox, oy: o.oy, angle: 0, flip: 1, scale: o.scale || 1, anchor: o.anchor || null };
    layer.sprites.push(s);
    return s;
  }

  /* ---------- world mapping ---------- */
  let view = { vx: 0, vy: 0, vw: WORLD.w, vh: WORLD.h, k: 1, ox: 0, oy: 0 };

  function applyTransform(s) {
    const k = view.k;
    const px = (s.x - s.ox - view.ox) * k, py = (s.y - s.oy - view.oy) * k;
    s.node.style.transform = `translate3d(${n1(px)}px,${n1(py)}px,0) rotate(${s.angle.toFixed(4)}rad) scale(${(s.flip * s.scale).toFixed(4)},${s.scale.toFixed(4)})`;
  }

  function placeSprite(s) {
    const k = view.k;
    s.node.style.width = n1(s.w * k) + 'px';
    s.node.style.height = n1(s.h * k) + 'px';
    const origin = `${n1(s.ox * k)}px ${n1(s.oy * k)}px`;
    s.node.style.transformOrigin = origin;
    s.inner.style.transformOrigin = origin;
    applyTransform(s);
  }

  let lastSize = '';
  function layout() {
    const W = scene.clientWidth || window.innerWidth, H = scene.clientHeight || window.innerHeight;
    if (W + 'x' + H === lastSize) return;
    lastSize = W + 'x' + H;
    const aspect = W / H;
    let vw, vh;
    if (aspect >= WORLD.w / WORLD.h) { vw = WORLD.w; vh = WORLD.w / aspect; } else { vh = WORLD.h; vw = WORLD.h * aspect; }
    const compact = isCompact();
    const vx = clamp(FOCUS.x - vw * (compact ? 0.4 : 0.6), 0, WORLD.w - vw);
    const vy = clamp(FOCUS.y - vh * 0.56, 0, WORLD.h - vh);
    const k = W / vw;
    view = { vx, vy, vw, vh, k, ox: vx - BLEED.x / k, oy: vy - BLEED.top / k };
    const viewBox = `${n1(view.ox)} ${n1(view.oy)} ${n1((W + BLEED.x * 2) / k)} ${n1((H + BLEED.top + BLEED.bottom) / k)}`;
    for (const layer of layers) {
      if (layer.art) layer.art.setAttribute('viewBox', viewBox);
      for (const s of layer.sprites) {
        if (s.anchor) { s.x = vx + s.anchor.fx * vw + s.anchor.dx; s.y = vy + s.anchor.fy * vh + s.anchor.dy; }
        placeSprite(s);
      }
    }
    for (const b of beetles) b.fit();
  }

  /* ================= LAYER 1 · far hazy forest ================= */
  const far = addLayer('sc-far', 0.04);
  (function () {
    let s = `<defs><linearGradient id="scFarHaze" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#d7ecc4" stop-opacity="0"/><stop offset=".5" stop-color="#d7ecc4" stop-opacity=".05"/>` +
      `<stop offset="1" stop-color="#bcdcae" stop-opacity=".9"/></linearGradient></defs>`;
    for (let i = 0; i < 16; i++) {
      s += `<ellipse cx="${n1(R(-150, 1750))}" cy="${n1(R(-120, 90))}" rx="${n1(R(150, 320))}" ry="${n1(R(70, 150))}" fill="#c5e3b2" opacity="${n1(R(0.35, 0.65))}"/>`;
    }
    for (let i = 0; i < 30; i++) {
      const x = R(-120, 1720), w = R(10, 36), lean = R(-40, 40);
      const c = pick(['#a3cba2', '#93c09a', '#9cc69c']);
      let tree = `<path d="M${n1(x - w * 0.32)},-300 L${n1(x + w * 0.32)},-300 L${n1(x + lean + w * 0.6)},1300 L${n1(x + lean - w * 0.6)},1300Z"/>`;
      if (rnd() < 0.7) {
        const by = R(80, 620), dir = rnd() < 0.5 ? -1 : 1, bl = R(50, 140);
        const bx = x + lean * ((by + 300) / 1600);
        const b = makeBranch({ x: bx, y: by + 6 }, { x: bx + dir * bl * 0.5, y: by - bl * 0.2 }, { x: bx + dir * bl, y: by - bl * 0.62 }, w * 0.42, w * 0.14);
        tree += band(b, 1, -1, c, 1);
      }
      s += `<g fill="${c}" opacity="${n1(R(0.45, 0.85))}">${tree}</g>`;
    }
    s += `<rect x="-300" y="-300" width="2200" height="1700" fill="url(#scFarHaze)"/>`;
    setArt(far, s);
  })();

  /* ================= LAYER 2 · far mist ================= */
  const mistA = addLayer('sc-mistlayer', 0.07);
  mistA.node.innerHTML = '<div class="sc-mist sc-mist-a"></div>';

  /* ================= LAYER 3 · mid forest ================= */
  const mid = addLayer('sc-mid', 0.12);
  const midTrunks = {};
  (function () {
    let s = `<defs><linearGradient id="scMidTrunk" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#6ea676"/><stop offset=".45" stop-color="#52905f"/><stop offset="1" stop-color="#3a6f49"/></linearGradient>` + `</defs>`;
    const trunks = [[-40, 70], [240, 58], [560, 76], [880, 64], [1520, 84], [1730, 70]];
    for (const [x0, w] of trunks) {
      const lean = R(-30, 30), left = [], right = [];
      const centre = (y) => x0 + lean * ((y + 300) / 1600) + Math.sin(y / 170 + x0) * 7;
      midTrunks[x0] = centre;
      for (let y = -300; y <= 1300; y += 80) {
        const t = (y + 300) / 1600, cx = centre(y);
        const hw = (w / 2) * (0.85 + t * 0.35) + (y > 900 ? (y - 900) * 0.18 : 0);
        left.push([cx - hw, y]); right.push([cx + hw, y]);
      }
      s += `<path d="${smoothPath(left.concat(right.reverse()), true)}" fill="url(#scMidTrunk)"/>`;
      for (let i = 0; i < 2; i++) {
        const by = R(140, 620), dir = (x0 > 800 ? -1 : 1) * (rnd() < 0.7 ? 1 : -1);
        const bx = x0 + lean * ((by + 300) / 1600);
        const b = makeBranch({ x: bx, y: by }, { x: bx + dir * R(80, 140), y: by - R(20, 60) }, { x: bx + dir * R(170, 260), y: by - R(40, 110) }, R(16, 24), 6);
        s += branchShape(b, ['#4f8a5c', '#6aa674', '#3a6c48']);
        const tip = b.at(1);
        for (let j = 0; j < 5; j++) s += leaf(tip.x, tip.y, R(-80, 80) + (dir > 0 ? 30 : -30), R(38, 62), R(12, 18), pick(LEAF_MID), '#86bd88', R(-8, 8));
      }
      for (let i = 0; i < 5; i++) {
        const y = R(60, 900);
        s += mossClump(x0 + R(-w * 0.3, w * 0.1), y, R(8, 16), 7).replace(/fill="#[0-9a-f]{6}"/g, () => `fill="${pick(['#6aa25a', '#78b062', '#5f9752'])}"`);
      }
    }
    // undergrowth band
    for (let i = 0; i < 26; i++) {
      s += `<ellipse cx="${n1(R(-200, 1800))}" cy="${n1(R(930, 1040))}" rx="${n1(R(90, 220))}" ry="${n1(R(50, 110))}" fill="${pick(['#3f7a4b', '#467f50', '#36704a'])}"/>`;
    }
    setArt(mid, s);

    // a few swaying vines in the mid distance
    [[420, -260, 640], [760, -260, 520], [1460, -260, 700]].forEach(([x, y, L]) => vineSprite(mid, x, y, L, LEAF_MID, '#3f7448', 0.85));
  })();

  /* ================= LAYER 4 · light rays ================= */
  const rays = addLayer('sc-rayslayer', 0.09);
  (function () {
    const spots = [[8, 150, -24], [19, 90, -22], [31, 210, -25], [44, 120, -21], [57, 170, -23], [71, 110, -20]];
    for (const [x, w, r] of spots) {
      const ray = document.createElement('div');
      ray.className = 'sc-ray';
      ray.style.setProperty('--x', x + '%');
      ray.style.setProperty('--w', w + 'px');
      ray.style.setProperty('--r', r + 'deg');
      ray.style.setProperty('--dur', n1(R(7, 12)) + 's');
      ray.style.setProperty('--delay', n1(-R(0, 12)) + 's');
      ray.style.setProperty('--o1', n1(R(0.25, 0.4)));
      ray.style.setProperty('--o2', n1(R(0.6, 0.9)));
      rays.node.appendChild(ray);
    }
  })();

  /* ================= LAYER 5 · low mist ================= */
  const mistB = addLayer('sc-mistlayer', 0.16);
  mistB.node.innerHTML = '<div class="sc-mist sc-mist-b"></div>';

  /* ================= LAYER 6 · hero trunk, branches & beetles ================= */
  const main = addLayer('sc-main', 0.22);

  const TRUNK = {
    cx: (y) => 1272 + 14 * Math.sin(y / 260 + 0.6),
    hw: (y) => 86 + y * 0.012 + 5 * Math.sin(y / 95) + (y > 860 ? Math.min(150, Math.pow((y - 860) / 140, 2) * 70) : 0),
  };
  const BR_MAIN = makeBranch({ x: 1200, y: 588 }, { x: 990, y: 468 }, { x: 790, y: 488 }, 58, 16);
  const BR_TWIG = makeBranch(BR_MAIN.at(0.62), { x: 900, y: 430 }, { x: 870, y: 372 }, 13, 4);
  const BR_RIGHT = makeBranch({ x: 1338, y: 402 }, { x: 1480, y: 350 }, { x: 1720, y: 378 }, 44, 26);

  (function () {
    let s = `<defs>` +
      `<linearGradient id="scTrunk" gradientUnits="userSpaceOnUse" x1="1172" y1="0" x2="1372" y2="0">` +
      `<stop offset="0" stop-color="${BARK.lit}"/><stop offset=".32" stop-color="${BARK.mid}"/><stop offset=".72" stop-color="${BARK.deep}"/><stop offset="1" stop-color="${BARK.dark}"/></linearGradient>` +
      `<radialGradient id="scTrunkGlow" cx=".2" cy=".35" r=".6"><stop offset="0" stop-color="#d9f0a6" stop-opacity=".22"/><stop offset="1" stop-color="#d9f0a6" stop-opacity="0"/></radialGradient>`;

    const L = [], Rr = [];
    for (let y = -320; y <= 1320; y += 40) { const c = TRUNK.cx(y), h = TRUNK.hw(y); L.push([c - h, y]); Rr.push([c + h, y]); }
    const trunkD = smoothPath(L.concat(Rr.slice().reverse()), true);
    s += `<clipPath id="scTrunkClip"><path d="${trunkD}"/></clipPath></defs>`;

    // branches sit behind the trunk so they appear to grow out of it
    const barkColors = [BARK.mid, '#8a7655', BARK.dark];
    s += branchShape(BR_RIGHT, barkColors) + branchBark(BR_RIGHT);
    s += branchShape(BR_MAIN, barkColors) + branchShape(BR_TWIG, barkColors) + branchBark(BR_MAIN);

    s += `<path d="${trunkD}" fill="url(#scTrunk)"/>`;
    // bark furrows that follow the trunk's curvature
    let bark = '';
    for (let i = 0; i < 80; i++) {
      const y0 = R(-300, 1180), len = R(60, 260), u = R(-0.94, 0.94);
      const pts = [];
      for (let j = 0; j <= 6; j++) { const y = y0 + (len * j) / 6; pts.push([TRUNK.cx(y) + u * TRUNK.hw(y) + R(-3, 3), y]); }
      const dark = rnd() < 0.62;
      bark += `<path d="${smoothPath(pts)}" stroke="${dark ? '#1a120a' : '#a8946f'}" stroke-opacity="${dark ? n1(R(0.25, 0.5)) : n1(R(0.12, 0.3))}" stroke-width="${n1(R(1.2, 4.2))}" fill="none" stroke-linecap="round"/>`;
    }
    s += `<g clip-path="url(#scTrunkClip)">${bark}<rect x="1160" y="-320" width="240" height="1640" fill="url(#scTrunkGlow)"/></g>`;
    // rim light on the sunny (left) edge
    s += `<path d="${smoothPath(L.slice(4, 34).map(([x, y]) => [x + 3, y]))}" stroke="#c9e39a" stroke-opacity=".35" stroke-width="3" fill="none"/>`;

    // moss: along the lit edge, at the branch joints and on top of the branches
    for (let i = 0; i < 16; i++) {
      const y = R(-120, 940);
      s += mossClump(TRUNK.cx(y) - TRUNK.hw(y) * R(0.55, 1.02), y, R(16, 38), 16);
    }
    for (let i = 0; i < 5; i++) { const y = R(100, 900); s += mossClump(TRUNK.cx(y) + TRUNK.hw(y) * R(0.6, 0.95), y, R(10, 20), 9); }
    s += mossClump(1188, 572, 46, 34) + mossClump(1345, 395, 34, 24);
    for (const b of [BR_MAIN, BR_RIGHT]) {
      for (let t = 0.05; t < 0.92; t += R(0.07, 0.13)) { const p = b.top(t); s += mossClump(p.x, p.y + 4, b.width(t) * R(0.3, 0.5), 10); }
    }
    // hanging moss strands under the branches
    for (const [b, n] of [[BR_MAIN, 7], [BR_RIGHT, 6]]) {
      for (let i = 0; i < n; i++) {
        const t = R(0.12, 0.85), c = b.at(t), d = b.tan(t), h = b.width(t) / 2;
        let x = c.x - d.y * h * (d.x < 0 ? -1 : 1), y = c.y + Math.abs(d.x) * h - 2;
        const len = R(30, 95), pts = [[x, y]];
        for (let j = 1; j <= 5; j++) pts.push([x + Math.sin(j * 1.3 + i) * 4, y + (len * j) / 5]);
        s += `<path d="${smoothPath(pts)}" stroke="#a6c788" stroke-opacity=".6" stroke-width="${n1(R(1, 2))}" fill="none" stroke-linecap="round"/>`;
      }
    }
    s += shelfFungus(TRUNK.cx(720) - TRUNK.hw(720) + 6, 720, 46, -1);
    s += shelfFungus(TRUNK.cx(470) + TRUNK.hw(470) - 6, 470, 34, 1);
    s += bromeliad(BR_MAIN.top(0.16).x, BR_MAIN.top(0.16).y + 6, 58);
    s += bromeliad(BR_RIGHT.top(0.42).x, BR_RIGHT.top(0.42).y + 5, 44);
    // ground & roots
    s += `<path d="M-300,1000 C200,965 620,992 930,976 C1220,962 1450,990 1900,972 L1900,1500 L-300,1500Z" fill="#1c3a23"/>`;
    for (const dir of [-1, 1]) {
      s += `<path d="M${1272 + dir * 90},930 C${1272 + dir * 170},960 ${1272 + dir * 240},975 ${1272 + dir * 330},1000 L${1272 + dir * 300},1012 C${1272 + dir * 220},992 ${1272 + dir * 140},985 ${1272 + dir * 60},990Z" fill="${BARK.deep}"/>`;
    }
    setArt(main, s);

    // swaying vines and leaf sprays (separate sprites so they never repaint the big layer)
    [[985, -300, 560], [1090, -300, 760], [1435, -300, 520], [690, -300, 470]].forEach(([x, y, L]) => vineSprite(main, x, y, L, LEAF_MAIN, '#2f5a2c', 1));
    leafSpray(main, BR_MAIN.at(1), 7, [50, 80], [-130, 40], LEAF_MAIN, '#8fcf86');
    leafSpray(main, BR_TWIG.at(1), 5, [36, 58], [-60, 70], LEAF_MAIN, '#8fcf86');
    leafSpray(main, BR_RIGHT.at(0.78), 6, [44, 70], [-70, 80], LEAF_MAIN, '#8fcf86');
  })();

  function vineSprite(layer, x, y, L, colors, stem, scale) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([Math.sin(t * 3.2 + x) * 16 * t, t * L]); }
    let s = `<path d="${smoothPath(pts)}" stroke="${stem}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    const count = Math.round(L / 30);
    for (let i = 1; i <= count; i++) {
      const f = (i / (count + 0.5)) * 8, j = Math.min(7, Math.floor(f)), r = f - j;
      const px = lerp(pts[j][0], pts[j + 1][0], r), py = lerp(pts[j][1], pts[j + 1][1], r);
      s += leaf(px, py, (i % 2 ? 1 : -1) * R(60, 115), R(16, 27), R(7, 11), pick(colors), '#a5d38c', R(-4, 4));
    }
    addSprite(layer, { x, y, w: 120, h: L + 40, ox: 60, oy: 0, html: s, scale, sway: { amp: R(1.2, 2.4), dur: R(5.5, 9) } });
  }

  function leafSpray(layer, p, count, len, spread, colors, vein) {
    let s = '';
    for (let i = 0; i < count; i++) {
      const a = lerp(spread[0], spread[1], count === 1 ? 0.5 : i / (count - 1)) + R(-10, 10);
      const L = R(len[0], len[1]);
      s += leaf(0, 0, a, L, L * R(0.26, 0.34), pick(colors), vein, R(-L * 0.14, L * 0.14));
    }
    const box = len[1] + 20;
    return addSprite(layer, { x: p.x, y: p.y, w: box * 2, h: box * 2, ox: box, oy: box, html: s, sway: { amp: R(1.5, 3.2), dur: R(4.5, 8) } });
  }

  // ferns along the bottom edge of the view
  [[0.06, 1.0], [0.24, 0.85], [0.47, 1.1], [0.66, 0.9], [0.86, 1.15], [0.98, 0.95]].forEach(([fx, sc], i) => {
    let s = '';
    const n = 7;
    for (let j = 0; j < n; j++) s += frond(-75 + (150 * j) / (n - 1) + R(-8, 8), R(110, 160), R(-26, 26), i % 2 ? '#3f8a3b' : '#4a9442', '#2c6a30');
    addSprite(main, { anchor: { fx, fy: 1, dx: 0, dy: 26 }, w: 360, h: 190, ox: 180, oy: 180, html: s, scale: sc, sway: { amp: R(1, 2.2), dur: R(5, 8) } });
  });

  /* ---------- beetles ---------- */
  function sideBeetleArt(o) {
    const id = 'scS' + o.id;
    const leg = (hip, knee, foot, toe, color, wf, wt, cls) => {
      const k = [knee[0] - hip[0], knee[1] - hip[1]], f = [foot[0] - hip[0], foot[1] - hip[1]], t = [toe[0] - hip[0], toe[1] - hip[1]];
      const sx = k[0] + (f[0] - k[0]) * 0.4, sy = k[1] + (f[1] - k[1]) * 0.4;
      const sx2 = k[0] + (f[0] - k[0]) * 0.7, sy2 = k[1] + (f[1] - k[1]) * 0.7;
      return `<g transform="translate(${hip[0]},${hip[1]})"><g class="sc-leg ${cls}">` +
        `<path d="M0,0 L${n1(k[0])},${n1(k[1])}" stroke="${color}" stroke-width="${wf}" stroke-linecap="round"/>` +
        `<path d="M${n1(k[0])},${n1(k[1])} L${n1(f[0])},${n1(f[1])} L${n1(t[0])},${n1(t[1])}" stroke="${color}" stroke-width="${wt}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<path d="M${n1(sx)},${n1(sy)} l2.6,-1.4 M${n1(sx2)},${n1(sy2)} l2.6,-1.4" stroke="${color}" stroke-width="1.1" stroke-linecap="round"/></g></g>`;
    };
    const far = leg([40, -19], [55, -28], [69, -2], [75, 0], o.legFar, 3.6, 2.4, 'sc-b') +
                leg([18, -17], [27, -30], [37, -2], [43, 0], o.legFar, 3.6, 2.4, 'sc-a') +
                leg([-4, -17], [-18, -30], [-28, -2], [-35, 0], o.legFar, 3.6, 2.4, 'sc-b');
    const near = leg([36, -16], [50, -27], [64, -1], [71, 0], o.leg, 4.6, 3, 'sc-a') +
                 leg([14, -15], [22, -31], [31, -1], [38, 0], o.leg, 4.6, 3, 'sc-b') +
                 leg([-8, -15], [-24, -30], [-37, -1], [-45, 0], o.leg, 4.6, 3, 'sc-a');
    const elytra = 'M-50,-16 C-54,-36 -34,-55 -6,-55 C14,-55 27,-46 28,-32 C28,-24 26,-18 22,-15 C4,-11 -28,-9 -50,-16Z';
    const pron = 'M21,-47 C31,-55 48,-51 55,-39 C58,-30 56,-20 48,-16 L23,-15 C20,-24 18,-39 21,-47Z';
    let front = '';
    if (o.kind === 'hercules') {
      front += `<path d="M30,-50 C52,-67 86,-71 112,-59 C118,-56 120,-50 116,-47 C112,-50 104,-53 96,-53 C80,-53 64,-48 52,-40Z" fill="url(#${id}b)"/>` +
               `<path d="M80,-53.4 l2,5 l3,-5.6Z M92,-53.6 l2,4.2 l3,-4.4Z" fill="${o.body[1]}"/>` +
               `<path d="M62,-27 C76,-30 90,-41 96,-59 C97,-62 101,-62 101,-58 C99,-41 86,-24 66,-18Z" fill="url(#${id}b)"/>` +
               `<path d="M84,-34.5 l4.6,-1 l-1.6,-5Z" fill="${o.body[1]}"/>` +
               `<path d="M32,-51 C54,-66 86,-70 112,-59" stroke="${o.rim}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
               `<path d="M65,-26.5 C78,-30 89,-40 95,-57" stroke="${o.rim}" stroke-width="1" fill="none" opacity=".85" stroke-linecap="round"/>`;
    } else {
      front += `<path d="M63,-26 C80,-35 99,-36 112,-28 C114,-26 113,-24 110,-25 C98,-29 84,-27 67,-20Z" fill="${o.body[1]}" opacity=".9"/>` +
               `<path d="M63,-23 C81,-29 100,-27 113,-18 C115,-16 113,-14 110,-15 C98,-21 84,-20 66,-16Z" fill="url(#${id}b)"/>` +
               `<path d="M89,-24.4 l1,-5.6 l3.2,4.8Z" fill="url(#${id}b)"/>`;
    }
    const body = `<g class="sc-body">` +
      `<path d="M-48,-14 C-40,-6 -20,-5 0,-7 L2,-12 C-20,-10 -36,-10 -48,-14Z" fill="${o.body[1]}"/>` +
      `<path d="${elytra}" fill="url(#${id}e)"/>` +
      `<path d="${pron}" fill="url(#${id}b)"/>` +
      `<path d="M48,-30 C56,-34 66,-31 68,-24 C68,-18 60,-14 52,-16Z" fill="url(#${id}b)"/>` +
      front +
      `<path d="M-48,-17 C-26,-12 6,-13 24,-17" stroke="#fff" stroke-opacity=".12" stroke-width="1" fill="none"/>` +
      `<path d="M-40,-39 C-30,-49 -12,-51 4,-48" stroke="#fff" stroke-opacity=".5" stroke-width="3.4" fill="none" stroke-linecap="round"/>` +
      `<path d="M-46,-27 C-44,-33 -40,-38 -35,-41" stroke="#fff" stroke-opacity=".22" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
      `<path d="M27,-49 C36,-53 46,-50 51,-44" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>` +
      (o.rim ? `<path d="${elytra}" fill="none" stroke="${o.rim}" stroke-width="1.2" opacity=".9"/><path d="${pron}" fill="none" stroke="${o.rim}" stroke-width="1" opacity=".75"/>` : '') +
      `<circle cx="60" cy="-25" r="1.9" fill="#000"/><circle cx="60.6" cy="-25.6" r=".6" fill="#fff" opacity=".8"/>` +
      `<g transform="translate(64,-20)"><g class="sc-ant"><path d="M0,0 L5,4 L9,2.5" stroke="${o.leg}" stroke-width="1.2" fill="none" stroke-linecap="round"/><ellipse cx="9.6" cy="2.3" rx="2" ry="1.2" fill="${o.leg}"/></g></g>` +
      `</g>`;
    return `<defs>` +
      `<linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.shell[0]}"/><stop offset="1" stop-color="${o.shell[1]}"/></linearGradient>` +
      `<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.body[0]}"/><stop offset="1" stop-color="${o.body[1]}"/></linearGradient>` +
      `<radialGradient id="${id}s"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
      `<ellipse cx="10" cy="1" rx="64" ry="6.5" fill="url(#${id}s)"/>` + far + body + near;
  }

  function topBeetleArt(o) {
    const id = 'scT' + o.id;
    const table = [
      [[13, -18], [27, -28], [32, -48], [33, -56]],
      [[14, 2], [32, -2], [44, 10], [49, 14]],
      [[13, 20], [28, 30], [34, 54], [36, 62]],
    ];
    const rightGroup = ['b', 'a', 'b'], leftGroup = ['a', 'b', 'a']; // tripod gait: L1 R2 L3 ↔ R1 L2 R3
    let legs = '';
    table.forEach(([hip, knee, foot, toe], i) => {
      for (const s of [1, -1]) {
        const k = [(knee[0] - hip[0]) * s, knee[1] - hip[1]], f = [(foot[0] - hip[0]) * s, foot[1] - hip[1]], t = [(toe[0] - hip[0]) * s, toe[1] - hip[1]];
        const cls = s > 0 ? `sc-leg sc-r sc-${rightGroup[i]}` : `sc-leg sc-${leftGroup[i]}`;
        legs += `<g transform="translate(${hip[0] * s},${hip[1]})"><g class="${cls}">` +
          `<path d="M0,0 L${k[0]},${k[1]}" stroke="${o.leg}" stroke-width="4.4" stroke-linecap="round"/>` +
          `<path d="M${k[0]},${k[1]} L${f[0]},${f[1]} L${t[0]},${t[1]}" stroke="${o.leg}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></g>`;
      }
    });
    let horns = '';
    if (o.kind === 'stag') {
      horns = `<path d="M4,-41 C12,-49 14,-59 8,-67 C7,-68 5.6,-67 6.2,-65.6 C10,-57 8,-49 1.6,-43.4Z" fill="url(#${id}b)"/>` +
              `<path d="M-4,-41 C-12,-49 -14,-59 -8,-67 C-7,-68 -5.6,-67 -6.2,-65.6 C-10,-57 -8,-49 -1.6,-43.4Z" fill="url(#${id}b)"/>`;
    } else {
      horns = `<path d="M-3.6,-41 C-3,-51 -1.4,-61 0,-68 C1.4,-61 3,-51 3.6,-41Z" fill="url(#${id}b)"/>` +
              `<path d="M-6,-28 C-4,-36 -1,-43 0,-48 C1,-43 4,-36 6,-28Z" fill="url(#${id}b)"/>`;
      if (o.kind === 'five') {
        horns += `<path d="M-17,-23 L-25,-33 L-14,-27Z M17,-23 L25,-33 L14,-27Z M-10,-30 L-14,-41 L-6,-31Z M10,-30 L14,-41 L6,-31Z" fill="url(#${id}b)"/>`;
      }
    }
    const elR = 'M1,-8 C18,-9 27,4 27,22 C27,44 16,60 1,62Z';
    const elL = 'M-1,-8 C-18,-9 -27,4 -27,22 C-27,44 -16,60 -1,62Z';
    const pron = 'M-21,-12 C-22,-25 -12,-33 0,-33 C12,-33 22,-25 21,-12 C14,-7 -14,-7 -21,-12Z';
    return `<defs>` +
      `<radialGradient id="${id}e" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="${o.shell[0]}"/><stop offset="1" stop-color="${o.shell[1]}"/></radialGradient>` +
      `<radialGradient id="${id}b" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="${o.body[0]}"/><stop offset="1" stop-color="${o.body[1]}"/></radialGradient>` +
      `<radialGradient id="${id}s"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
      `<ellipse cx="4" cy="12" rx="40" ry="60" fill="url(#${id}s)"/>` + legs +
      `<g class="sc-body">` +
      `<g transform="translate(-7,-40)"><g class="sc-ant"><path d="M0,0 L-7,-6 L-11,-4" stroke="${o.leg}" stroke-width="1.3" fill="none" stroke-linecap="round"/></g></g>` +
      `<g transform="translate(7,-40)"><g class="sc-ant sc-ant-r"><path d="M0,0 L7,-6 L11,-4" stroke="${o.leg}" stroke-width="1.3" fill="none" stroke-linecap="round"/></g></g>` +
      `<path d="${elR}" fill="url(#${id}e)"/><path d="${elL}" fill="url(#${id}e)"/>` +
      `<path d="M0,-8 L0,62" stroke="#000" stroke-opacity=".45" stroke-width="1.2"/>` +
      `<ellipse cx="-12" cy="12" rx="5" ry="15" fill="#fff" opacity=".24" transform="rotate(10 -12 12)"/>` +
      `<ellipse cx="12" cy="8" rx="3" ry="10" fill="#fff" opacity=".1"/>` +
      `<path d="${pron}" fill="url(#${id}b)"/>` +
      `<ellipse cx="0" cy="-37" rx="9" ry="7" fill="url(#${id}b)"/>` + horns +
      `<ellipse cx="-7" cy="-24" rx="6" ry="3" fill="#fff" opacity=".26"/>` +
      (o.rim ? `<path d="${elR}" fill="none" stroke="${o.rim}" stroke-width="1" opacity=".7"/><path d="${elL}" fill="none" stroke="${o.rim}" stroke-width="1" opacity=".7"/>` : '') +
      `</g>`;
  }

  function setGait(b, moving, ratio) {
    const node = b.sprite.node;
    if (moving !== b.moving) { node.classList.toggle('is-walking', moving); b.moving = moving; }
    const gait = clamp(0.5 / (0.55 + 0.45 * ratio), 0.16, 0.6);
    if (Math.abs(gait - (b.gait || 0)) > 0.02) { node.style.setProperty('--gait', gait.toFixed(2) + 's'); b.gait = gait; }
  }

  function pointerWorld(layer) {
    if (!pointer.seen) return null;
    return { x: (pointer.px + BLEED.x - layer.tx) / view.k + view.ox, y: (pointer.py + BLEED.top - layer.ty) / view.k + view.oy };
  }

  // Side-view beetle patrolling the top of a branch; turns around by "flipping" through 0 (reads as depth).
  function branchWalker(layer, sprite, branch, o) {
    const b = { sprite, t: o.t, dir: o.dir, speed: 0, walking: true, timer: R(1, 3), startle: 0, turn: 0, turnFrom: 1, lo: o.lo, hi: o.hi };
    const faceOf = (dir) => (branch.tan(b.t).x * dir >= 0 ? 1 : -1);
    const startTurn = () => { if (b.turn > 0) return; b.turnFrom = faceOf(b.dir); b.dir = -b.dir; b.turn = 1; };
    b.fit = () => {
      // patrol only the on-screen part of the branch (and stay clear of the hero text on wide screens)
      const xMin = isCompact() ? view.vx + 70 : view.vx + view.vw * 0.56, xMax = view.vx + view.vw - 70;
      let lo = 1, hi = 0;
      for (let t = o.lo; t <= o.hi + 1e-6; t += 0.01) { const x = branch.at(t).x; if (x > xMin && x < xMax) { lo = Math.min(lo, t); hi = Math.max(hi, t); } }
      if (hi - lo < 0.1) { lo = o.lo; hi = o.hi; }
      b.lo = lo; b.hi = hi; b.t = clamp(b.t, lo, hi);
      b.update(0);
    };
    b.update = (dt) => {
      b.timer -= dt;
      if (b.timer <= 0) { b.walking = !b.walking; b.timer = b.walking ? R(3, 7) : R(1.2, 3.5); }
      const here = branch.top(b.t);
      const pw = pointerWorld(layer);
      if (pw && b.startle <= 0 && Math.hypot(pw.x - here.x, pw.y - (here.y - 32)) < 90) {
        b.startle = 1.5; b.walking = true; b.timer = Math.max(b.timer, 2.5);
        if (branch.tan(b.t).x * b.dir * (pw.x - here.x) > 0) startTurn(); // pointer ahead → run the other way
      }
      b.startle -= dt;
      const target = b.turn > 0 ? 0 : b.startle > 0 ? o.speed * 3.4 : b.walking ? o.speed : 0;
      b.speed += (target - b.speed) * Math.min(1, dt * 4);
      let flip = faceOf(b.dir);
      if (b.turn > 0) {
        b.turn = Math.max(0, b.turn - dt / 0.45);
        flip = b.turnFrom * Math.cos(Math.PI * (1 - b.turn));
      } else {
        b.t += (b.dir * b.speed * dt) / branch.length;
        if (b.t <= b.lo) { b.t = b.lo; startTurn(); } else if (b.t >= b.hi) { b.t = b.hi; startTurn(); }
      }
      const p = branch.top(b.t);
      let d = branch.tan(b.t);
      if (d.x < 0) d = { x: -d.x, y: -d.y };
      sprite.x = p.x; sprite.y = p.y + 1.5;
      sprite.angle = Math.atan2(d.y, d.x);
      sprite.flip = Math.abs(flip) < 0.02 ? 0.02 : flip;
      applyTransform(sprite);
      setGait(b, b.turn > 0 || b.speed > o.speed * 0.15, b.speed / o.speed);
    };
    beetles.push(b);
    return b;
  }

  // Top-view beetle climbing up and down a trunk; turns in place when it changes direction.
  function trunkClimber(layer, sprite, o) {
    const b = { sprite, y: o.y, dir: o.dir, angle: o.dir < 0 ? 0 : Math.PI, speed: 0, walking: true, timer: R(1, 4), startle: 0, wob: R(0, 6) };
    b.fit = () => b.update(0);
    b.update = (dt) => {
      b.timer -= dt;
      if (b.timer <= 0) {
        b.walking = !b.walking;
        b.timer = b.walking ? R(2.5, 6) : R(1.5, 4);
        if (b.walking && rnd() < 0.35) b.dir = -b.dir;
      }
      const pw = pointerWorld(layer);
      if (pw && b.startle <= 0 && Math.hypot(pw.x - sprite.x, pw.y - sprite.y) < 85) {
        b.startle = 1.4; b.walking = true; b.timer = Math.max(b.timer, 2.5);
        b.dir = pw.y < sprite.y ? 1 : -1; // scurry away from the pointer
      }
      b.startle -= dt;
      const want = b.dir < 0 ? 0 : Math.PI;
      const diff = Math.atan2(Math.sin(want - b.angle), Math.cos(want - b.angle));
      const turning = Math.abs(diff) > 0.3;
      b.angle += diff * Math.min(1, dt * (b.startle > 0 ? 6 : 3));
      const target = turning ? 0 : b.startle > 0 ? o.speed * 3.2 : b.walking ? o.speed : 0;
      b.speed += (target - b.speed) * Math.min(1, dt * 4);
      b.y += b.dir * b.speed * dt;
      if (b.y < o.yMin) { b.y = o.yMin; b.dir = 1; } else if (b.y > o.yMax) { b.y = o.yMax; b.dir = -1; }
      b.wob += dt * b.speed * 0.045;
      sprite.x = o.cx(b.y) + o.offset + Math.sin(b.wob) * o.wander;
      sprite.y = b.y;
      sprite.angle = b.angle + Math.cos(b.wob) * 0.14 * clamp(b.speed / o.speed, 0, 1);
      applyTransform(sprite);
      setGait(b, turning || b.speed > o.speed * 0.15, b.speed / o.speed);
    };
    beetles.push(b);
    return b;
  }

  const SIDE_BOX = { w: 190, h: 86, ox: 60, oy: 78 };
  const TOP_BOX = { w: 124, h: 148, ox: 62, oy: 76 };

  // Hercules in the logo's black-and-gold livery, patrolling the main branch
  const herc = addSprite(main, Object.assign({ cls: 'sc-beetle', scale: 0.9, html: sideBeetleArt({
    id: 'herc', kind: 'hercules', shell: ['#3a3a3a', '#050505'], body: ['#2e2e2e', '#060606'], rim: '#d8b45e', leg: '#141414', legFar: '#060606',
  }) }, SIDE_BOX));
  branchWalker(main, herc, BR_MAIN, { t: 0.42, dir: 1, lo: 0.1, hi: 0.86, speed: 26 });

  // Orange stag beetle on the right branch
  const stag = addSprite(main, Object.assign({ cls: 'sc-beetle', scale: 0.62, html: sideBeetleArt({
    id: 'stag', kind: 'stag', shell: ['#d07a32', '#7a3a10'], body: ['#3a2416', '#120a05'], rim: '', leg: '#1c120a', legFar: '#0d0805',
  }) }, SIDE_BOX));
  branchWalker(main, stag, BR_RIGHT, { t: 0.3, dir: -1, lo: 0.06, hi: 0.7, speed: 20 });

  // Rhinoceros beetle climbing the trunk (top view)
  const rhino = addSprite(main, Object.assign({ cls: 'sc-beetle', scale: 0.78, html: topBeetleArt({
    id: 'rhino', kind: 'rhino', shell: ['#8a5a34', '#3a220f'], body: ['#3a2618', '#140c06'], leg: '#1a110a',
  }) }, TOP_BOX));
  trunkClimber(main, rhino, { y: 300, dir: -1, yMin: 110, yMax: 520, cx: TRUNK.cx, offset: -10, wander: 14, speed: 22 });

  // Golden five-horned beetle lower on the trunk
  const five = addSprite(main, Object.assign({ cls: 'sc-beetle', scale: 0.62, html: topBeetleArt({
    id: 'five', kind: 'five', shell: ['#f0c86a', '#9a6c1e'], body: ['#3a2a18', '#120b05'], leg: '#1a120a', rim: '#7a5212',
  }) }, TOP_BOX));
  trunkClimber(main, five, { y: 780, dir: 1, yMin: 640, yMax: 900, cx: TRUNK.cx, offset: 24, wander: 18, speed: 16 });

  // A small, hazy beetle far away on a mid-layer trunk adds depth
  const tiny = addSprite(mid, Object.assign({ cls: 'sc-beetle sc-distant', scale: 0.36, html: topBeetleArt({
    id: 'tiny', kind: 'stag', shell: ['#4d3a2a', '#1e140c'], body: ['#2a1c12', '#100a05'], leg: '#1a120a',
  }) }, TOP_BOX));
  trunkClimber(mid, tiny, { y: 520, dir: -1, yMin: 260, yMax: 760, cx: midTrunks[880], offset: 0, wander: 8, speed: 9 });

  /* ================= LAYER 7 · floating spores ================= */
  const spores = addLayer('sc-sporelayer', 0.3);
  (function () {
    const count = isCompact() ? 14 : 34;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'sc-spore';
      p.style.left = n1(R(2, 98)) + '%';
      p.style.top = n1(R(12, 92)) + '%';
      p.style.setProperty('--s', n1(R(3, 7)) + 'px');
      p.style.setProperty('--dur', n1(R(9, 18)) + 's');
      p.style.setProperty('--delay', n1(-R(0, 18)) + 's');
      p.style.setProperty('--dx', n1(R(-40, 40)) + 'px');
      p.style.setProperty('--o', n1(R(0.45, 0.95)));
      spores.node.appendChild(p);
    }
  })();

  /* ================= LAYER 8 · blurred foreground leaves ================= */
  const front = addLayer('sc-front', 0.45);
  [
    { anchor: { fx: 0, fy: 1, dx: -50, dy: 90 }, spread: [8, 78], len: [300, 420], n: 5 },
    { anchor: { fx: 1, fy: 1, dx: 60, dy: 100 }, spread: [-80, -18], len: [260, 360], n: 4 },
    { anchor: { fx: 1, fy: 0, dx: 70, dy: -60 }, spread: [195, 258], len: [220, 320], n: 4 },
    { anchor: { fx: 0.02, fy: 0, dx: -60, dy: -70 }, spread: [115, 165], len: [170, 250], n: 3 },
  ].forEach((c) => {
    let s = '';
    for (let i = 0; i < c.n; i++) {
      const a = lerp(c.spread[0], c.spread[1], c.n === 1 ? 0.5 : i / (c.n - 1)) + R(-6, 6);
      const L = R(c.len[0], c.len[1]);
      s += leaf(0, 0, a, L, L * R(0.24, 0.3), pick(LEAF_FRONT), '#2e6b3e', R(-L * 0.1, L * 0.1));
    }
    const box = c.len[1] + 30;
    addSprite(front, { anchor: c.anchor, w: box * 2, h: box * 2, ox: box, oy: box, html: s, sway: { amp: R(0.8, 1.6), dur: R(6, 10) } });
  });

  /* ================= LAYER 9 · contrast veil (static) ================= */
  const veil = document.createElement('div');
  veil.className = 'sc-veil';
  scene.appendChild(veil);

  /* ---------- interaction & animation loop ---------- */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, px: 0, py: 0, seen: false, last: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    pointer.px = e.clientX; pointer.py = e.clientY;
    pointer.seen = true; pointer.last = performance.now();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.seen = false; });

  window.addEventListener('resize', layout);
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(scene);

  layout();
  requestAnimationFrame(() => scene.classList.add('is-ready'));

  if (reduceMotion) return; // static, still beautiful

  function moveLayers(dt, now) {
    const idle = now - pointer.last > 4000;
    const tx = idle ? Math.sin(now / 5200) * 0.35 : pointer.tx; // gentle drift keeps touch screens alive
    const ty = idle ? Math.sin(now / 7300) * 0.2 : pointer.ty;
    const ease = Math.min(1, dt * 2.4);
    pointer.x += (tx - pointer.x) * ease;
    pointer.y += (ty - pointer.y) * ease;
    const scroll = Math.min(window.scrollY, scene.clientHeight * 1.2);
    for (const layer of layers) {
      const x = -pointer.x * layer.depth * 70;
      const y = -pointer.y * layer.depth * 36 - scroll * layer.depth * 0.26;
      if (Math.abs(x - layer.tx) > 0.05 || Math.abs(y - layer.ty) > 0.05) {
        layer.tx = x; layer.ty = y;
        layer.node.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      }
    }
  }

  // Another script (the sphere hero) may mark the page as "backdrop": the forest is
  // then hidden behind content, so it stops moving entirely to save battery.
  const docEl = document.documentElement;
  let paused = false;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const shouldPause = docEl.classList.contains('is-backdrop') || docEl.classList.contains('is-locked');
    if (shouldPause !== paused) {
      paused = shouldPause;
      scene.classList.toggle('is-paused', paused);
    }
    if (!paused) {
      moveLayers(dt, now);
      for (const b of beetles) b.update(dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
