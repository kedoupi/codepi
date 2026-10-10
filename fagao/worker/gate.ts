export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/login/") return true;
  if (pathname === "/api/health") return true;
  if (pathname === "/api/auth/request-otp" || pathname === "/api/auth/verify-otp") return true;
  if (pathname === "/favicon.ico") return true;
  if (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".woff2")
  ) {
    return true;
  }
  return false;
}

export function needsSession(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/" || pathname.startsWith("/p/") || pathname.startsWith("/previews/")) {
    return true;
  }
  return false;
}

export function isSpaPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login" || pathname === "/login/") return true;
  return /^\/p\/[a-z0-9][a-z0-9-]{0,63}\/?$/.test(pathname);
}
