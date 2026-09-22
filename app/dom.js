// @ts-check

/**
 * Tiny DOM helpers — element builder and the shared SVG icon set.
 * All icons are inline SVG so nothing depends on external images.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]  className/attributes/on* handlers/dataset.
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'text') node.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node && (key === 'value' || key === 'checked' || key === 'disabled' || key === 'open')) {
        // @ts-ignore - property assignment for live form state
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ICON_PATHS = {
  // 24x24 viewBox, stroke-based (lucide-style)
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-.8 13.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M18.4 5.6l-2.9 2.9M8.5 15.5l-2.9 2.9"/>',
  gauge: '<path d="M12 14.5 16 8"/><path d="M20.5 15.5a9 9 0 1 0-17 0"/>',
  flame:
    '<path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-2.5-1.4-4.4-2.8-6C14.4 7.3 13.4 5.7 13 3.5c-2.8 1.6-3.7 4-3.4 6.3.1 1-.9 1.5-1.6.8-.4-.4-.7-1-.9-1.7C5.9 10.4 5.5 12.4 5.5 14 5.5 18.4 8 21 12 21Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  soundOn:
    '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>',
  soundOff: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
};

/**
 * @param {string} name One of the ICON_PATHS keys; unknown names render empty.
 * @param {number} [size]
 * @returns {SVGSVGElement}
 */
export function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_PATHS[/** @type {keyof typeof ICON_PATHS} */ (name)] || '';
  return svg;
}

/**
 * A clean SVG basketball (used by the flight animation, the hoop stage and
 * decorative glyphs). Orange ball, dark seams, subtle shading.
 * @param {number} [size]
 * @returns {SVGSVGElement}
 */
export function basketballSvg(size = 40) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const uid = `bb${Math.random().toString(36).slice(2, 8)}`;
  svg.innerHTML = `
    <defs>
      <radialGradient id="${uid}-fill" cx="34%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#FDA557"/>
        <stop offset="45%" stop-color="#F97316"/>
        <stop offset="100%" stop-color="#C2410C"/>
      </radialGradient>
    </defs>
    <circle cx="20" cy="20" r="19" fill="url(#${uid}-fill)"/>
    <g stroke="#7C2D12" stroke-width="1.6" fill="none" stroke-linecap="round">
      <path d="M20 1v38"/>
      <path d="M1 20h38"/>
      <path d="M6.2 6.6C11 11 13.4 15.3 13.4 20c0 4.7-2.4 9-7.2 13.4"/>
      <path d="M33.8 6.6C29 11 26.6 15.3 26.6 20c0 4.7 2.4 9 7.2 13.4"/>
    </g>
    <circle cx="20" cy="20" r="19" fill="none" stroke="#7C2D12" stroke-opacity=".55" stroke-width="1.4"/>
    <ellipse cx="14" cy="11.5" rx="7.5" ry="5" fill="#FFFFFF" opacity=".18" transform="rotate(-28 14 11.5)"/>
  `;
  return svg;
}

/**
 * Format an ISO timestamp like "Sep 22, 2026 · 3:41 PM".
 * @param {string} iso
 */
export function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${date} · ${time}`;
  } catch {
    return '';
  }
}
