export const PRODUCT_BRAND = "kedoupi（codepi）";

/**
 * CodePi official wordmark images (v2.0.0 export master).
 *
 * The source export is a 1800 x 500 raster with 453px of empty space on the
 * right. The web assets below crop that dead space and un-matte the warm-white
 * or dark export background, leaving 32-bit RGBA images at 1288 x 316.
 *
 * Keep the dimensions and the `srcset` descriptors in sync with the files in
 * apps/web/public/brand/. Do not use the candidate wordmark SVGs in the UI.
 */
export const CODEPI_LOGO_PNG = "/brand/codepi-logo.png";
export const CODEPI_LOGO_WEBP = "/brand/codepi-logo.webp";
export const CODEPI_LOGO_450W_PNG = "/brand/codepi-logo-450w.png";
export const CODEPI_LOGO_450W_WEBP = "/brand/codepi-logo-450w.webp";
export const CODEPI_LOGO_900W_PNG = "/brand/codepi-logo-900w.png";
export const CODEPI_LOGO_900W_WEBP = "/brand/codepi-logo-900w.webp";
export const CODEPI_LOGO_LIGHT_PNG = CODEPI_LOGO_PNG;
export const CODEPI_LOGO_DARK_PNG = "/brand/codepi-logo-dark.png";
export const CODEPI_LOGO_WIDTH = 1288;
export const CODEPI_LOGO_HEIGHT = 316;
export const CODEPI_LOGO_ASPECT_RATIO = "1288 / 316";

/** Visible wordmark text; set as "Code" in graphite and "Pi" in brand orange. */
export const BRAND_WORDMARK = "CodePi";

/**
 * CodePi symbol (C + π + `</>`), rasterized from the same official PNG export
 * as the wordmark. Use it when the full lockup would be too small or when the
 * page already renders the CodePi text separately.
 */
export const CODEPI_SYMBOL_PNG = "/brand/codepi-symbol.png";
export const CODEPI_SYMBOL_WEBP = "/brand/codepi-symbol.webp";
export const CODEPI_SYMBOL_DARK_PNG = "/brand/codepi-symbol-dark.png";
export const CODEPI_SYMBOL_WIDTH = 348;
export const CODEPI_SYMBOL_HEIGHT = 316;
export const CODEPI_SYMBOL_ASPECT_RATIO = "348 / 316";
export const CODEPI_SYMBOL_SQUARE_PNG = "/brand/codepi-symbol-512.png";
