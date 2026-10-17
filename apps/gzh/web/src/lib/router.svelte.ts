export type Route = "login" | "desk" | "preview";

export function routeOf(pathname: string): Route {
  if (pathname.startsWith("/login")) return "login";
  if (pathname.startsWith("/p/")) return "preview";
  return "desk";
}

export function validRoute(pathname: string): Route {
  return routeOf(pathname);
}

export function previewSlug(pathname: string): string {
  const match = pathname.match(/^\/p\/([a-z0-9][a-z0-9-]{0,63})\/?$/);
  return match?.[1] ?? "";
}
