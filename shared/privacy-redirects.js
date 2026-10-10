import { translatedLocaleCodes } from './i18n/config.js';

/**
 * Canonical privacy URL is /privacy/.
 * Locale homepages only translated the directory, so they 301 to the real home.
 */
const localeHomeRedirects = Object.fromEntries(
  translatedLocaleCodes.map((code) => [`/${code}/`, { status: 301, destination: '/' }]),
);

export const privacyRedirects = {
  '/privacy-policy/': '/privacy/',
  ...localeHomeRedirects,
};
