import { translatedLocaleCodes } from './i18n/config.js';

/** Drop locale homepages that only translate the directory, not the tools. */
export function ignoreDoorwayLocales(page) {
  const path = new URL(page).pathname;
  return !translatedLocaleCodes.some((code) => path === `/${code}/` || path.startsWith(`/${code}/`));
}
