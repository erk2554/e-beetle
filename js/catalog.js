/*
 * E Beetle — catalog loader.
 *
 * window.EBCatalog.load() resolves to { site, products, source }.
 *   - Over http(s) it asks the server first (GET api/catalog, 5 s timeout).
 *   - If that fails, or the page was opened straight from disk (file://), it
 *     falls back to the snapshot the server writes to js/catalog-data.js
 *     (window.EBEETLE_CATALOG).
 *   - If neither is available the promise rejects and the storefront shows a
 *     friendly error state.
 * Everything is normalised defensively, so the rest of the storefront can rely
 * on the shape described in the data contract.
 */
(function () {
  "use strict";

  const API_URL = "api/catalog";
  const TIMEOUT_MS = 5000;

  const DEFAULT_FACEBOOK_URL = "https://www.facebook.com/share/14q8LxbSTaR/";
  const FACEBOOK_HOSTS = new Set([
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "web.facebook.com",
    "fb.com",
    "www.fb.com",
    "fb.me",
    "m.me",
  ]);

  const CATEGORY_LABELS = Object.freeze({
    rhino: "ด้วงกว่าง",
    stag: "ด้วงคีม",
    larva: "ตัวอ่อน",
    supply: "อุปกรณ์เลี้ยง",
  });
  const STATUS_LABELS = Object.freeze({
    available: "พร้อมขาย",
    reserved: "ติดจอง",
    soldout: "ขายแล้ว",
  });

  const DEFAULT_SITE = deepFreeze({
    shopName: "E Beetle",
    tagline: "ร้านด้วงคุณภาพ ส่งตรงจากฟาร์ม",
    facebookName: "E Beetle",
    facebookUrl: DEFAULT_FACEBOOK_URL,
    heroTitle: "ด้วงสวย *เลี้ยงง่าย* ส่งถึงบ้าน",
    heroText:
      "รวมด้วงกว่าง ด้วงคีม ตัวอ่อน และอุปกรณ์เลี้ยงครบชุด คัดตัวแข็งแรงทุกตัว สั่งซื้อและปรึกษาการเลี้ยงได้ที่เพจ E Beetle",
    contactNote: "สนใจตัวไหน ทักแชทเพจ Facebook ได้เลย ตอบไว พร้อมส่งรูปตัวจริงให้ดูก่อนตัดสินใจ",
    stats: [
      { value: "12+", label: "สายพันธุ์" },
      { value: "4,800+", label: "ลูกค้าที่ไว้ใจ" },
      { value: "รับประกัน", label: "ด้วงถึงมือมีชีวิต" },
    ],
    updatedAt: "",
  });

  const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const IMAGE_ID = /^img-[a-z0-9]{8,24}$/;
  // Uploaded photos live in uploads/ and are referenced relative to Home.html.
  const IMAGE_SRC = /^uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const ART_ICONS = ["jelly", "soil", "box"];
  const MAX_PRICE = 1000000;

  /* ------------------------------------------------------------- helpers */

  function deepFreeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const matches = (pattern, value) => typeof value === "string" && pattern.test(value);

  /** A trimmed string, or "" for anything that is not a string. */
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  /** Required text: falls back when missing or blank. */
  const requiredText = (value, fallback) => text(value) || fallback;

  /** Optional text: an explicit "" is respected, a missing/invalid value falls back. */
  const optionalText = (value, fallback) => (typeof value === "string" ? value.trim() : fallback);

  /** True for https links to one of the allowed Facebook hosts (see the data contract). */
  function isFacebookUrl(value) {
    if (typeof value !== "string") return false;
    const candidate = value.trim();
    if (!candidate || candidate.length > 300) return false;
    let url;
    try {
      url = new URL(candidate);
    } catch (_) {
      return false;
    }
    return (
      url.protocol === "https:" &&
      FACEBOOK_HOSTS.has(url.hostname.toLowerCase()) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  }

  /** The given URL when it is a valid Facebook link, otherwise the shop's default page. */
  const safeFacebookUrl = (value) => (isFacebookUrl(value) ? value.trim() : DEFAULT_FACEBOOK_URL);

  /* --------------------------------------------------------- normalisers */

  function normaliseStat(raw) {
    if (!isObject(raw)) return null;
    const value = text(raw.value);
    const label = text(raw.label);
    return value && label ? { value, label } : null;
  }

  function normaliseSite(raw) {
    const src = isObject(raw) ? raw : {};
    return {
      shopName: requiredText(src.shopName, DEFAULT_SITE.shopName),
      tagline: optionalText(src.tagline, DEFAULT_SITE.tagline),
      facebookName: requiredText(src.facebookName, DEFAULT_SITE.facebookName),
      facebookUrl: safeFacebookUrl(src.facebookUrl),
      heroTitle: requiredText(src.heroTitle, DEFAULT_SITE.heroTitle),
      heroText: optionalText(src.heroText, DEFAULT_SITE.heroText),
      contactNote: optionalText(src.contactNote, DEFAULT_SITE.contactNote),
      stats: Array.isArray(src.stats)
        ? src.stats.map(normaliseStat).filter(Boolean).slice(0, 4)
        : DEFAULT_SITE.stats.map((stat) => ({ ...stat })),
      updatedAt: text(src.updatedAt),
    };
  }

  function normaliseSpecs(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isObject)
      .map((spec) => ({ label: text(spec.label), value: text(spec.value) }))
      .filter((spec) => spec.label && spec.value)
      .slice(0, 12);
  }

  function normaliseImages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((image) => isObject(image) && typeof image.src === "string")
      .map((image, index) => ({
        id: matches(IMAGE_ID, image.id) ? image.id : `img-local${index}`,
        src: image.src.trim(),
      }))
      .filter((image) => IMAGE_SRC.test(image.src) && !image.src.includes(".."))
      .slice(0, 8);
  }

  function normaliseArt(raw) {
    const art = {};
    if (!isObject(raw)) return art;
    if (matches(HEX_COLOR, raw.shell)) art.shell = raw.shell;
    if (matches(HEX_COLOR, raw.dark)) art.dark = raw.dark;
    if (raw.horns === 5) art.horns = 5;
    if (raw.long === true) art.long = true;
    if (ART_ICONS.includes(raw.icon)) art.icon = raw.icon;
    return art;
  }

  function normalisePrice(raw) {
    const price = Number(raw);
    return Number.isFinite(price) && price > 0 ? Math.min(Math.round(price), MAX_PRICE) : 0;
  }

  function normaliseProduct(raw) {
    if (!isObject(raw) || raw.visible === false) return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!PRODUCT_ID.test(id)) return null;

    const category = has(CATEGORY_LABELS, raw.category) ? raw.category : "supply";
    return {
      id,
      name: requiredText(raw.name, "สินค้า"),
      sci: text(raw.sci),
      category,
      price: normalisePrice(raw.price),
      unit: requiredText(raw.unit, category === "supply" ? "ชิ้น" : "ตัว"),
      badge: text(raw.badge),
      status: has(STATUS_LABELS, raw.status) ? raw.status : "available",
      summary: text(raw.summary),
      description: typeof raw.description === "string" ? raw.description.replace(/\r\n?/g, "\n").trim() : "",
      specs: normaliseSpecs(raw.specs),
      images: normaliseImages(raw.images),
      art: normaliseArt(raw.art),
    };
  }

  /** Validates a { site, products } payload; throws when it is not a catalog at all. */
  function normaliseCatalog(raw) {
    if (!isObject(raw) || !Array.isArray(raw.products)) {
      throw new Error("รูปแบบข้อมูลสินค้าไม่ถูกต้อง");
    }
    const seen = new Set();
    const products = [];
    raw.products.forEach((item) => {
      const product = normaliseProduct(item);
      if (product && !seen.has(product.id)) {
        seen.add(product.id);
        products.push(product);
      }
    });
    return { site: normaliseSite(raw.site), products };
  }

  /* ------------------------------------------------------------- loading */

  async function fetchJson(url, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const response = await fetch(url, {
        cache: "no-cache",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function load() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      try {
        const data = await fetchJson(API_URL, TIMEOUT_MS);
        return { ...normaliseCatalog(data), source: "api" };
      } catch (error) {
        console.warn("[E Beetle] โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ จะใช้ข้อมูลสำรองแทน", error);
      }
    }
    const snapshot = window.EBEETLE_CATALOG;
    if (snapshot !== undefined) {
      return { ...normaliseCatalog(snapshot), source: "snapshot" };
    }
    throw new Error("ไม่พบข้อมูลสินค้า");
  }

  window.EBCatalog = Object.freeze({
    load,
    normalise: normaliseCatalog,
    isFacebookUrl,
    safeFacebookUrl,
    CATEGORY_LABELS,
    STATUS_LABELS,
    DEFAULT_SITE,
    DEFAULT_FACEBOOK_URL,
  });
})();
