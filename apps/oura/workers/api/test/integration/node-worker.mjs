import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Node needs the same text-module handling that Wrangler provides in Workers.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../dist/index.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  loader: { '.css': 'text' },
});
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
export default worker;
