import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true,
  format: 'esm', platform: 'neutral', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], logLevel: 'info',
});
