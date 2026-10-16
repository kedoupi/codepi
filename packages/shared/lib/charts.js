/**
 * Render a pie chart into an SVG element using path arcs.
 * Reserved viewBox: 100×100 (cx=50, cy=50, r=40).
 *
 * @param {SVGElement} svgEl
 * @param {Array<{value:number,color:string,label?:string}>} segments
 */
export function renderPie(svgEl, segments) {
  const total = segments.reduce((s, p) => s + p.value, 0);
  const cx = 50, cy = 50, r = 40;
  if (!total) {
    svgEl.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#e2e8f0"/>`;
    return;
  }
  const positives = segments.filter((p) => p.value > 0);
  if (positives.length === 1) {
    svgEl.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${positives[0].color}"/>`;
    return;
  }
  let acc = 0;
  const paths = segments.map((p) => {
    if (p.value <= 0) return '';
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += p.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${p.color}"/>`;
  }).join('');
  svgEl.innerHTML = paths;
}

/**
 * Render a line chart with optional area fill into an SVG element.
 * Reserved viewBox: 200×100 (auto-scales x and y to fit).
 *
 * @param {SVGElement} svgEl
 * @param {Array<{x:number,y:number}>} points
 * @param {{ lineColor?: string, fillColor?: string, xLabels?: string[] }} [opts]
 */
export function renderLineChart(svgEl, points, opts = {}) {
  if (!points || points.length < 2) { svgEl.innerHTML = ''; return; }
  const lineColor = opts.lineColor || '#2563eb';
  const fillColor = opts.fillColor || 'rgba(37,99,235,0.15)';
  const W = 200, H = 100, padL = 4, padR = 4, padT = 4, padB = 14;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.max(...ys, 1);
  const sx = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = (y) => H - padB - (y / yMax) * (H - padT - padB);
  const linePts = points.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');
  const areaPts = `${sx(xMin)},${H - padB} ${linePts} ${sx(xMax)},${H - padB}`;
  let labelEls = '';
  if (opts.xLabels && opts.xLabels.length) {
    const step = Math.max(1, Math.floor(opts.xLabels.length / 4));
    labelEls = opts.xLabels.map((lbl, i) => {
      if (i % step !== 0 && i !== opts.xLabels.length - 1) return '';
      const x = sx(points[i]?.x ?? i);
      return `<text x="${x.toFixed(1)}" y="${H - 2}" font-size="6" text-anchor="middle" fill="#64748b">${lbl}</text>`;
    }).join('');
  }
  svgEl.innerHTML = `
    <polygon points="${areaPts}" fill="${fillColor}" />
    <polyline points="${linePts}" fill="none" stroke="${lineColor}" stroke-width="1.5" />
    ${labelEls}
  `.trim();
}
