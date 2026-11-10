import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const shim = pathToFileURL(path.resolve(new URL('./cloudflare-workers-shim.mjs', import.meta.url).pathname)).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: shim, shortCircuit: true };
  if (specifier.startsWith('@kedoupi/shared/')) {
    const subpath = specifier.slice('@kedoupi/shared/'.length);
    return { url: pathToFileURL(path.join(root, 'packages/shared', `${subpath}.ts`)).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const parent = new URL(context.parentURL);
    const candidate = new URL(`${specifier}.ts`, parent);
    return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
