const FPS = 30;
const DT = 1 / FPS;
const TILT = 0.58;
const DATA_TOKENS = ['--state-sleep', '--state-home', '--state-commute', '--state-desk', '--state-away', '--state-meeting', '--state-out'];

type Particle = { r: number; a: number; z: number; v: number; px: number | null; py: number | null };
type Flash = { a: number; life: number; color: string };
type Ripple = { radius: number; life: number };

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function initCanvas(canvas: HTMLCanvasElement) {
  const output = canvas.getContext('2d');
  if (!output) return;
  const trail = document.createElement('canvas');
  const context = trail.getContext('2d');
  if (!context) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = {
    background: cssColor('--color-background'),
    graphite: cssColor('--brand-graphite'),
    orange: cssColor('--brand-orange'),
    data: DATA_TOKENS.map(cssColor),
  };
  let width = 0;
  let height = 0;
  let centerX = 0;
  let centerY = 0;
  let radiusMax = 0;
  let dpr = 1;
  let particles: Particle[] = [];
  let flashes: Flash[] = [];
  let ripples: Ripple[] = [];
  let absorbed = 0;
  let time = 0;
  let animation = 0;
  let visible = true;
  let frames = 0;
  let fpsStart = 0;
  let seed = 20261108;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const coreRadius = () => 10 * dpr;
  const ringRadius = () => 46 * dpr;

  const spawn = (particle: Particle, anywhere: boolean) => {
    particle.r = anywhere ? ringRadius() * 1.2 + random() * (radiusMax - ringRadius() * 1.2) : radiusMax * (0.85 + random() * 0.15);
    particle.a = random() * Math.PI * 2;
    particle.z = 0.25 + random() * 0.75;
    particle.v = 0.35 + random() * 0.5;
    particle.px = null;
    particle.py = null;
  };

  const resize = () => {
    const cssWidth = canvas.clientWidth || 1;
    const cssHeight = canvas.clientHeight || 1;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(cssWidth * dpr));
    height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.width = trail.width = width;
    canvas.height = trail.height = height;
    centerX = width / 2;
    centerY = height / 2;
    radiusMax = Math.hypot(width, height) * 0.62;
    const count = Math.round(2600 * Math.min(1, (cssWidth * cssHeight) / (1440 * 720)) + 600);
    particles = Array.from({ length: count }, () => {
      const particle = {} as Particle;
      spawn(particle, true);
      return particle;
    });
    context.clearRect(0, 0, width, height);
    draw(0.12);
  };

  const step = (delta: number) => {
    time += delta;
    for (const particle of particles) {
      const normalized = particle.r / radiusMax;
      const angular = 0.55 * particle.v * (0.6 + particle.z) / Math.pow(Math.max(normalized, 0.02), 0.9);
      const inward = 38 * dpr * particle.v * (0.5 + particle.z) / Math.pow(Math.max(normalized, 0.03), 0.5);
      particle.a += angular * delta * 0.35;
      particle.r -= inward * delta;
      if (particle.r < ringRadius() * 0.9) {
        absorbed += 1;
        if (random() < 0.08) flashes.push({ a: particle.a, life: 1, color: colors.data[(random() * colors.data.length) | 0] });
        if (absorbed % 140 === 0) ripples.push({ radius: ringRadius(), life: 1 });
        spawn(particle, false);
      }
    }
    for (const flash of flashes) flash.life -= delta * 1.6;
    for (const ripple of ripples) {
      ripple.life -= delta * 0.55;
      ripple.radius += delta * 60 * dpr;
    }
    for (let index = flashes.length - 1; index >= 0; index -= 1) if (flashes[index].life <= 0) flashes.splice(index, 1);
    for (let index = ripples.length - 1; index >= 0; index -= 1) if (ripples[index].life <= 0) ripples.splice(index, 1);
  };

  const draw = (fade: number) => {
    context.globalCompositeOperation = 'destination-out';
    context.globalAlpha = fade;
    context.fillStyle = colors.background;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.lineCap = 'round';
    for (const particle of particles) {
      const x = centerX + Math.cos(particle.a) * particle.r;
      const y = centerY + Math.sin(particle.a) * particle.r * TILT;
      if (particle.px !== null && particle.py !== null) {
        const normalized = particle.r / radiusMax;
        const near = 1 - Math.min(1, normalized);
        const edge = Math.min(1, (1 - normalized) * 6);
        context.globalAlpha = (0.10 + 0.55 * near * near) * particle.z * edge;
        context.strokeStyle = colors.graphite;
        context.lineWidth = (0.35 + 0.9 * particle.z * (0.4 + near)) * dpr;
        context.beginPath();
        context.moveTo(particle.px, particle.py);
        context.lineTo(x, y);
        context.stroke();
      }
      particle.px = x;
      particle.py = y;
    }
    context.globalAlpha = 1;
    output.fillStyle = colors.background;
    output.fillRect(0, 0, width, height);
    output.drawImage(trail, 0, 0);
    output.fillStyle = colors.background;
    output.beginPath();
    output.arc(centerX, centerY, ringRadius(), 0, Math.PI * 2);
    output.fill();
    output.lineWidth = dpr;
    output.strokeStyle = colors.graphite;
    output.globalAlpha = 0.35;
    output.beginPath();
    output.arc(centerX, centerY, ringRadius(), 0, Math.PI * 2);
    output.stroke();
    output.globalAlpha = 1;
    for (const ripple of ripples) {
      output.strokeStyle = colors.orange;
      output.globalAlpha = ripple.life * 0.5;
      output.beginPath();
      output.ellipse(centerX, centerY, ripple.radius, ripple.radius * TILT, 0, 0, Math.PI * 2);
      output.stroke();
    }
    for (const flash of flashes) {
      output.fillStyle = flash.color;
      output.globalAlpha = Math.max(0, flash.life);
      output.beginPath();
      output.arc(centerX + Math.cos(flash.a) * ringRadius(), centerY + Math.sin(flash.a) * ringRadius(), 2.4 * dpr, 0, Math.PI * 2);
      output.fill();
    }
    output.globalAlpha = 1;
    const beat = 1 + 0.12 * Math.sin(time * 2.1);
    output.fillStyle = colors.orange;
    output.beginPath();
    output.arc(centerX, centerY, coreRadius() * beat, 0, Math.PI * 2);
    output.fill();
  };

  const warm = () => {
    for (let index = 0; index < 6 * FPS; index += 1) {
      step(DT);
      draw(0.12);
    }
  };

  const loop = (now: number) => {
    animation = 0;
    if (!visible || document.hidden || reduced) return;
    step(DT);
    draw(0.12);
    frames += 1;
    if (!fpsStart) fpsStart = now;
    if (now - fpsStart > 2000) {
      if (frames / ((now - fpsStart) / 1000) < 50 && particles.length > 600) particles.length = Math.max(600, Math.floor(particles.length / 2));
      frames = 0;
      fpsStart = now;
    }
    animation = requestAnimationFrame(loop);
  };

  const start = () => {
    if (!reduced && visible && !document.hidden && !animation) animation = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
  };

  resize();
  warm();
  draw(0);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start(); else stop();
  }, { threshold: 0.01 });
  visibilityObserver.observe(canvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  if (reduced) return;
  start();
}

export function initVortex() {
  document.querySelectorAll<HTMLCanvasElement>('[data-vortex]').forEach(initCanvas);
}
