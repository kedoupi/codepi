import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyRedirects } from '../shared/privacy-redirects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: 'https://calc.kdp.cool',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  redirects: privacyRedirects,
  integrations: [tailwind(), sitemap()],
  vite: {
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
        '@site': path.resolve(__dirname, 'src'),
      },
    },
  },
});
