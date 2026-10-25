import tokens from "@kedoupi/shared/styles/tokens.css";
import { PRODUCT_BRAND } from "@kedoupi/shared/brand";
import { escapeHtml } from "./http.ts";

export function contentSecurityPolicy(callbackOrigin?: string) {
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'`;
}

export function page(title: string, body: string, callbackOrigin?: string, refreshTarget?: string) {
  const refresh = refreshTarget ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(refreshTarget)}">` : "";
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${refresh}
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · CodePi MCP</title>
<style>${tokens}
*{box-sizing:border-box}body{margin:0;min-height:100svh;padding:24px;background:var(--kdp-canvas);color:var(--kdp-ink);font:16px/1.7 var(--kdp-font)}
main{max-width:640px;margin:8vh auto;background:var(--kdp-surface);border:1px solid var(--kdp-line);border-radius:var(--kdp-radius-lg);padding:28px}
h1{font-size:1.7rem}p,li{overflow-wrap:anywhere}code{overflow-wrap:anywhere}a{color:var(--kdp-accent)}
label{display:block;margin:12px 0}input:not([type=checkbox]),textarea,select{display:block;width:100%;max-width:100%;box-sizing:border-box;font:inherit;background:var(--kdp-canvas);color:var(--kdp-ink);border:1px solid var(--kdp-line);border-radius:var(--kdp-radius-sm);padding:8px}textarea{min-height:100px}article,section{margin:24px 0;padding:16px;border:1px solid var(--kdp-line);border-radius:var(--kdp-radius-sm)}
button{font:inherit;min-height:44px;padding:10px 20px;border:1px solid var(--kdp-line);border-radius:var(--kdp-radius-sm);background:var(--kdp-surface);color:var(--kdp-accent);cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--kdp-focus);outline-offset:3px}.approve{background:var(--kdp-accent);color:white}.actions{display:flex;gap:12px;flex-wrap:wrap}li{margin:12px 0}
</style></head><body><main><a href="https://codepi.app/">${escapeHtml(PRODUCT_BRAND)}</a><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": contentSecurityPolicy(callbackOrigin) },
  });
}

export function hidden(fields: Record<string, string>) {
  return Object.entries(fields).map(([key, value]) =>
    `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
}
