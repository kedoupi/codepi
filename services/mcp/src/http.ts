export class HttpError extends Error {
  constructor(public code: string, public status = 400,
    public details: { field?: string; reason?: string } = {}) { super(code); }
  get field() { return this.details.field ?? ""; }
  get reason() { return this.details.reason ?? ""; }
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function boundedText(request: Request, limit = 32768): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError("request_too_large", 413);
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}

export async function form(request: Request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new HttpError("invalid_request");
  }
  return new URLSearchParams(await boundedText(request));
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function sameOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new HttpError("origin_not_allowed", 403);
}
