import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'https://health.kdp.cool').origin;

// Check real public responses: a missing Pages asset can silently return SPA HTML.
async function asset(path, contentType) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${path}: expected HTTP 200 without authentication`);
  assert.match(response.headers.get('content-type') || '', contentType, `${path}: wrong MIME type`);
  return Buffer.from(await response.arrayBuffer());
}

await Promise.all([
  (async () => {
    const png = await asset('/icon.png', /^image\/png\b/);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'icon.png: invalid PNG');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 512, 'icon.png: expected width 512');
    assert.equal(png.readUInt32BE(20), 512, 'icon.png: expected height 512');
  })(),
  (async () => {
    const svg = await asset('/icon.svg', /^image\/svg\+xml\b/);
    assert.match(svg.toString(), /<svg\b/);
    assert.doesNotMatch(svg.toString(), /<script\b/i);
  })(),
  (async () => {
    const ico = await asset('/favicon.ico', /^image\/(?:x-icon|vnd\.microsoft\.icon)\b/);
    assert.equal(ico.subarray(0, 6).toString('hex'), '000001000100', 'favicon.ico: invalid ICO');
  })(),
  (async () => {
    const html = (await asset('/', /^text\/html\b/)).toString();
    assert.match(html, /rel="icon"[^>]+href="\/icon\.svg"/);
    assert.match(html, /rel="icon"[^>]+href="\/favicon\.ico"/);
  })(),
]);
console.log(`PASS ${origin}: public PNG (512x512), SVG, ICO and page icon links`);
