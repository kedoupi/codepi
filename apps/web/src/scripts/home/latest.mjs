const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function normalizePost(value) {
  if (!value || typeof value !== 'object') return null;
  const post = value;
  const slug = text(post.slug);
  const title = text(post.title);
  if (!slug || !title) return null;
  return {
    slug,
    title,
    summary: text(post.summary) ?? '',
    category: text(post.category) ?? text(post.tag),
    published_at: text(post.published_at),
    reading_minutes: Number.isFinite(Number(post.reading_minutes)) ? Number(post.reading_minutes) : null,
    body_chars: Number.isFinite(Number(post.body_chars)) ? Number(post.body_chars) : null,
  };
}

/**
 * Converts the public latest-post response into exactly the data the homepage renders.
 * Invalid envelopes and empty published lists return null so the section stays hidden.
 */
export function parseLatestResponse(response) {
  const posts = Array.isArray(response) ? response : response && typeof response === 'object' && Array.isArray(response.posts) ? response.posts : null;
  if (!posts) return null;
  const normalized = posts.map(normalizePost).filter(Boolean).slice(0, 2);
  if (!normalized.length) return null;
  return { primary: normalized[0], secondary: normalized[1] ?? null };
}
