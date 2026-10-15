let checking = false;
let expired = false;

function expirePreview() {
  if (expired) return;
  expired = true;
  document.documentElement.replaceChildren();
  const next = location.pathname + location.search + location.hash;
  location.replace(`/login?next=${encodeURIComponent(next)}`);
}

async function checkSession() {
  if (checking || expired) return;
  checking = true;
  try {
    const response = await fetch("/api/me", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401) {
      expirePreview();
      return;
    }
    if (!response.ok) return;
    const session = await response.json() as { authenticated?: boolean } | null;
    if (session?.authenticated === false) expirePreview();
  } catch {
    // An unavailable session service does not confirm revocation; retry on the next check.
  } finally {
    checking = false;
  }
}

window.addEventListener("focus", () => { void checkSession(); });
window.addEventListener("pageshow", () => { void checkSession(); });
window.setInterval(() => { void checkSession(); }, 30_000);
void checkSession();

export {};
