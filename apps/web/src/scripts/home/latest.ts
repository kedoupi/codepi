export interface LatestPost {
  slug: string;
  title: string;
  summary: string;
  category: string | null;
  published_at: string | null;
  reading_minutes: number | null;
  body_chars: number | null;
}

export interface LatestData {
  primary: LatestPost;
  secondary: LatestPost | null;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function property(value: object, key: string) {
  return key in value ? Reflect.get(value, key) : undefined;
}

function normalizePost(value: unknown): LatestPost | null {
  if (!value || typeof value !== 'object') return null;
  const slug = text(property(value, 'slug'));
  const title = text(property(value, 'title'));
  if (!slug || !title) return null;
  return {
    slug,
    title,
    summary: text(property(value, 'summary')) ?? '',
    category: text(property(value, 'category')) ?? text(property(value, 'tag')),
    published_at: text(property(value, 'published_at')),
    reading_minutes: Number.isFinite(Number(property(value, 'reading_minutes'))) ? Number(property(value, 'reading_minutes')) : null,
    body_chars: Number.isFinite(Number(property(value, 'body_chars'))) ? Number(property(value, 'body_chars')) : null,
  };
}

/** Converts an HTTP response into the optional homepage data block. */
export function parseLatestResponse(status: number, ok: boolean, responseText: string): LatestData | null {
  if (!ok || status < 200 || status >= 300) return null;
  try {
    const response: unknown = JSON.parse(responseText);
    const posts = Array.isArray(response)
      ? response
      : response && typeof response === 'object' && 'posts' in response && Array.isArray(response.posts)
        ? response.posts
        : null;
    if (!posts) return null;
    const normalized = posts.map(normalizePost).filter((post): post is LatestPost => post !== null).slice(0, 2);
    if (!normalized.length) return null;
    return { primary: normalized[0], secondary: normalized[1] ?? null };
  } catch {
    return null;
  }
}
