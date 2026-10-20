import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Direct handler tests need a Node-compatible bundle of the Worker entry.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../dist/index.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  plugins: [{
    name: 'node-entrypoint-base',
    setup(build) {
      // Direct handler tests do not exercise RPC. The real multi-Worker tests do.
      build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'workers', namespace: 'node-test' }));
      build.onLoad({ filter: /.*/, namespace: 'node-test' }, () => ({
        contents: 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }',
      }));
    },
  }],
});
const { default: worker, HealthMcp } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
export default worker;
export { HealthMcp };
