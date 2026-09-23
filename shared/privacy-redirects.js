/**
 * Canonical privacy URL is /privacy/.
 * /privacy-policy/ is an alias so AdSense / crawler checks that hit the
 * longer slug land on one page instead of a 404 or a second indexable URL.
 */
export const privacyRedirects = {
  '/privacy-policy/': '/privacy/',
};
