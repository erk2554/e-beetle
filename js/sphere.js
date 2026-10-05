/* E Beetle · beetle sphere hero.
 *
 * A Fibonacci sphere of beetle "specimen plates" floats in the dark forest (#scene).
 * Drag to spin it, scroll to dolly in; once the product grid scrolls up, the sphere
 * settles into a softly blurred backdrop. Every plate is a product from the catalog
 * (photo when the shop uploaded one, otherwise the illustration) and opens the product
 * dialog via window.EBShop. Also runs the splash screen and the custom cursor.
 */
(function () {
  'use strict';

  const stage = document.getElementById('stage');
  if (!stage) return;

  const root = document.documentElement;
  const scene = document.getElementById('scene');
  const splash = document.getElementById('splash');
  const splashBar = document.getElementById('splashBar');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- tuning ---------- */
  const ZOOM_SPAN = 0.7; // viewport heights of scrolling that drive the dolly (matches .hero height)
  const BACKDROP_AT = 0.82; // after this many viewport heights the sphere becomes a blurred backdrop
  const PITCH_LIMIT = 32;
  const DRAG_DEG_PER_PX = 0.13;
  const AUTO_SPIN = reduceMotion ? 0 : 3.2; // degrees per second while idle
  const MIN_CARDS = 21;
  const MAX_CARDS = 36;
  const HEADLINE = 'I See Through the Wild';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

  root.classList.add('has-sphere');

  /* ================================================================ splash */

  const SPLASH_KEY = 'eb-splash-seen';
  let seenBefore = false;
  try {
    seenBefore = sessionStorage.getItem(SPLASH_KEY) === '1';
  } catch (_) {
    /* storage blocked: show the full splash */
  }
  const splashStart = performance.now();
  const splashMin = reduceMotion || seenBefore ? 250 : 1100;
  const progress = { done: 0, total: 2 }; // catalog + fonts, plus one per photo
  let revealed = false;

  if (splash) root.classList.add('is-splash');

  function bumpProgress(n = 1) {
    progress.done = Math.min(progress.total, progress.done + n);
    if (splashBar) splashBar.style.transform = `scaleX(${(progress.done / progress.total).toFixed(3)})`;
    if (progress.done >= progress.total) reveal();
  }

  function reveal() {
    if (revealed) return;
    const wait = splashMin - (performance.now() - splashStart);
    if (wait > 0) {
      setTimeout(reveal, wait);
      return;
    }
    revealed = true;
    try {
      sessionStorage.setItem(SPLASH_KEY, '1');
    } catch (_) {
      /* ignore */
    }
    layout();
    root.classList.remove('is-splash');
    root.classList.add('is-revealed');
    if (splash) {
      if (splashBar) splashBar.style.transform = 'scaleX(1)';
      splash.classList.add('is-out');
      setTimeout(() => splash.remove(), 900);
    }
  }
  setTimeout(() => {
    progress.done = progress.total;
    reveal();
  }, 6000); // never hold the page hostage

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => bumpProgress(), () => bumpProgress());
  } else {
    bumpProgress();
  }

  /* ================================================================== DOM */

  // The headline is a sibling of the orb on the same 0×0 point, so it sits in the middle
  // of the photo circle and nearer plates can cross in front of it. Each word animates in.
  stage.innerHTML =
    '<div class="st-world"><div class="st-orb"></div>' +
    '<div class="st-headline" aria-hidden="true"><div class="st-inner">' +
    HEADLINE.split(' ').map((word) => `<span class="st-word">${esc(word)}</span>`).join(' ') +
    '</div></div>' +
    '</div><div class="st-vig"></div>';
  const world = stage.querySelector('.st-world');
  const orb = stage.querySelector('.st-orb');
  const headline = stage.querySelector('.st-headline');
  headline.querySelectorAll('.st-word').forEach((word, i) => word.style.setProperty('--i', String(i)));

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML =
    '<div class="hud-intro" aria-hidden="true">' +
    '<div class="hud-who"><img src="assets/logo-badge-96.png" width="48" height="48" alt=""><span><b class="hud-name">E Beetle</b><small class="hud-tag"></small></span></div>' +
    '<p class="hud-text"></p></div>' +
    `<div class="hud-cue" aria-hidden="true"><s></s><span>${coarse ? 'ปัดเพื่อหมุน · เลื่อนลงเพื่อซูม' : 'ลากเพื่อหมุน · เลื่อนลงเพื่อซูม'}</span></div>` +
    '<a class="hud-more" href="#shop"><span>ดูสินค้าทั้งหมด</span><svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg></a>';
  stage.insertAdjacentElement('afterend', hud);

  function applySite(site) {
    if (!site) return;
    hud.querySelector('.hud-name').textContent = site.shopName || 'E Beetle';
    hud.querySelector('.hud-tag').textContent = site.tagline || '';
    hud.querySelector('.hud-text').textContent = site.heroText || '';
  }

  /* ================================================================ cards */

  const cards = [];
  let R = 300;
  let persp = 1150;

  /** Living beetles first so the sphere reads as "many kinds of beetles". */
  function orderForSphere(products) {
    const rank = { rhino: 0, stag: 0, larva: 1, supply: 2 };
    return products
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (rank[a.p.category] ?? 3) - (rank[b.p.category] ?? 3) || a.i - b.i)
      .map((entry) => entry.p);
  }

  function artMarkup(product) {
    const Art = window.EBArt;
    return Art ? Art.forProduct(product, { size: 'lg' }) : '';
  }

  // A plate shows the shop's own photo of its product; the others borrow, in turn, a
  // beetle photo from js/gallery.js. Without either it falls back to the illustration.
  const gallery = Array.isArray(window.EB_GALLERY) ? window.EB_GALLERY : [];
  let galleryNext = 0;

  function cardMarkup(product) {
    const shopPhoto = product.images && product.images[0];
    const borrowed = !shopPhoto && gallery.length ? gallery[galleryNext++ % gallery.length] : null;
    const photo = shopPhoto || borrowed;
    const media = photo
      ? `<img class="st-photo" alt="" draggable="false" decoding="async" data-src="${esc(photo.src)}">`
      : `<span class="st-art">${artMarkup(product)}</span>`;
    // Plain plates like a photo archive: the name shows in the product dialog.
    return `<figure class="st-fig" title="${esc(product.name)}">${media}</figure>`;
  }

  /** Most gallery licences ask for the author and the licence to be named: a folded list in the footer. */
  function buildCredits() {
    const footer = document.querySelector('.site-footer .footer-inner');
    if (!footer || !gallery.length) return;
    const items = gallery
      .map((photo) => {
        const license = photo.licenseUrl
          ? `<a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer license">${esc(photo.license)}</a>`
          : esc(photo.license);
        return (
          `<li><a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer">${esc(photo.name)} <i>${esc(photo.sci)}</i></a>` +
          ` · ${esc(photo.author)} · ${license}</li>`
        );
      })
      .join('');
    const credits = document.createElement('details');
    credits.className = 'credits';
    credits.innerHTML =
      '<summary>เครดิตภาพด้วงบนหน้าแรก</summary>' +
      '<p>ภาพจาก Wikimedia Commons ย่อขนาดและครอบตัดให้พอดีกรอบ ใช้ตามสัญญาอนุญาตของแต่ละภาพ</p>' +
      `<ul>${items}</ul>`;
    footer.appendChild(credits);
  }

  /** Decodes a photo once and, when it is large, downsizes it for the small sphere plate. */
  function loadPhoto(img, maxWidth) {
    const src = img.dataset.src;
    const probe = new Image();
    probe.decoding = 'async';
    const done = () => bumpProgress();
    probe.onload = () => {
      let url = src;
      try {
        if (probe.naturalWidth > maxWidth) {
          const canvas = document.createElement('canvas');
          canvas.width = maxWidth;
          canvas.height = Math.round((probe.naturalHeight / probe.naturalWidth) * maxWidth);
          canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            img.src = blob ? URL.createObjectURL(blob) : src;
            img.classList.add('is-in');
            done();
          }, 'image/webp', 0.88);
          return;
        }
      } catch (_) {
        url = src;
      }
      img.src = url;
      img.classList.add('is-in');
      done();
    };
    probe.onerror = () => {
      // Broken photo: fall back to the illustration.
      const product = cards.find((c) => c.img === img);
      if (product) img.replaceWith(Object.assign(document.createElement('span'), { className: 'st-art', innerHTML: artMarkup(product.product) }));
      done();
    };
    probe.src = src;
  }

  function build(products) {
    const list = orderForSphere(products);
    if (!list.length) {
      root.classList.add('no-sphere');
      return;
    }
    const count = clamp(Math.max(MIN_CARDS, list.length), MIN_CARDS, MAX_CARDS);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const photos = [];
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const product = list[i % list.length];
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * golden;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const el = document.createElement('div');
      el.className = 'st-card';
      el.dataset.id = product.id;
      el.innerHTML = cardMarkup(product);
      const img = el.querySelector('img.st-photo');
      if (img) photos.push(img);
      cards.push({ el, img, product, x, y, z, lat: Math.asin(y) * DEG, lon: Math.atan2(x, z) * DEG, d: -1, o: -1 });
      fragment.appendChild(el);
    }
    buildFibers();
    orb.appendChild(fragment);
    layout(true);

    const vw = window.innerWidth;
    const maxWidth = vw <= 380 ? 420 : vw <= 640 ? 520 : vw <= 900 ? 640 : 760;
    progress.total += photos.length;
    photos.forEach((img) => loadPhoto(img, maxWidth));
  }

  /* =============================================================== fibers */

  // Threads of green light run from plate to plate. Each link is a flat strip along the
  // chord between two plates, facing outward and sitting just inside the sphere, so it
  // passes behind the plates it joins and only shows in the gaps between them.
  const FIBER_DEPTH = 0.97; // of R: how far out the strips sit
  const FIBER_TRIM = 0.1; // of R, cut from each end: a stretch that always lies under a plate
  const FIBER_UNITS = 1000; // SVG units per R, so every fiber is drawn at the same scale
  const FIBER_BAND = 140; // SVG height of a strip
  const FIBER_PULSE_EVERY = 3; // one link in three carries a travelling spark (repaints are not free)
  const fibers = [];

  /** Seeded random numbers, so every fiber keeps its shape between visits. */
  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** One web that reaches every plate: a spanning tree plus each plate's three nearest neighbours. */
  function fiberLinks() {
    const count = cards.length;
    const gap = (a, b) => 1 - (cards[a].x * cards[b].x + cards[a].y * cards[b].y + cards[a].z * cards[b].z);
    const links = new Map();
    const link = (a, b) => links.set(a < b ? a * count + b : b * count + a, a < b ? [a, b] : [b, a]);

    const joined = new Array(count).fill(false);
    const nearest = new Array(count).fill(Infinity);
    const via = new Array(count).fill(-1);
    nearest[0] = 0;
    for (let step = 0; step < count; step++) {
      let next = -1;
      for (let i = 0; i < count; i++) {
        if (!joined[i] && (next < 0 || nearest[i] < nearest[next])) next = i;
      }
      joined[next] = true;
      if (via[next] >= 0) link(next, via[next]);
      for (let i = 0; i < count; i++) {
        if (!joined[i] && gap(next, i) < nearest[i]) {
          nearest[i] = gap(next, i);
          via[i] = next;
        }
      }
    }

    for (let a = 0; a < count; a++) {
      const others = cards.map((_, b) => b).filter((b) => b !== a).sort((p, q) => gap(a, p) - gap(a, q));
      others.slice(0, 3).forEach((b) => link(a, b));
    }
    return Array.from(links.values());
  }

  /** Two or three thin strands that leave one end together, drift apart and meet again. */
  function fiberMarkup(length, random, pulsing) {
    const width = Math.round(length * FIBER_UNITS);
    const mid = FIBER_BAND / 2;
    const strands = random() < 0.45 ? 3 : 2;
    let paths = '';
    let spark = '';
    for (let s = 0; s < strands; s++) {
      const out = (random() * 2 - 1) * 34;
      const back = (random() * 2 - 1) * 34;
      const d = `M0 ${mid}C${(width * 0.3).toFixed(1)} ${(mid + out).toFixed(1)} ${(width * 0.7).toFixed(1)} ${(mid + back).toFixed(1)} ${width} ${mid}`;
      paths +=
        `<path class="st-fiber-halo" pathLength="1" d="${d}"/>` +
        `<path class="st-fiber-glow" pathLength="1" d="${d}"/>` +
        `<path class="st-fiber-core" pathLength="1" d="${d}"/>`;
      if (pulsing && s === 0) spark = `<path class="st-fiber-spark" pathLength="1" d="${d}"/>`;
    }
    return `<svg viewBox="0 0 ${width} ${FIBER_BAND}" aria-hidden="true">${paths}${spark}</svg>`;
  }

  function buildFibers() {
    const fragment = document.createDocumentFragment();
    fiberLinks().forEach(([i, j], index) => {
      const a = cards[i];
      const b = cards[j];
      // CSS space (y points down): x runs along the chord, z faces out of the sphere.
      const along = [b.x - a.x, a.y - b.y, b.z - a.z];
      const centre = [(a.x + b.x) / 2, -(a.y + b.y) / 2, (a.z + b.z) / 2];
      const chord = Math.hypot(...along);
      const reach = Math.hypot(...centre);
      const d = along.map((v) => v / chord);
      const n = centre.map((v) => v / reach);
      const w = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
      const length = Math.max(0.12, chord - FIBER_TRIM * 2);
      const random = seededRandom(i * 97 + j + 1);
      const el = document.createElement('div');
      el.className = 'st-fiber';
      el.style.setProperty('--v', String(index));
      el.style.setProperty('--spark', `${(2.6 + random() * 2.8).toFixed(2)}s`);
      el.style.setProperty('--wait', `${(-random() * 5).toFixed(2)}s`);
      el.innerHTML = fiberMarkup(length, random, !reduceMotion && index % FIBER_PULSE_EVERY === 0);
      fibers.push({
        el,
        length,
        reach,
        basis: [...d, 0, ...w, 0, ...n, 0].map((v) => v.toFixed(4)).join(','),
        x: centre[0],
        y: centre[1],
        z: centre[2],
        o: -1,
      });
      fragment.appendChild(el);
    });
    orb.appendChild(fragment);
  }

  /* =============================================================== layout */

  let lastW = 0;
  let lastH = 0;

  function layout(force = false) {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    // Ignore the small jumps of a mobile URL bar.
    if (!force && Math.abs(w - lastW) < 20 && Math.abs(h - lastH) < 20) return;
    lastW = w;
    lastH = h;
    const hr = w <= 380 ? 0.38 : w <= 640 ? 0.42 : 0.46;
    const wr = w <= 380 ? 0.48 : w <= 640 ? 0.52 : 0.58;
    const floor = w <= 380 ? 108 : w <= 640 ? 120 : 155;
    R = Math.max(floor, Math.min(480, h * hr, w * wr));
    const density = Math.sqrt(MIN_CARDS / Math.max(MIN_CARDS, cards.length));
    const scale = (w <= 380 ? 0.44 : w <= 640 ? 0.46 : 0.47) * density;
    const cw = Math.round(Math.max(72, R * scale));
    persp = w <= 380 ? 620 : w <= 640 ? 760 : w <= 900 ? 920 : 1150;
    stage.style.setProperty('--persp', `${persp}px`);
    stage.style.setProperty('--cw', `${cw}px`);
    stage.style.setProperty('--ch', `${Math.round(cw / 1.5)}px`);
    stage.classList.toggle('is-small', cw < 112);
    for (const c of cards) {
      c.el.style.transform =
        `translate3d(${(c.x * R).toFixed(1)}px,${(-c.y * R).toFixed(1)}px,${(c.z * R).toFixed(1)}px) ` +
        `rotateY(${c.lon.toFixed(2)}deg) rotateX(${c.lat.toFixed(2)}deg)`;
    }
    const band = (FIBER_BAND / FIBER_UNITS) * R;
    const depth = R * FIBER_DEPTH;
    for (const f of fibers) {
      const width = f.length * R;
      f.el.style.width = `${width.toFixed(1)}px`;
      f.el.style.height = `${band.toFixed(1)}px`;
      f.el.style.margin = `${(-band / 2).toFixed(1)}px 0 0 ${(-width / 2).toFixed(1)}px`;
      f.el.style.transform = `matrix3d(${f.basis},${(f.x * depth).toFixed(1)},${(f.y * depth).toFixed(1)},${(f.z * depth).toFixed(1)},1)`;
    }
  }

  window.addEventListener('resize', () => layout());
  window.addEventListener('orientationchange', () => setTimeout(() => layout(true), 220));

  /* =============================================================== camera */

  const cam = { spin: -18, tilt: -4, dragX: 0, dragY: 0, velX: 0, velY: 0, z: 0, auto: 1 };
  let dragging = false;
  let hovering = false;
  let backdrop = false;
  let zoomed = false;

  function updateMode(scrollY, vh) {
    const nextBackdrop = scrollY > vh * BACKDROP_AT;
    if (nextBackdrop !== backdrop) {
      backdrop = nextBackdrop;
      root.classList.toggle('is-backdrop', backdrop);
    }
    const nextZoomed = scrollY > vh * 0.12;
    if (nextZoomed !== zoomed) {
      zoomed = nextZoomed;
      root.classList.toggle('is-zoomed', zoomed);
    }
  }

  let lastTime = performance.now();
  let lastSceneScale = 1;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const locked = root.classList.contains('is-locked'); // product dialog open: hold still

    const vh = stage.clientHeight || window.innerHeight;
    const scrollY = window.scrollY;
    updateMode(scrollY, vh);
    // As a blurred backdrop (or behind the dialog) the sphere stays still: a static
    // blurred layer costs nothing, an animated one is re-blurred every frame.
    if ((backdrop || locked) && cards.length) {
      requestAnimationFrame(frame);
      return;
    }
    const p = reduceMotion ? 0 : clamp(scrollY / (vh * ZOOM_SPAN), 0, 1);

    if (!dragging && !locked) {
      cam.dragX += cam.velX;
      cam.dragY += cam.velY;
      cam.velX *= 0.94;
      cam.velY *= 0.94;
      if (Math.abs(cam.velX) < 0.002) cam.velX = 0;
      if (Math.abs(cam.velY) < 0.002) cam.velY = 0;
      const target = hovering ? 0 : backdrop ? 0.45 : 1;
      cam.auto += (target - cam.auto) * Math.min(1, dt * 2.5);
      cam.spin += AUTO_SPIN * cam.auto * dt;
    }
    cam.dragY = clamp(cam.dragY, -PITCH_LIMIT - cam.tilt, PITCH_LIMIT - cam.tilt);

    const zTarget = smooth(p) * R * 0.92;
    cam.z += (zTarget - cam.z) * Math.min(1, dt * 4.5);

    const sx = cam.tilt + cam.dragY;
    const sy = cam.spin + cam.dragX;
    world.style.transform = `translateZ(${cam.z.toFixed(2)}px) rotateY(${sy.toFixed(3)}deg) rotateX(${sx.toFixed(3)}deg)`;
    headline.style.transform = `rotateX(${(-sx).toFixed(3)}deg) rotateY(${(-sy).toFixed(3)}deg) translateZ(${(R * 0.62).toFixed(1)}px)`;
    headline.style.opacity = String(Math.max(0, 1 - p * 1.25).toFixed(3));

    if (scene) {
      const s = 1 + smooth(p) * 0.14;
      if (Math.abs(s - lastSceneScale) > 0.0005) {
        lastSceneScale = s;
        scene.style.transform = `scale(${s.toFixed(4)})`;
      }
    }

    // Depth shading: rotate every unit vector like the world and read its z.
    const cy = Math.cos(sy * RAD);
    const syn = Math.sin(sy * RAD);
    const cx = Math.cos(sx * RAD);
    const sxn = Math.sin(sx * RAD);
    const shade = 1 - Math.min(1, p * 1.6);
    const near = persp * 0.66;
    for (const c of cards) {
      const yc = -c.y; // CSS y points down
      const z1 = yc * sxn + c.z * cx; // rotateX
      const zf = -c.x * syn + z1 * cy; // rotateY
      const base = 0.14 + 0.86 * Math.pow((zf + 1) / 2, 0.85);
      // Coarse steps: fewer style changes per frame, invisible to the eye.
      const dim = Math.round(Math.min(0.92, shade * (1 - base)) * 25) / 25;
      const absZ = zf * R + cam.z;
      const fade = absZ > near ? Math.max(0, 1 - (absZ - near) / 190) : 1;
      const opacity = Math.round(fade * 50) / 50;
      if (dim !== c.d) {
        c.d = dim;
        c.el.style.setProperty('--d', String(dim));
      }
      if (opacity !== c.o) {
        c.o = opacity;
        c.el.style.opacity = String(opacity);
        c.el.style.visibility = opacity <= 0.01 ? 'hidden' : '';
      }
    }
    // Fibers have no dark wash to take: they fade with depth instead, and out entirely
    // at the rim of the sphere, where a flat strip is seen edge-on as a broken line.
    for (const f of fibers) {
      const zf = -f.x * syn + (f.y * sxn + f.z * cx) * cy;
      const base = 0.14 + 0.86 * Math.pow(Math.max(0, (zf + 1) / 2), 0.85);
      const absZ = zf * R + cam.z;
      const fade = absZ > near ? Math.max(0, 1 - (absZ - near) / 190) : 1;
      const rim = (f.reach * R * FIBER_DEPTH) / Math.max(1, persp - cam.z); // facing at which it is edge-on
      const facing = clamp((Math.abs(zf / f.reach - rim) - 0.08) / 0.2, 0, 1);
      const opacity = Math.round(fade * facing * (1 - shade * (1 - base)) * 25) / 25;
      if (opacity !== f.o) {
        f.o = opacity;
        f.el.style.opacity = String(opacity);
        f.el.style.visibility = opacity <= 0.01 ? 'hidden' : '';
      }
    }
    requestAnimationFrame(frame);
  }

  /* ========================================================= interaction */

  let down = null;

  stage.addEventListener('pointerdown', (event) => {
    if (backdrop || event.button > 0 || root.classList.contains('is-locked')) return;
    const card = event.target.closest('.st-card');
    down = { id: event.pointerId, x: event.clientX, y: event.clientY, lx: event.clientX, ly: event.clientY, card, moved: false, captured: false };
    cam.velX = 0;
    cam.velY = 0;
    if (event.pointerType !== 'touch') {
      stage.setPointerCapture(event.pointerId);
      down.captured = true;
      dragging = true;
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!down || event.pointerId !== down.id) return;
    const totalX = event.clientX - down.x;
    const totalY = event.clientY - down.y;
    if (!down.captured) {
      // Touch: wait until the gesture is clearly sideways; vertical swipes scroll the page.
      if (Math.hypot(totalX, totalY) < 10) return;
      if (Math.abs(totalY) > Math.abs(totalX) * 1.15) {
        down = null;
        return;
      }
      try {
        stage.setPointerCapture(event.pointerId);
      } catch (_) {
        /* pointer already gone */
      }
      down.captured = true;
      dragging = true;
    }
    if (Math.hypot(totalX, totalY) > (coarse ? 14 : 6)) down.moved = true;
    const dx = event.clientX - down.lx;
    const dy = event.clientY - down.ly;
    down.lx = event.clientX;
    down.ly = event.clientY;
    cam.dragX += dx * DRAG_DEG_PER_PX;
    cam.dragY -= dy * DRAG_DEG_PER_PX;
    cam.velX = dx * DRAG_DEG_PER_PX;
    cam.velY = -dy * DRAG_DEG_PER_PX;
  });

  function endPointer(event) {
    if (!down || event.pointerId !== down.id) return;
    const { card, moved, captured } = down;
    down = null;
    dragging = false;
    if (captured) {
      try {
        stage.releasePointerCapture(event.pointerId);
      } catch (_) {
        /* already released */
      }
    }
    if (event.type === 'pointerup' && !moved && card) openCard(card);
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function openCard(card) {
    const id = card.dataset.id;
    if (window.EBShop && typeof window.EBShop.open === 'function') window.EBShop.open(id);
    else window.location.hash = `#product/${id}`;
  }

  if (finePointer) {
    stage.addEventListener('pointerover', (event) => {
      if (event.target.closest('.st-card')) hovering = true;
    });
    stage.addEventListener('pointerout', (event) => {
      if (event.target.closest('.st-card') && !(event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.st-card'))) hovering = false;
    });
  }

  /* ======================================================== custom cursor */

  if (finePointer && !reduceMotion) {
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    dot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dot);
    const pos = { x: -100, y: -100, tx: -100, ty: -100, seen: false };
    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      pos.tx = event.clientX;
      pos.ty = event.clientY;
      if (!pos.seen) {
        pos.seen = true;
        pos.x = pos.tx;
        pos.y = pos.ty;
        dot.classList.add('is-on');
      }
      const target = event.target instanceof Element ? event.target : null;
      dot.classList.toggle('is-wide', Boolean(target && target.closest('.st-card, a, button, .card, select, label.chip')));
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      pos.seen = false;
      dot.classList.remove('is-on');
    });
    const follow = () => {
      pos.x += (pos.tx - pos.x) * 0.2;
      pos.y += (pos.ty - pos.y) * 0.2;
      dot.style.transform = `translate3d(${pos.x.toFixed(1)}px,${pos.y.toFixed(1)}px,0)`;
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }

  /* ================================================================ boot */

  function onCatalog(catalog) {
    root.classList.remove('no-sphere');
    applySite(catalog.site);
    build(catalog.products);
    bumpProgress();
  }

  if (window.EBShopCatalog) onCatalog(window.EBShopCatalog);
  else document.addEventListener('eb:catalog', (event) => onCatalog(event.detail), { once: true });
  document.addEventListener('eb:catalog-error', () => {
    root.classList.add('no-sphere');
    progress.done = progress.total;
    reveal();
  }, { once: true });

  buildCredits();
  layout(true);
  requestAnimationFrame((now) => {
    lastTime = now;
    frame(now);
  });
})();
