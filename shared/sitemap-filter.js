import { translatedLocaleCodes } from './i18n/config.js';

/** Drop locale homepages that only translate the directory, not the tools. */
export function ignoreDoorwayLocales(page) {
  const path = new URL(page).pathname;
  return !translatedLocaleCodes.some((code) => path === `/${code}/` || path.startsWith(`/${code}/`));
}

/** Paths that now live only on kdp.cool — drop from calc.kdp.cool sitemap. */
const MOVED_TO_APEX = new Set([
  '/mortgage-calculator/',
  '/paycheck-calculator/',
  '/income-tax-calculator/',
]);

export function ignoreMovedCalcTools(page) {
  if (!ignoreDoorwayLocales(page)) return false;
  const path = new URL(page).pathname;
  return !MOVED_TO_APEX.has(path);
}

/** Drop thin filler utilities from satellite sitemaps during AdSense review. */
const REVIEW_EXCLUDED = new Set([
  '/lorem-ipsum-generator/',
]);

export function ignoreReviewExcluded(page) {
  if (!ignoreDoorwayLocales(page)) return false;
  const path = new URL(page).pathname;
  return !REVIEW_EXCLUDED.has(path);
}
