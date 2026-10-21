import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyRedirects } from '@kedoupi/shared/privacy-redirects.js';
import { ignoreDoorwayLocales } from '@kedoupi/shared/sitemap-filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: 'https://codepi.app',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  redirects: privacyRedirects,
  integrations: [tailwind(), sitemap({ filter: (page) => {
    const pathname = new URL(page).pathname;
    return ignoreDoorwayLocales(page) && !pathname.startsWith('/desk/') && !pathname.startsWith('/prototype/');
  } })],
  vite: {
    resolve: {
      alias: {
        '@site': path.resolve(__dirname, 'src'),
      },
    },
  },
});
