const MOBILE_QUERY = '(max-width: 767px)';
const MOBILE_SCALE = 0.38;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 300;
const DESKTOP_WIDTH = 1200;
const DESKTOP_HEIGHT = 560;
const CENTER_X = 0.5;
const CENTER_Y = 0.5;

type Planet = { element: SVGGElement; radius: number; period: number; phase: number };

function setupSolar(svg: SVGSVGElement) {
  const planets = Array.from(svg.querySelectorAll<SVGGElement>('[data-solar-planet]')).map((element) => ({
    element,
    radius: Number(element.dataset.a),
    period: Number(element.dataset.period),
    phase: Number(element.dataset.phase),
  } as Planet));
  const orbits = Array.from(svg.querySelectorAll<SVGEllipseElement>('[data-orbit]'));
  const mobile = matchMedia(MOBILE_QUERY);
  let visible = true;
  let animation = 0;
  let elapsed = 0;
  let last = 0;

  const layout = () => {
    const scale = mobile.matches ? MOBILE_SCALE : 1;
    const width = mobile.matches ? MOBILE_WIDTH : DESKTOP_WIDTH;
    const height = mobile.matches ? MOBILE_HEIGHT : DESKTOP_HEIGHT;
    const cx = width * CENTER_X;
    const cy = height * CENTER_Y;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const centerScale = mobile.matches ? MOBILE_SCALE : 1;
    const glow = svg.querySelector<SVGCircleElement>('.home-solar-glow');
    const core = svg.querySelector<SVGCircleElement>('.home-solar-core');
    const you = svg.querySelector<SVGTextElement>('.home-solar-you');
    if (glow) { glow.setAttribute('cx', String(cx)); glow.setAttribute('cy', String(cy)); glow.setAttribute('r', String(49 * centerScale)); }
    if (core) { core.setAttribute('cx', String(cx)); core.setAttribute('cy', String(cy)); core.setAttribute('r', String(26 * centerScale)); }
    if (you) { you.setAttribute('x', String(cx)); you.setAttribute('y', String(cy + 67 * centerScale)); }
    orbits.forEach((orbit) => {
      const radius = Number(orbit.dataset.orbit) * scale;
      orbit.setAttribute('cx', String(cx));
      orbit.setAttribute('cy', String(cy));
      orbit.setAttribute('rx', String(radius));
      orbit.setAttribute('ry', String(radius * 0.34));
      orbit.setAttribute('transform', `rotate(19.3 ${cx} ${cy})`);
    });
    planets.forEach((planet) => {
      const circle = planet.element.querySelector<SVGCircleElement>('circle');
      if (circle) {
        const radius = Number(circle.dataset.baseRadius ?? circle.getAttribute('r') ?? 0) * scale;
        circle.setAttribute('r', String(radius));
        const label = planet.element.querySelector<SVGTextElement>('text');
        if (label) label.setAttribute('x', String(radius + 8));
      }
    });
    render(elapsed);
  };

  const render = (seconds: number) => {
    const scale = mobile.matches ? MOBILE_SCALE : 1;
    const cx = mobile.matches ? MOBILE_WIDTH * CENTER_X : DESKTOP_WIDTH * CENTER_X;
    const cy = mobile.matches ? MOBILE_HEIGHT * CENTER_Y : DESKTOP_HEIGHT * CENTER_Y;
    planets.forEach((planet) => {
      const angle = Math.PI * 2 * (seconds / planet.period + planet.phase);
      const radius = planet.radius * scale;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.34;
      planet.element.setAttribute('transform', `translate(${x} ${y})`);
    });
  };

  planets.forEach((planet) => {
    const circle = planet.element.querySelector<SVGCircleElement>('circle');
    if (circle && !circle.dataset.baseRadius) circle.dataset.baseRadius = circle.getAttribute('r') ?? '0';
  });

  const loop = (now: number) => {
    animation = 0;
    if (!visible || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!last) last = now;
    elapsed += Math.min(0.1, (now - last) / 1000);
    last = now;
    render(elapsed);
    animation = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && visible && !document.hidden && !animation) animation = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    last = 0;
  };

  layout();
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(svg);
  mobile.addEventListener('change', layout);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start(); else stop();
  }, { threshold: 0.01 });
  visibilityObserver.observe(svg);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  start();
}

export function initSolar() {
  document.querySelectorAll<SVGSVGElement>('[data-solar]').forEach(setupSolar);
}
