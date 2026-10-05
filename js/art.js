/*
 * E Beetle — product illustrations.
 *
 * window.EBArt.forProduct(product, { size }) returns an inline SVG string that
 * stands in for a product photo when product.images is empty. The drawing is
 * driven by product.category and product.art:
 *   { shell: "#rrggbb", dark: "#rrggbb", horns: 5, long: true, icon: "jelly" | "soil" | "box" }
 * Every SVG gets its own id prefix so gradients from different cards never clash.
 */
(function () {
  "use strict";

  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const SHADOW = '<ellipse cx="60" cy="112" rx="34" ry="5" fill="rgba(15,61,38,.14)"/>';

  // Fallback colours when a beetle has no art settings yet.
  const BEETLE_DEFAULTS = {
    rhino: { shell: "#6b4426", dark: "#2a1a0e" },
    stag: { shell: "#4a2c1a", dark: "#1b120c" },
  };

  let uid = 0;

  const pickColor = (value, fallback) =>
    typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;

  /** Mixes a #rrggbb colour towards white (amount > 0) or black (amount < 0). */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const t = Math.min(1, Math.abs(amount));
    return (
      "#" +
      [16, 8, 0]
        .map((shift) => {
          const channel = (n >> shift) & 255;
          return Math.round(channel + (target - channel) * t).toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  /** Mirrors a polyline ("x,y x,y ...") around the vertical centre line x = 60. */
  const mirror = (points) =>
    points
      .split(" ")
      .map((pair) => {
        const [x, y] = pair.split(",");
        return `${120 - Number(x)},${y}`;
      })
      .join(" ");

  /* ------------------------------------------------------------- beetles */

  const LEGS = ["47,42 34,35 28,24 26,17", "41,63 26,61 17,71 12,76", "43,84 30,95 26,107 25,113"];

  function legs(color) {
    const lines = LEGS.map((p) => `<polyline points="${p}"/><polyline points="${mirror(p)}"/>`).join("");
    return `<g fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${lines}</g>`;
  }

  /** Rhinoceros-beetle horns: classic two-horn, Hercules-style long, or five-horned. */
  function horns(color, art) {
    const stroke = `fill="none" stroke="${color}" stroke-linecap="round"`;
    if (art.horns === 5) {
      return `<g ${stroke}>
        <path d="M60 31Q57 18 60 5" stroke-width="4.5"/>
        <path d="M47 41Q40 33 39 20M73 41Q80 33 81 20" stroke-width="4"/>
        <path d="M54 38 52 28M66 38 68 28" stroke-width="3.2"/>
      </g>`;
    }
    if (art.long) {
      return `<g ${stroke}>
        <path d="M60 41Q60.6 22 60 3" stroke-width="5.5"/>
        <path d="M60 31Q58.8 20 60 10" stroke-width="3.6"/>
        <path d="M60 19l-3.2-1.6M60 19l3.2-1.6" stroke-width="2"/>
      </g>
      <path d="M60 27V13" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".18"/>`;
    }
    return `<g ${stroke}>
      <path d="M60 31Q58.5 20 60 11" stroke-width="4.5"/>
      <path d="M60 12l-3.5-5M60 12l3.5-5" stroke-width="2.6"/>
      <path d="M60 41V27" stroke-width="6"/>
      <path d="M60 28l-2.6-3.6M60 28l2.6-3.6" stroke-width="2.6"/>
    </g>`;
  }

  /** Stag-beetle mandibles; long ones reach almost to the top of the frame. */
  function mandibles(color, long) {
    const jaws = long
      ? "M54 26C44 20 40 8 51 1M66 26C76 20 80 8 69 1"
      : "M54 26C46 22 42 14 49 6M66 26C74 22 78 14 71 6";
    const teeth = long ? "M43.5 13l5 1M76.5 13l-5 1" : "M46 15l5 1.5M74 15l-5 1.5";
    return `<g fill="none" stroke="${color}" stroke-linecap="round">
      <path d="${jaws}" stroke-width="4"/>
      <path d="${teeth}" stroke-width="2.4"/>
    </g>`;
  }

  function beetle(isStag, art, id) {
    const base = BEETLE_DEFAULTS[isStag ? "stag" : "rhino"];
    const shell = pickColor(art.shell, base.shell);
    const dark = pickColor(art.dark, base.dark);
    const edge = shade(shell, -0.5);

    const antennae = isStag
      ? `<path d="M51 28 44 24 41 18M69 28 76 24 79 18" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M54 28 49 23M66 28 71 23" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>
         <circle cx="49" cy="23" r="1.7" fill="${dark}"/><circle cx="71" cy="23" r="1.7" fill="${dark}"/>`;
    const head = isStag
      ? `<ellipse cx="60" cy="31" rx="12.5" ry="8" fill="url(#${id}-d)"/>`
      : `<ellipse cx="60" cy="32" rx="9.5" ry="7" fill="url(#${id}-d)"/>`;
    const pronotum = isStag
      ? `<ellipse cx="60" cy="46" rx="17" ry="10" fill="url(#${id}-d)"/>`
      : `<ellipse cx="60" cy="46" rx="20" ry="11.5" fill="url(#${id}-d)"/>`;

    return `<defs>
        <radialGradient id="${id}-s" cx="36%" cy="28%" r="85%">
          <stop offset="0" stop-color="${shade(shell, 0.38)}"/>
          <stop offset=".45" stop-color="${shell}"/>
          <stop offset="1" stop-color="${shade(shell, -0.45)}"/>
        </radialGradient>
        <radialGradient id="${id}-d" cx="38%" cy="30%" r="80%">
          <stop offset="0" stop-color="${shade(dark, 0.3)}"/>
          <stop offset="1" stop-color="${dark}"/>
        </radialGradient>
      </defs>
      ${SHADOW}
      ${legs(dark)}
      ${antennae}
      ${isStag ? mandibles(dark, art.long === true) : ""}
      <path d="M60 51C70 50 82 53 83 66C84 84 77 101 60 107C43 101 36 84 37 66C38 53 50 50 60 51Z" fill="url(#${id}-s)" stroke="${edge}" stroke-width=".8"/>
      <path d="M60 53V106" stroke="${shade(shell, -0.55)}" stroke-width="1.3" opacity=".75"/>
      ${pronotum}
      ${head}
      ${isStag ? "" : horns(dark, art)}
      <ellipse cx="50" cy="68" rx="4.2" ry="13" fill="#fff" opacity=".3" transform="rotate(10 50 68)"/>
      <ellipse cx="71" cy="73" rx="2" ry="8" fill="#fff" opacity=".12" transform="rotate(-8 71 73)"/>
      <ellipse cx="53" cy="42.5" rx="6.5" ry="2.8" fill="#fff" opacity=".22"/>
      <ellipse cx="57" cy="30" rx="3" ry="1.6" fill="#fff" opacity=".18"/>`;
  }

  /* -------------------------------------------------------------- larvae */

  function larva(id) {
    const arc = "M86 46A30 30 0 1 0 74 92";
    return `<defs>
        <linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fbf4df"/><stop offset="1" stop-color="#e2d0a2"/>
        </linearGradient>
        <radialGradient id="${id}-h" cx="35%" cy="35%" r="70%">
          <stop offset="0" stop-color="#d98b45"/><stop offset="1" stop-color="#94501c"/>
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="104" rx="36" ry="5" fill="rgba(15,61,38,.14)"/>
      <path d="${arc}" fill="none" stroke="url(#${id}-g)" stroke-width="30" stroke-linecap="round"/>
      <path d="${arc}" fill="none" stroke="#cdb88a" stroke-width="30" stroke-dasharray="1.6 8.4" opacity=".55"/>
      <ellipse cx="38" cy="58" rx="4" ry="11" fill="#fff" opacity=".45" transform="rotate(20 38 58)"/>
      <path d="M80 58l-3 6M75 62l-4 5M70 65l-4 4" stroke="#b98a4a" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="88" cy="42" r="13" fill="url(#${id}-h)"/>
      <ellipse cx="84" cy="37" rx="4" ry="2.4" fill="#fff" opacity=".3"/>
      <path d="M94 50l6 4M90 54l3 6" stroke="#4a2508" stroke-width="2.6" stroke-linecap="round"/>`;
  }

  /* ------------------------------------------------------------ supplies */

  function jelly() {
    const cups = [
      [34, "#e85d75"],
      [60, "#f2a93b"],
      [86, "#2fa66a"],
    ];
    return (
      '<ellipse cx="60" cy="104" rx="40" ry="5" fill="rgba(15,61,38,.14)"/>' +
      cups
        .map(
          ([x, c]) => `
      <path d="M${x - 14} 60L${x - 11} 100Q${x} 103 ${x + 11} 100L${x + 14} 60Z" fill="#fff" stroke="#cfe6d8" stroke-width="2"/>
      <path d="M${x - 12} 70L${x - 10.2} 98Q${x} 100.5 ${x + 10.2} 98L${x + 12} 70Z" fill="${c}" opacity=".4"/>
      <path d="M${x - 9} 66 ${x - 7.5} 92" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".75"/>
      <rect x="${x - 15.5}" y="53" width="31" height="9" rx="3.5" fill="${c}"/>
      <rect x="${x - 12}" y="55" width="10" height="2.4" rx="1.2" fill="#fff" opacity=".45"/>`
        )
        .join("")
    );
  }

  function soil(id) {
    return `<defs>
        <linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2fa66a"/><stop offset="1" stop-color="#1f7a4d"/>
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="106" rx="36" ry="5" fill="rgba(15,61,38,.14)"/>
      <path d="M30 30Q60 22 90 30L94 100Q60 108 26 100Z" fill="url(#${id}-b)"/>
      <path d="M30 30Q60 22 90 30L88 40Q60 34 32 40Z" fill="#0f3d26"/>
      <path d="M34 46 33 92" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".18"/>
      <rect x="40" y="52" width="40" height="30" rx="7" fill="#fff"/>
      <rect x="40" y="76" width="40" height="6" rx="3" fill="#c9a24a"/>
      <circle cx="52" cy="65" r="4" fill="#7a5230"/><circle cx="62" cy="61" r="3" fill="#5a3a22"/><circle cx="68" cy="69" r="4" fill="#8a6038"/>`;
  }

  function breedingBox() {
    return `<ellipse cx="60" cy="104" rx="40" ry="5" fill="rgba(15,61,38,.14)"/>
      <rect x="22" y="44" width="76" height="56" rx="8" fill="rgba(191,229,207,.55)" stroke="#2fa66a" stroke-width="2.5"/>
      <path d="M23.5 80Q40 76 60 79T96.5 78V92A6.5 6.5 0 0 1 90 98.5H30A6.5 6.5 0 0 1 23.5 92Z" fill="#8a6038" opacity=".85"/>
      <rect x="58" y="69" width="26" height="7" rx="3.5" fill="#6b4426" transform="rotate(-12 71 72.5)"/>
      <path d="M30 52V70" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
      <rect x="18" y="34" width="84" height="14" rx="5" fill="#1f7a4d"/>
      <rect x="44" y="38" width="32" height="6" rx="3" fill="#bfe5cf"/>
      <path d="M50 41h20" stroke="#1f7a4d" stroke-width="1.4" stroke-dasharray="2 2"/>`;
  }

  function supply(icon, id) {
    if (icon === "jelly") return jelly();
    if (icon === "soil") return soil(id);
    return breedingBox();
  }

  /* ----------------------------------------------------------------- API */

  /**
   * Returns the SVG markup for a product (aria-hidden: the product name is
   * always shown next to it). options.size: "sm" (cards) or "lg" (detail view).
   */
  function forProduct(product, options) {
    const p = product && typeof product === "object" ? product : {};
    const art = p.art && typeof p.art === "object" ? p.art : {};
    const size = options && options.size === "lg" ? "lg" : "sm";
    const id = "eba" + ++uid;

    let body;
    if (p.category === "larva") body = larva(id);
    else if (p.category === "rhino" || p.category === "stag") body = beetle(p.category === "stag", art, id);
    else body = supply(art.icon, id);

    return `<svg class="eb-art eb-art--${size}" viewBox="0 0 120 120" aria-hidden="true">${body}</svg>`;
  }

  window.EBArt = Object.freeze({ forProduct });
})();
