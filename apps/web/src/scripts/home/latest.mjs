const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function normalizePost(value) {
  if (!value || typeof value !== 'object') return null;
  const slug = text(value.slug);
  const title = text(value.title);
  if (!slug || !title) return null;
  return {
    slug,
    title,
    summary: text(value.summary) ?? '',
    category: text(value.category) ?? text(value.tag),
    published_at: text(value.published_at),
    reading_minutes: Number.isFinite(Number(value.reading_minutes)) ? Number(value.reading_minutes) : null,
    body_chars: Number.isFinite(Number(value.body_chars)) ? Number(value.body_chars) : null,
  };
}

/** Test adapter mirroring latest.ts; node --test cannot import .ts without strip-types. */
export function parseLatestResponse(status, ok, responseText) {
  if (!ok || status < 200 || status >= 300) return null;
  try {
    const response = JSON.parse(responseText);
    const posts = Array.isArray(response)
      ? response
      : response && typeof response === 'object' && Array.isArray(response.posts)
        ? response.posts
        : null;
    if (!posts) return null;
    const normalized = posts.map(normalizePost).filter(Boolean).slice(0, 2);
    if (!normalized.length) return null;
    return { primary: normalized[0], secondary: normalized[1] ?? null };
  } catch {
    return null;
  }
}
