import { parseLatestResponse, type LatestPost, type LatestData } from './latest';
import { initSolar } from './solar';
import { initVortex } from './vortex';

function markVisible(element: Element) {
  element.classList.add('is-visible');
}

function initViewportAnimations() {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-enter-animation], [data-glyph-section], [data-boundary-section]'));
  if (!targets.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach(markVisible);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      markVisible(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  targets.forEach((target) => observer.observe(target));
}

function readingMinutes(post: { reading_minutes: number | null; body_chars: number | null }) {
  if (post.reading_minutes && post.reading_minutes > 0) return Math.round(post.reading_minutes);
  return Math.max(1, Math.round((post.body_chars ?? 0) / 400));
}

function articleMeta(post: { category: string | null; published_at: string | null; reading_minutes: number | null; body_chars: number | null }) {
  const category = post.category ?? '随笔';
  const date = post.published_at ? ` · ${post.published_at.slice(0, 10)}` : '';
  return `${category}${date} · ${readingMinutes(post)} 分钟读完`;
}

function renderBlog(section: HTMLElement, data: LatestData) {
  const feature = section.querySelector<HTMLElement>('[data-blog-feature]');
  const secondary = section.querySelector<HTMLElement>('[data-blog-secondary]');
  if (!feature || !secondary) return;
  const primary = data.primary;
  const meta = document.createElement('span');
  meta.className = 'home-blog-meta';
  meta.textContent = articleMeta(primary);
  const title = document.createElement('h3');
  title.textContent = primary.title;
  const summary = document.createElement('p');
  summary.textContent = primary.summary;
  const link = document.createElement('a');
  link.href = `/blog/${encodeURIComponent(primary.slug)}/`;
  link.textContent = '阅读全文';
  feature.replaceChildren(meta, title, summary, link);

  if (!data.secondary) return;
  const row = document.createElement('a');
  row.href = `/blog/${encodeURIComponent(data.secondary.slug)}/`;
  const secondaryTitle = document.createElement('h3');
  secondaryTitle.textContent = data.secondary.title;
  const secondaryMeta = document.createElement('span');
  secondaryMeta.className = 'home-blog-meta';
  secondaryMeta.textContent = articleMeta(data.secondary);
  row.append(secondaryTitle, secondaryMeta);
  secondary.replaceChildren(row);
}

async function loadBlog() {
  const section = document.querySelector<HTMLElement>('[data-blog-section]');
  if (!section) return;
  try {
    const response = await fetch('/blog/latest.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const latest = parseLatestResponse(response.status, response.ok, await response.text());
    if (!latest) return;
    renderBlog(section, latest);
    section.hidden = false;
  } catch {
    // An unavailable public feed leaves the optional section hidden.
  }
}

initViewportAnimations();
initVortex();
initSolar();
void loadBlog();
