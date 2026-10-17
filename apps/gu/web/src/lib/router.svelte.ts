export type Page = "overview" | "positions" | "reports" | "status";

export function validHash(hash: string) {
  return /^#(?:overview|positions|status|reports(?:\/[^/#?]+)?)$/.test(hash)
    ? hash
    : "#overview";
}

export function parseHash(hash: string): { page: Page; id: string } {
  const [rawPage, rawId] = hash.slice(1).split("/");
  let id = "";
  try {
    id = rawId ? decodeURIComponent(rawId) : "";
  } catch {
    /* Unknown links return the list. */
  }
  const page = (["positions", "reports", "status"].includes(rawPage)
    ? rawPage
    : "overview") as Page;
  return { page, id };
}

export const router = $state({ hash: "#overview" });

export function syncFromLocation() {
  router.hash = validHash(location.hash);
}

export function navigate(hash: string) {
  if (location.hash === hash) return;
  location.hash = hash;
}
