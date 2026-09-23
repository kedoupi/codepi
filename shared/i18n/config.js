export const defaultLocale = 'en';

export const locales = [
  { code: 'en', label: 'English', shortLabel: 'EN', htmlLang: 'en', dir: 'ltr' },
  { code: 'zh', label: '中文', shortLabel: '中文', htmlLang: 'zh-CN', dir: 'ltr' },
  { code: 'es', label: 'Español', shortLabel: 'ES', htmlLang: 'es', dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी', shortLabel: 'HI', htmlLang: 'hi', dir: 'ltr' },
  { code: 'ar', label: 'العربية', shortLabel: 'AR', htmlLang: 'ar', dir: 'rtl' },
  { code: 'pt', label: 'Português', shortLabel: 'PT', htmlLang: 'pt', dir: 'ltr' },
  { code: 'fr', label: 'Français', shortLabel: 'FR', htmlLang: 'fr', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', shortLabel: 'DE', htmlLang: 'de', dir: 'ltr' },
  { code: 'ja', label: '日本語', shortLabel: 'JA', htmlLang: 'ja', dir: 'ltr' },
];

export const localeCodes = locales.map((locale) => locale.code);
export const translatedLocaleCodes = localeCodes.filter((code) => code !== defaultLocale);

export function getLocale(code = defaultLocale) {
  return locales.find((locale) => locale.code === code) ?? locales[0];
}

export function isSupportedLocale(code) {
  return localeCodes.includes(code);
}

export function stripLocale(pathname = '/') {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length > 0 && translatedLocaleCodes.includes(parts[0])) {
    return `/${parts.slice(1).join('/')}${normalized.endsWith('/') ? '/' : ''}`.replace(/\/+/g, '/') || '/';
  }
  return normalized;
}

export function localizedPath(pathname = '/', locale = defaultLocale) {
  const base = stripLocale(pathname);
  if (locale === defaultLocale) return base;
  if (base === '/') return `/${locale}/`;
  return `/${locale}${base}`;
}
