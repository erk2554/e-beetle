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
  // Every plate rides its own ring around the sphere's axis and follows a turn by closing
  // a fixed share of the remaining gap each second (an exponential ease-out): about
  // FOLLOW_FASTEST for the ring nearest the middle, falling off to e^-FOLLOW_SPREAD of
  // that at the poles, so the outer rings trail behind and settle last.
  const FOLLOW_FASTEST = 10;
  const FOLLOW_SPREAD = 2.3;
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

  // The first plate of a product shows the shop's own photo of it; every other plate
  // (a product without one, or a product coming round again when the shop lists few)
  // borrows, in turn, a beetle photo from js/gallery.js, so the sphere never fills up
  // with one picture. Without either it falls back to the illustration.
  const gallery = Array.isArray(window.EB_GALLERY) ? window.EB_GALLERY : [];
  const shopPhotoShown = new Set();
  let galleryNext = 0;

  function cardMarkup(product) {
    const own = product.images && product.images[0];
    const shopPhoto = own && !shopPhotoShown.has(product.id) ? own : null;
    if (shopPhoto) shopPhotoShown.add(product.id);
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
      // Heights are spread evenly and stop short of the poles: every plate has a ring of its own.
      const y = (1 - (2 * (i + 0.5)) / count) * 0.96;
      const radius = Math.sqrt(1 - y * y);
      const theta = i * golden;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const el = document.createElement('div');
      el.className = 'st-card';
      el.dataset.id = product.id;
      el.innerHTML = cardMarkup(product);
      const img = el.querySelector('img.st-photo');
      if (img) photos.push(img);
      cards.push({
        el, img, product, x, y, z, radius,
        lat: Math.asin(y) * DEG,
        lon: Math.atan2(x, z) * DEG,
        rate: Infinity, // how fast it follows a turn, set below
        phi: cam.spin + cam.dragX, // the turn this plate has reached so far
        lag: 0, // phi minus the sphere's turn: how far behind it is on its ring
        drawn: NaN, // the lag its transform was last written for
        moved: false,
        d: -1,
        o: -1,
      });
      fragment.appendChild(el);
    }
    if (!reduceMotion) {
      [...cards]
        .sort((a, b) => Math.abs(a.y) - Math.abs(b.y))
        .forEach((c, order) => (c.rate = FOLLOW_FASTEST * Math.exp(-FOLLOW_SPREAD * (order / (cards.length - 1)))));
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
  // passes behind the plates it joins and only shows in the gaps between them. When the
  // plates drift apart on their rings the strip is laid again and its strands stretch.
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
    // No aspect lock: the strands stretch with the strip while its plates are apart.
    return `<svg viewBox="0 0 ${width} ${FIBER_BAND}" preserveAspectRatio="none" aria-hidden="true">${paths}${spark}</svg>`;
  }

  function buildFibers() {
    const fragment = document.createDocumentFragment();
    fiberLinks().forEach(([i, j], index) => {
      const a = cards[i];
      const b = cards[j];
      const length = Math.max(0.12, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - FIBER_TRIM * 2);
      const random = seededRandom(i * 97 + j + 1);
      const el = document.createElement('div');
      el.className = 'st-fiber';
      el.style.setProperty('--v', String(index));
      el.style.setProperty('--spark', `${(2.6 + random() * 2.8).toFixed(2)}s`);
      el.style.setProperty('--wait', `${(-random() * 5).toFixed(2)}s`);
      el.innerHTML = fiberMarkup(length, random, !reduceMotion && index % FIBER_PULSE_EVERY === 0);
      // x, y, z and reach are the strip's centre, filled in by placeFiber().
      fibers.push({ el, a, b, x: 0, y: 0, z: 0, reach: 1, o: -1 });
      fragment.appendChild(el);
    });
    orb.appendChild(fragment);
  }

  /* ============================================================ placement */

  /** Where a plate is now, in the sphere's own frame: unit length, CSS y pointing down. */
  function spot(c) {
    const angle = (c.lon + c.lag) * RAD;
    return [Math.sin(angle) * c.radius, -c.y, Math.cos(angle) * c.radius];
  }

  function placeCard(c) {
    const [x, y, z] = spot(c);
    c.el.style.transform =
      `translate3d(${(x * R).toFixed(1)}px,${(y * R).toFixed(1)}px,${(z * R).toFixed(1)}px) ` +
      `rotateY(${(c.lon + c.lag).toFixed(2)}deg) rotateX(${c.lat.toFixed(2)}deg)`;
    c.drawn = c.lag;
  }

  /** Lays a fiber along the chord between its two plates, wherever they are now. */
  function placeFiber(f) {
    const a = spot(f.a);
    const b = spot(f.b);
    // x runs along the chord, z faces out of the sphere.
    const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const chord = Math.hypot(...along) || 1e-6;
    const reach = Math.hypot(...centre) || 1e-6;
    const d = along.map((v) => v / chord);
    const n = centre.map((v) => v / reach);
    const w = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
    const width = Math.max(0.12, chord - FIBER_TRIM * 2) * R;
    const band = (FIBER_BAND / FIBER_UNITS) * R;
    const depth = R * FIBER_DEPTH;
    f.el.style.width = `${width.toFixed(1)}px`;
    f.el.style.height = `${band.toFixed(1)}px`;
    f.el.style.margin = `${(-band / 2).toFixed(1)}px 0 0 ${(-width / 2).toFixed(1)}px`;
    f.el.style.transform =
      `matrix3d(${[...d, 0, ...w, 0, ...n, 0].map((v) => v.toFixed(4)).join(',')},` +
      `${(centre[0] * depth).toFixed(1)},${(centre[1] * depth).toFixed(1)},${(centre[2] * depth).toFixed(1)},1)`;
    f.x = centre[0];
    f.y = centre[1];
    f.z = centre[2];
    f.reach = reach;
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
    cards.forEach(placeCard);
    fibers.forEach(placeFiber);
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
    // The sphere turns about its own axis first and is tilted after, so a turn carries
    // every plate along its ring. The headline undoes both to stay square to the camera.
    world.style.transform = `translateZ(${cam.z.toFixed(2)}px) rotateX(${sx.toFixed(3)}deg) rotateY(${sy.toFixed(3)}deg)`;
    headline.style.transform = `rotateY(${(-sy).toFixed(3)}deg) rotateX(${(-sx).toFixed(3)}deg) translateZ(${(R * 0.62).toFixed(1)}px)`;
    headline.style.opacity = String(Math.max(0, 1 - p * 1.25).toFixed(3));

    if (scene) {
      const s = 1 + smooth(p) * 0.14;
      if (Math.abs(s - lastSceneScale) > 0.0005) {
        lastSceneScale = s;
        scene.style.transform = `scale(${s.toFixed(4)})`;
      }
    }

    const cy = Math.cos(sy * RAD);
    const syn = Math.sin(sy * RAD);
    const cx = Math.cos(sx * RAD);
    const sxn = Math.sin(sx * RAD);
    const shade = 1 - Math.min(1, p * 1.6);
    const near = persp * 0.66;
    for (const c of cards) {
      // Follow the turn along its own ring; the transform is rewritten only while the
      // plate is still catching up (at a steady spin its lag settles and nothing moves).
      c.phi += (sy - c.phi) * (1 - Math.exp(-c.rate * dt));
      c.lag = c.phi - sy;
      c.moved = !(Math.abs(c.lag - c.drawn) <= 0.02);
      if (c.moved) placeCard(c);

      // Depth shading: where the plate ends up after the turn and the tilt, read its z.
      const turned = (c.lon + c.lag + sy) * RAD;
      const zf = -c.y * sxn + Math.cos(turned) * c.radius * cx;
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
      if (f.a.moved || f.b.moved) placeFiber(f);
      const zf = f.y * sxn + (-f.x * syn + f.z * cy) * cx;
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
