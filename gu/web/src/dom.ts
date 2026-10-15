/**
 * The site CSP is `style-src 'self'`, so the browser drops style attributes written
 * into markup. Chart geometry therefore travels as data-* and is applied here
 * through CSSOM, which the CSP does not restrict.
 */
export function applyChartStyles(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) el.style.width = `${el.dataset.w}%`;
  for (const el of root.querySelectorAll<HTMLElement>("[data-l]")) {
    const left = `${el.dataset.l}%`;
    el.style.left = el.classList.contains("rail-dot") ? `clamp(6px, ${left}, calc(100% - 6px))` : left;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i]")) el.style.setProperty("--i", el.dataset.i!);
}
