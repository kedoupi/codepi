import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'https://health.codepi.app').origin;

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
    const png = await asset('/brand/codepi-symbol.png', /^image\/png\b/);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'codepi-symbol.png: invalid PNG');
    assert.equal(png.readUInt32BE(16), 348, 'codepi-symbol.png: expected width 348');
    assert.equal(png.readUInt32BE(20), 316, 'codepi-symbol.png: expected height 316');
  })(),
  (async () => {
    const ico = await asset('/favicon.ico', /^image\/(?:x-icon|vnd\.microsoft\.icon)\b/);
    assert.equal(ico.subarray(0, 4).toString('hex'), '00000100', 'favicon.ico: invalid ICO');
    assert.ok(ico.readUInt16LE(4) >= 1, 'favicon.ico: no images');
  })(),
  (async () => {
    const png = await asset('/favicon-32.png', /^image\/png\b/);
    assert.equal(png.readUInt32BE(16), 32, 'favicon-32.png: expected width 32');
    assert.equal(png.readUInt32BE(20), 32, 'favicon-32.png: expected height 32');
  })(),
  (async () => {
    const png = await asset('/apple-touch-icon.png', /^image\/png\b/);
    assert.equal(png.readUInt32BE(16), 180, 'apple-touch-icon.png: expected width 180');
    assert.equal(png.readUInt32BE(20), 180, 'apple-touch-icon.png: expected height 180');
  })(),
  (async () => {
    const html = (await asset('/', /^text\/html\b/)).toString();
    assert.match(html, /rel="icon"[^>]+href="\/favicon-32\.png"/);
    assert.match(html, /rel="icon"[^>]+href="\/favicon-16\.png"/);
    assert.match(html, /rel="icon"[^>]+href="\/favicon\.ico"/);
    assert.match(html, /rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/);
  })(),
]);
console.log(`PASS ${origin}: public PNG icons, symbol PNG, ICO and page icon links`);
