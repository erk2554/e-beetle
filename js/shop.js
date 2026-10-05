/*
 * E Beetle — storefront.
 *
 * Renders the catalog loaded by js/catalog.js: shop texts and Facebook links,
 * search / category filter / sorting, product cards, the product detail dialog
 * (gallery, page box, copy link), #product/<id> deep links and toasts.
 *
 * Ordering happens on the shop's Facebook page, so there is no cart.
 * All catalog data is escaped before it reaches innerHTML, and Facebook links
 * are only ever set (via the DOM) from validated URLs.
 */
(function () {
  "use strict";

  /* =============================================================== helpers */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const NEW_TAB_HINT = '<span class="sr-only"> (เปิดในแท็บใหม่)</span>';

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scrollBehavior = () => (motionQuery.matches ? "auto" : "smooth");
  const priceFormat = new Intl.NumberFormat("th-TH");

  const PRODUCT_HASH = /^#product\/([a-z0-9][a-z0-9-]{0,39})$/;
  const BADGE_STYLES = { หายาก: "pill--gold", ใหม่: "pill--ink" };
  const SORTS = ["recommended", "price-asc", "price-desc"];
  const CLOSE_ANIMATION_MS = 200;
  const TOAST_MS = 2600;
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* ================================================================== DOM */

  const dom = {
    grid: $("#grid"),
    empty: $("#empty"),
    emptyTitle: $("#emptyTitle"),
    emptyText: $("#emptyText"),
    clearFilters: $("#clearFilters"),
    loadError: $("#loadError"),
    retry: $("#retryLoad"),
    resultCount: $("#resultCount"),
    searchForm: $("#searchForm"),
    query: $("#q"),
    sort: $("#sort"),
    chips: $("#chips"),
    heroTitle: $("#heroTitle"),
    stats: $("#stats"),
    toast: $("#toast"),
  };

  const Catalog = window.EBCatalog;
  if (!Catalog) {
    // catalog.js failed to load: show the error state with the static Facebook links.
    dom.grid.setAttribute("aria-busy", "false");
    dom.loadError.hidden = false;
    dom.retry.hidden = true;
    dom.resultCount.textContent = "ไม่สามารถโหลดรายการสินค้าได้";
    return;
  }
  const CATEGORY_LABELS = Catalog.CATEGORY_LABELS;
  const STATUS_LABELS = Catalog.STATUS_LABELS;
  const Art = window.EBArt || { forProduct: () => '<svg class="eb-art" viewBox="0 0 120 120" aria-hidden="true"></svg>' };

  /* ================================================================ state */

  const state = {
    site: Catalog.normalise({ products: [] }).site,
    products: [],
    byId: new Map(),
    searchIndex: new Map(),
    category: "all",
    sort: "recommended",
    query: "",
    loaded: false,
    introPending: true,
  };
  let baseTitle = document.title;

  /* ============================================================ site data */

  /** Points every [data-fb] link inside root at the shop's (validated) Facebook page. */
  function applyFacebookLinks(root = document) {
    const url = Catalog.safeFacebookUrl(state.site.facebookUrl);
    $$("a[data-fb]", root).forEach((link) => {
      link.href = url;
    });
  }

  /** Escapes the hero title, then turns *text* into a highlighted span. */
  const heroTitleHtml = (title) => esc(title).replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>');

  function applySite(site) {
    $$("[data-bind]").forEach((el) => {
      const value = site[el.dataset.bind];
      if (typeof value !== "string") return;
      el.textContent = value;
      if (el.hasAttribute("data-optional")) el.hidden = value === "";
    });
    dom.heroTitle.innerHTML = heroTitleHtml(site.heroTitle);

    dom.stats.innerHTML = site.stats
      .map((stat) => `<li class="stat"><b>${esc(stat.value)}</b><span>${esc(stat.label)}</span></li>`)
      .join("");
    dom.stats.hidden = site.stats.length === 0;

    applyFacebookLinks();

    baseTitle = `${site.shopName} — ร้านด้วงคุณภาพ`;
    if (!dialog.current) document.title = baseTitle;
  }

  /* =============================================================== search */

  const tokenize = (query) => query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);

  function buildSearchIndex(products) {
    state.searchIndex = new Map(
      products.map((p) => [
        p.id,
        [
          p.name,
          p.sci,
          p.summary,
          p.description,
          CATEGORY_LABELS[p.category],
          STATUS_LABELS[p.status],
          p.badge,
          ...p.specs.map((spec) => `${spec.label} ${spec.value}`),
        ]
          .join("\n")
          .toLowerCase(),
      ])
    );
  }

  const matchesQuery = (product, tokens) => {
    const haystack = state.searchIndex.get(product.id) || "";
    return tokens.every((token) => haystack.includes(token));
  };

  /**
   * Escapes text and wraps every match of the search tokens in <mark>.
   * Matches are found on the raw text first, so entities are never split.
   */
  function highlight(text, tokens) {
    if (!text) return "";
    if (!tokens.length) return esc(text);
    const ranges = [];
    tokens.forEach((token) => {
      const pattern = new RegExp(escapeRegExp(token), "gi");
      let match;
      while ((match = pattern.exec(text))) {
        if (!match[0]) break;
        ranges.push([match.index, match.index + match[0].length]);
      }
    });
    if (!ranges.length) return esc(text);

    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach(([start, end]) => {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    });

    let html = "";
    let cursor = 0;
    merged.forEach(([start, end]) => {
      html += esc(text.slice(cursor, start)) + "<mark>" + esc(text.slice(start, end)) + "</mark>";
      cursor = end;
    });
    return html + esc(text.slice(cursor));
  }

  /* ============================================================ rendering */

  /** Price markup: "฿1,200 / ตัว", or "สอบถามราคา" when the price is 0. */
  function priceHtml(product, className) {
    if (!product.price) return `<span class="${className} ${className}--ask">สอบถามราคา</span>`;
    return `<span class="${className}">฿${priceFormat.format(product.price)} <small>/ ${esc(product.unit)}</small></span>`;
  }

  const badgeHtml = (badge, extraClass = "") =>
    badge ? `<span class="pill ${BADGE_STYLES[badge] || "pill--green"}${extraClass}">${esc(badge)}</span>` : "";

  const ribbonHtml = (status) =>
    status === "available" ? "" : `<span class="ribbon ribbon--${status}">${STATUS_LABELS[status]}</span>`;

  function cardHtml(product, tokens, index, intro) {
    const cover = product.images[0];
    const media = cover
      ? `<img src="${esc(cover.src)}" alt="" loading="lazy" decoding="async" width="480" height="360">`
      : `<span class="card-art">${Art.forProduct(product, { size: "sm" })}</span>`;
    const photoCount =
      product.images.length > 1
        ? `<span class="card-photos">${icon("camera")}${product.images.length}<span class="sr-only"> รูป</span></span>`
        : "";
    const classes = "card" + (product.status === "soldout" ? " is-soldout" : "");
    const delay = intro ? ` style="--i:${Math.min(index, 11)}"` : "";

    return `<a class="${classes}" href="#product/${product.id}" data-id="${product.id}"${delay}>
      <span class="card-media">${media}${badgeHtml(product.badge, " card-badge")}${ribbonHtml(product.status)}${photoCount}</span>
      <span class="card-body">
        <span class="card-cat">${CATEGORY_LABELS[product.category]}</span>
        <h3 class="card-title">${highlight(product.name, tokens)}</h3>
        ${product.sci ? `<span class="card-sci">${highlight(product.sci, tokens)}</span>` : ""}
        ${product.summary ? `<span class="card-summary">${highlight(product.summary, tokens)}</span>` : ""}
        <span class="card-foot">
          ${priceHtml(product, "price")}
          <span class="card-more">ดูรายละเอียด ${icon("arrow")}</span>
        </span>
      </span>
    </a>`;
  }

  // "สอบถามราคา" items (price 0) always sink to the end of a price sort.
  const byPrice = (direction) => (a, b) => {
    if (!a.price !== !b.price) return a.price ? -1 : 1;
    return direction * (a.price - b.price);
  };

  function sortProducts(list) {
    if (state.sort === "price-asc") return list.slice().sort(byPrice(1));
    if (state.sort === "price-desc") return list.slice().sort(byPrice(-1));
    return list; // "recommended" = the order set in the admin
  }

  function updateChipCounts(matched) {
    const counts = { all: matched.length, rhino: 0, stag: 0, larva: 0, supply: 0 };
    matched.forEach((p) => {
      counts[p.category] += 1;
    });
    $$(".chip", dom.chips).forEach((chip) => {
      $(".chip-count", chip).textContent = state.loaded ? String(counts[chip.dataset.cat] ?? 0) : "";
    });
  }

  function resultText(count) {
    const query = state.query.trim();
    const label = CATEGORY_LABELS[state.category];
    if (query) return `พบ ${count} รายการสำหรับ “${query}”${label ? ` ในหมวด${label}` : ""}`;
    return label ? `${label} ${count} รายการ` : `ทั้งหมด ${count} รายการ`;
  }

  function updateEmptyState(count, searching) {
    dom.empty.hidden = count > 0;
    if (count > 0) return;
    let title = "ไม่พบสินค้าที่ค้นหา";
    let text = "ลองใช้คำอื่น เช่น “กว่าง” “คีม” หรือ “ตัวอ่อน” หรือเลือกหมวดหมู่อื่น";
    if (!state.products.length) {
      title = "ยังไม่มีสินค้าในขณะนี้";
      text = "ติดตามสินค้าใหม่และสอบถามได้ที่เพจ Facebook ของร้าน";
    } else if (!searching) {
      title = "ยังไม่มีสินค้าในหมวดนี้";
      text = "ลองเลือกหมวดอื่น หรือทักถามเพจได้เลย";
    }
    dom.emptyTitle.textContent = title;
    dom.emptyText.textContent = text;
    dom.clearFilters.hidden = !state.products.length;
    dom.clearFilters.textContent = searching ? "ล้างการค้นหา" : "ดูสินค้าทั้งหมด";
  }

  function render() {
    const tokens = tokenize(state.query);
    const matched = tokens.length ? state.products.filter((p) => matchesQuery(p, tokens)) : state.products;
    const inCategory = state.category === "all" ? matched : matched.filter((p) => p.category === state.category);
    const list = sortProducts(inCategory);

    // Cards rise in only on the first render; filtering should feel instant.
    const intro = state.introPending && !motionQuery.matches;
    state.introPending = false;
    dom.grid.classList.toggle("is-intro", intro);
    dom.grid.innerHTML = list.map((p, i) => cardHtml(p, tokens, i, intro)).join("");
    dom.grid.setAttribute("aria-busy", "false");

    updateChipCounts(matched);
    updateEmptyState(list.length, tokens.length > 0);
    dom.resultCount.textContent = resultText(list.length);
  }

  function renderSkeleton() {
    dom.grid.setAttribute("aria-busy", "true");
    dom.grid.innerHTML = Array.from(
      { length: 6 },
      () => `<div class="card card--skeleton" aria-hidden="true">
        <span class="card-media"></span>
        <span class="card-body"><span class="sk-line sk-line--short"></span><span class="sk-line sk-line--title"></span><span class="sk-line"></span><span class="sk-line sk-line--short"></span></span>
      </div>`
    ).join("");
  }

  function showLoadError() {
    dom.grid.innerHTML = "";
    dom.grid.setAttribute("aria-busy", "false");
    dom.empty.hidden = true;
    dom.loadError.hidden = false;
    dom.resultCount.textContent = "ไม่สามารถโหลดรายการสินค้าได้";
  }

  function setCategory(category) {
    state.category = category in CATEGORY_LABELS ? category : "all";
    $$(".chip", dom.chips).forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.cat === state.category));
    });
    render();
  }

  function scrollToShop() {
    $("#shop").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }

  /* ============================================================== toasts */

  let toastTimer = 0;

  function showToast(message) {
    // While the dialog animates out, wait so the message lands on the page toast.
    if (!dialog.current && dialog.closeTimer) {
      window.setTimeout(() => showToast(message), CLOSE_ANIMATION_MS + 20);
      return;
    }
    // A modal dialog sits in the top layer and makes the page inert, so use its own toast.
    const target = dialog.current ? dialog.toast : dom.toast;
    const other = target === dom.toast ? dialog.toast : dom.toast;
    other.classList.remove("is-visible");
    target.textContent = message;
    target.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => target.classList.remove("is-visible"), TOAST_MS);
  }

  /* ======================================================= product dialog */

  const dialog = {
    el: $("#productDialog"),
    content: $("#pdContent"),
    scroller: $("#pdScroll"),
    toast: $("#pdToast"),
    current: null, // the product on show (null while closed or closing)
    returnFocus: null, // the card that opened the dialog
    closeTimer: 0,
    selfClosing: false, // true while our own close() call is pending its "close" event
    gallery: { index: 0, count: 0, track: null, settleTimer: 0 },
  };
  const supportsDialog = typeof dialog.el.showModal === "function";

  /** Plain text to HTML: blank lines start paragraphs, single newlines become <br>. */
  function formatDescription(text) {
    return text
      .split(/\n[ \t]*\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${esc(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function galleryHtml(product) {
    const images = product.images;
    const ribbon = ribbonHtml(product.status);
    if (!images.length) {
      return `<div class="pd-stage pd-stage--art"><div class="pd-art">${Art.forProduct(product, { size: "lg" })}</div>${ribbon}</div>`;
    }
    const count = images.length;
    const slides = images
      .map(
        (image, i) => `<div class="pd-slide" role="group" aria-roledescription="สไลด์" aria-label="รูปที่ ${i + 1} จาก ${count}">
          <img src="${esc(image.src)}" alt="${esc(product.name)} รูปที่ ${i + 1}" decoding="async" draggable="false"${i > 1 ? ' loading="lazy"' : ""}>
        </div>`
      )
      .join("");
    if (count === 1) {
      return `<div class="pd-stage"><div class="pd-track">${slides}</div>${ribbon}</div>`;
    }
    const thumbs = images
      .map(
        (image, i) => `<button type="button" class="pd-thumb" data-action="thumb" data-index="${i}" aria-label="ดูรูปที่ ${i + 1} จาก ${count}">
          <img src="${esc(image.src)}" alt="" loading="lazy" decoding="async" draggable="false">
        </button>`
      )
      .join("");
    return `<div class="pd-stage">
        <div class="pd-track" tabindex="-1">${slides}</div>
        ${ribbon}
        <button type="button" class="pd-nav pd-nav--prev" data-action="prev" aria-label="รูปก่อนหน้า">${icon("chev-left")}</button>
        <button type="button" class="pd-nav pd-nav--next" data-action="next" aria-label="รูปถัดไป">${icon("chev-right")}</button>
        <span class="pd-counter" aria-hidden="true">1 / ${count}</span>
      </div>
      <div class="pd-thumbs" role="group" aria-label="เลือกรูปสินค้า">${thumbs}</div>`;
  }

  function pageBoxHtml(product) {
    const site = state.site;
    const statusNote = {
      reserved: "สินค้าชิ้นนี้ติดจองอยู่ ทักเพจเพื่อต่อคิวหรือสอบถามตัวอื่นได้",
      soldout: "สินค้าชิ้นนี้ขายแล้ว ทักเพจเพื่อสอบถามตัวใหม่ที่ใกล้เคียงได้เลย",
    }[product.status];
    return `<aside class="page-box" aria-label="สั่งซื้อผ่านเพจ Facebook">
      <div class="page-box-head">
        <img class="page-box-logo" src="assets/logo-badge-192.png" width="56" height="56" alt="">
        <div class="page-box-id">
          <span class="page-box-kicker"><svg class="icon icon-fb" aria-hidden="true"><use href="#i-fb"></use></svg>เพจ Facebook</span>
          <a class="page-box-name" data-fb target="_blank" rel="noopener noreferrer">${esc(site.facebookName)}${NEW_TAB_HINT}</a>
        </div>
      </div>
      ${site.contactNote ? `<p class="page-box-note">${esc(site.contactNote)}</p>` : ""}
      ${statusNote ? `<p class="page-box-status">${statusNote}</p>` : ""}
      <a class="btn btn-primary btn-lg btn-block" data-fb target="_blank" rel="noopener noreferrer">
        ${icon("fb")}<span>สั่งซื้อ / สอบถามทางเพจ Facebook</span>${NEW_TAB_HINT}
      </a>
      <button type="button" class="copy-btn" data-action="copy">${icon("link")}<span>คัดลอกลิงก์สินค้านี้</span></button>
      <input class="copy-field" type="text" readonly hidden aria-label="ลิงก์สินค้านี้">
    </aside>`;
  }

  function detailHtml(product) {
    const specs = product.specs
      .map((spec) => `<div class="pd-spec"><dt>${esc(spec.label)}</dt><dd>${esc(spec.value)}</dd></div>`)
      .join("");
    return `<div class="pd-media">${galleryHtml(product)}</div>
      <div class="pd-info">
        <div class="pd-pills">
          <span class="pill pill--cat">${CATEGORY_LABELS[product.category]}</span>
          <span class="pill pill--${product.status}">${STATUS_LABELS[product.status]}</span>
          ${badgeHtml(product.badge)}
        </div>
        <h2 class="pd-title" id="pdTitle">${esc(product.name)}</h2>
        ${product.sci ? `<p class="pd-sci">${esc(product.sci)}</p>` : ""}
        <p class="pd-price-row">${priceHtml(product, "pd-price")}</p>
        ${product.summary ? `<p class="pd-lead">${esc(product.summary)}</p>` : ""}
        ${pageBoxHtml(product)}
        ${
          product.description
            ? `<section class="pd-section"><h3>รายละเอียด</h3><div class="pd-desc">${formatDescription(product.description)}</div></section>`
            : ""
        }
        ${specs ? `<section class="pd-section"><h3>ข้อมูลจำเพาะ</h3><dl class="pd-specs">${specs}</dl></section>` : ""}
      </div>`;
  }

  function openProduct(product) {
    cancelPendingClose();
    dialog.current = product;
    dialog.content.innerHTML = detailHtml(product);
    applyFacebookLinks(dialog.content);
    dialog.scroller.scrollTop = 0;
    setupGallery(product);
    document.title = `${product.name} | ${state.site.shopName}`;

    if (!dialog.el.open) {
      document.documentElement.classList.add("is-locked");
      if (supportsDialog) {
        dialog.el.showModal();
      } else {
        dialog.el.classList.add("pd--fallback");
        dialog.el.setAttribute("open", "");
      }
    }
    $(".pd-close", dialog.el).focus({ preventScroll: true });
  }

  /**
   * Closes the dialog. fromHistory = true when the URL already changed (Back
   * button, hash edit); otherwise the #product/<id> URL is cleaned up here.
   */
  function closeProduct({ fromHistory = false } = {}) {
    const product = dialog.current;
    if (!product) return;
    dialog.current = null;
    document.title = baseTitle;
    if (!fromHistory) leaveProductUrl(product.id);
    hideDialog(() => {
      document.documentElement.classList.remove("is-locked");
      restoreFocus(product.id);
    });
  }

  function hideDialog(done) {
    const el = dialog.el;
    const finish = () => {
      dialog.closeTimer = 0;
      el.classList.remove("is-closing");
      if (supportsDialog) {
        if (el.open) {
          dialog.selfClosing = true;
          el.close();
        }
      } else {
        el.removeAttribute("open");
      }
      done();
    };
    if (motionQuery.matches || !el.open) {
      finish();
      return;
    }
    el.classList.add("is-closing");
    dialog.closeTimer = window.setTimeout(finish, CLOSE_ANIMATION_MS);
  }

  function cancelPendingClose() {
    if (!dialog.closeTimer) return;
    clearTimeout(dialog.closeTimer);
    dialog.closeTimer = 0;
    dialog.el.classList.remove("is-closing");
  }

  function restoreFocus(productId) {
    const opener = dialog.returnFocus;
    dialog.returnFocus = null;
    if (opener && opener.isConnected) {
      opener.focus({ preventScroll: true });
      return;
    }
    // Opened from a shared link: focus the matching card only if it is on screen.
    const card = dom.grid.querySelector(`.card[data-id="${productId}"]`);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) card.focus({ preventScroll: true });
  }

  function trapFocus(event) {
    const focusables = $$(FOCUSABLE, dialog.el).filter((el) => !el.hidden && el.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.el.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.el.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------------------------------------------------------------- gallery */

  function setupGallery(product) {
    clearTimeout(dialog.gallery.settleTimer);
    const track = product.images.length > 1 ? $(".pd-track", dialog.content) : null;
    dialog.gallery = { index: 0, count: product.images.length, track, settleTimer: 0 };
    if (track) {
      // Native horizontal scrolling gives swipe on touch; we only follow along.
      track.addEventListener("scroll", onTrackScroll, { passive: true });
      updateGallery();
    }
  }

  function goToSlide(index) {
    const gallery = dialog.gallery;
    if (!gallery.track) return;
    gallery.index = (index + gallery.count) % gallery.count;
    gallery.track.scrollTo({ left: gallery.index * gallery.track.clientWidth, behavior: scrollBehavior() });
    updateGallery();
  }

  const stepGallery = (delta) => goToSlide(dialog.gallery.index + delta);

  function onTrackScroll() {
    // Wait until scrolling settles so smooth scrolls and swipes don't flicker the UI.
    clearTimeout(dialog.gallery.settleTimer);
    dialog.gallery.settleTimer = window.setTimeout(() => {
      const gallery = dialog.gallery;
      if (!gallery.track) return;
      const index = Math.round(gallery.track.scrollLeft / Math.max(1, gallery.track.clientWidth));
      const clamped = Math.max(0, Math.min(gallery.count - 1, index));
      if (clamped !== gallery.index) {
        gallery.index = clamped;
        updateGallery();
      }
    }, 90);
  }

  function updateGallery() {
    const { index, count, track } = dialog.gallery;
    if (!track) return;
    const counter = $(".pd-counter", dialog.content);
    if (counter) counter.textContent = `${index + 1} / ${count}`;

    // Load the current image and its neighbours even if they were lazy.
    $$(".pd-slide img", track).forEach((img, i) => {
      const distance = Math.min(Math.abs(i - index), count - Math.abs(i - index));
      if (distance <= 1) img.loading = "eager";
    });

    const strip = $(".pd-thumbs", dialog.content);
    $$(".pd-thumb", dialog.content).forEach((thumb, i) => {
      const active = i === index;
      thumb.classList.toggle("is-active", active);
      if (active) {
        thumb.setAttribute("aria-current", "true");
        // Keep the active thumbnail in view without scrolling the dialog itself.
        if (strip) {
          const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
          strip.scrollTo({ left: Math.max(0, left), behavior: scrollBehavior() });
        }
      } else {
        thumb.removeAttribute("aria-current");
      }
    });
  }

  /** Swaps a broken product photo for the illustration (cards and gallery). */
  function replaceBrokenImage(img) {
    const host = img.closest(".card, .pd-slide, .pd-thumb");
    if (!host) return;
    const product = host.classList.contains("card") ? state.byId.get(host.dataset.id) : dialog.current;
    if (!product) return;
    if (host.classList.contains("pd-thumb")) {
      img.remove();
      return;
    }
    const wrapper = document.createElement("span");
    wrapper.className = host.classList.contains("card") ? "card-art" : "pd-art";
    wrapper.innerHTML = Art.forProduct(product, { size: host.classList.contains("card") ? "sm" : "lg" });
    img.replaceWith(wrapper);
  }

  /* -------------------------------------------------------------- copy link */

  function productUrl(id) {
    const base =
      location.protocol === "http:" || location.protocol === "https:"
        ? location.origin + location.pathname
        : location.href.split("#")[0];
    return `${base}#product/${id}`;
  }

  async function writeClipboard(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      /* fall back to the legacy copy command below */
    }
    // The helper lives inside the dialog: the rest of the page is inert while it is open.
    const area = document.createElement("textarea");
    area.className = "clipboard-proxy";
    area.value = value;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    (dialog.current ? dialog.el : document.body).appendChild(area);
    try {
      area.focus({ preventScroll: true });
      area.select();
      return document.execCommand("copy");
    } catch (_) {
      return false;
    } finally {
      area.remove();
    }
  }

  async function copyProductLink(button) {
    const product = dialog.current;
    if (!product) return;
    const url = productUrl(product.id);
    const copied = await writeClipboard(url);
    if (dialog.current !== product) return;
    if (button && button.isConnected) button.focus({ preventScroll: true });
    if (copied) {
      showToast("คัดลอกลิงก์แล้ว");
      return;
    }
    // No clipboard access (e.g. some file:// or http setups): let the visitor copy it by hand.
    const field = $(".copy-field", dialog.content);
    if (field) {
      field.value = url;
      field.hidden = false;
      field.focus();
      field.select();
    }
    showToast("คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกลิงก์ในช่องด้านล่าง");
  }

  /* ============================================================== routing */

  const replaceUrl = (historyState, url) => {
    try {
      history.replaceState(historyState, "", url);
    } catch (_) {
      /* history API unavailable (sandboxed / unusual file:// setups) */
    }
  };
  const pushUrl = (historyState, url) => {
    try {
      history.pushState(historyState, "", url);
      return true;
    } catch (_) {
      return false;
    }
  };
  const urlWithoutHash = () => location.href.split("#")[0];
  const isOwnEntry = (id) => Boolean(history.state && history.state.ebProduct === id);

  /** null when the hash is not a product link; "" when it is one but malformed. */
  function productIdFromHash() {
    const hash = location.hash.toLowerCase();
    if (!hash.startsWith("#product/")) return null;
    const match = PRODUCT_HASH.exec(hash);
    return match ? match[1] : "";
  }

  /** Leaves the #product/<id> URL without adding a junk history entry. */
  function leaveProductUrl(id) {
    if (isOwnEntry(id)) {
      // We pushed this entry (or it came from in-page navigation): step back to the
      // previous URL. The resulting popstate finds the dialog already closed.
      history.back();
    } else if (productIdFromHash() !== null) {
      // Opened straight from a shared link: strip the hash in place.
      replaceUrl(null, urlWithoutHash());
    }
  }

  /** Opens or closes the dialog to match the current URL. */
  function routeFromUrl({ initial = false } = {}) {
    if (!state.loaded) return;
    const id = productIdFromHash();
    if (id === null) {
      if (dialog.current) closeProduct({ fromHistory: true });
      return;
    }
    if (dialog.current && dialog.current.id === id) return;

    const product = id ? state.byId.get(id) : undefined;
    if (!product) {
      if (dialog.current) closeProduct({ fromHistory: true });
      replaceUrl(null, urlWithoutHash());
      showToast("ไม่พบสินค้านี้");
      return;
    }
    // A hash change inside the page created a history entry we can step back
    // from. A shared link opened on page load did not, so leave it unmarked.
    if (!initial && !isOwnEntry(id)) replaceUrl({ ebProduct: id }, location.href);
    openProduct(product);
  }

  function openFromCard(card) {
    const product = state.byId.get(card.dataset.id);
    if (!product) return false;
    dialog.returnFocus = card;
    if (!(dialog.current && dialog.current.id === product.id)) {
      pushUrl({ ebProduct: product.id }, `#product/${product.id}`);
      openProduct(product);
    }
    return true;
  }

  /** Opens a product from outside the grid (the hero sphere); returns false if unknown. */
  function openById(id) {
    const product = state.byId.get(id);
    if (!product) return false;
    dialog.returnFocus = null;
    if (!(dialog.current && dialog.current.id === product.id)) {
      pushUrl({ ebProduct: product.id }, `#product/${product.id}`);
      openProduct(product);
    }
    return true;
  }

  window.EBShop = Object.freeze({ open: openById });

  /* =============================================================== events */

  dom.query.addEventListener("input", () => {
    state.query = dom.query.value;
    if (state.loaded) render();
  });

  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = dom.query.value;
    if (state.loaded) render();
    scrollToShop();
    // Hide the on-screen keyboard on touch devices so the results are visible.
    if (window.matchMedia("(hover: none)").matches) dom.query.blur();
  });

  dom.sort.addEventListener("change", () => {
    state.sort = SORTS.includes(dom.sort.value) ? dom.sort.value : "recommended";
    if (state.loaded) render();
  });

  dom.chips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (chip && state.loaded) setCategory(chip.dataset.cat);
  });

  dom.clearFilters.addEventListener("click", () => {
    dom.query.value = "";
    state.query = "";
    setCategory("all");
    dom.query.focus({ preventScroll: true });
  });

  dom.retry.addEventListener("click", boot);

  dom.grid.addEventListener("click", (event) => {
    const card = event.target.closest("a.card[data-id]");
    if (!card || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // new tab / window
    if (openFromCard(card)) event.preventDefault();
  });

  // Image load errors don't bubble, so listen in the capture phase.
  const onImageError = (event) => {
    if (event.target instanceof HTMLImageElement) replaceBrokenImage(event.target);
  };
  dom.grid.addEventListener("error", onImageError, true);
  dialog.content.addEventListener("error", onImageError, true);

  let pointerDownOnBackdrop = false;
  dialog.el.addEventListener("pointerdown", (event) => {
    pointerDownOnBackdrop = event.target === dialog.el;
  });

  dialog.el.addEventListener("click", (event) => {
    // Clicks on ::backdrop target the <dialog> itself; the sheet covers the rest.
    if (event.target === dialog.el) {
      if (pointerDownOnBackdrop) closeProduct();
      pointerDownOnBackdrop = false;
      return;
    }
    const control = event.target.closest("[data-action]");
    if (!control) return;
    switch (control.dataset.action) {
      case "close":
        closeProduct();
        break;
      case "prev":
        stepGallery(-1);
        break;
      case "next":
        stepGallery(1);
        break;
      case "thumb":
        goToSlide(Number(control.dataset.index) || 0);
        break;
      case "copy":
        copyProductLink(control);
        break;
      default:
        break;
    }
  });

  dialog.el.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      trapFocus(event);
      return;
    }
    if (event.key === "Escape" && !supportsDialog) {
      event.preventDefault();
      closeProduct();
      return;
    }
    const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!isArrow || event.altKey || event.ctrlKey || event.metaKey || dialog.gallery.count < 2) return;
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    stepGallery(event.key === "ArrowLeft" ? -1 : 1);
  });

  // Esc on a native modal dialog fires "cancel": run our own close (history + animation).
  dialog.el.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeProduct();
  });

  // Safety net: the browser may close a modal dialog by itself (e.g. a repeated Esc).
  dialog.el.addEventListener("close", () => {
    if (dialog.selfClosing) {
      dialog.selfClosing = false;
      return;
    }
    if (dialog.current) closeProduct();
  });

  window.addEventListener("popstate", () => routeFromUrl());
  window.addEventListener("hashchange", () => routeFromUrl());

  /* ================================================================= boot */

  function boot() {
    dom.loadError.hidden = true;
    dom.empty.hidden = true;
    dom.resultCount.textContent = "กำลังโหลดรายการสินค้า…";
    renderSkeleton();

    Catalog.load()
      .then((catalog) => {
        state.site = catalog.site;
        state.products = catalog.products;
        state.byId = new Map(catalog.products.map((p) => [p.id, p]));
        buildSearchIndex(catalog.products);
        state.loaded = true;

        // Keep whatever the browser restored into the form controls.
        state.query = dom.query.value;
        state.sort = SORTS.includes(dom.sort.value) ? dom.sort.value : "recommended";

        applySite(catalog.site);
        render();
        routeFromUrl({ initial: true });

        // The hero sphere (js/sphere.js) builds its plates from the same catalog.
        window.EBShopCatalog = catalog;
        document.dispatchEvent(new CustomEvent("eb:catalog", { detail: catalog }));
      })
      .catch((error) => {
        console.error("[E Beetle] โหลดรายการสินค้าไม่สำเร็จ", error);
        showLoadError();
        document.dispatchEvent(new CustomEvent("eb:catalog-error"));
      });
  }

  boot();
})();
