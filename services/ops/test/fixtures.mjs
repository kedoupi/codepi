import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export function bucketFixture() {
  const data = new Map(), uploads = [], events = [];
  const body = value => ({
    ...value,
    body: new Response(value.bytes).body,
    arrayBuffer: async () => { throw new Error('backup must not buffer an entire R2 object'); },
    json: async () => JSON.parse(value.bytes.toString()),
  });
  const bucket = {
    data, uploads, events,
    async head(key) { return data.has(key) ? body(data.get(key)) : null; },
    async get(key) { return this.head(key); },
    async put(key, value, options = {}) {
      const bytes = Buffer.from(value);
      const row = { bytes, size: bytes.length, etag: createHash('sha256').update(bytes).digest('hex'), ...options };
      data.set(key, row);
      events.push({ type: 'put', key, size: bytes.length });
      return body(row);
    },
    async createMultipartUpload(key, options) {
      const parts = new Map();
      const upload = { key, aborted: false, completed: false,
        async uploadPart(number, value) {
          const bytes = Buffer.from(value), etag = createHash('sha256').update(bytes).digest('hex');
          parts.set(number, { bytes, etag });
          events.push({ type: 'part', number, size: bytes.length });
          return { partNumber: number, etag };
        },
        async complete(list) {
          assert.equal(upload.aborted, false);
          list.forEach((part, i) => {
            assert.equal(part.partNumber, i + 1);
            assert.equal(parts.get(part.partNumber)?.etag, part.etag);
            if (i < list.length - 1) assert.equal(parts.get(part.partNumber).bytes.length, 5 * 1024 * 1024);
          });
          const result = await bucket.put(key, Buffer.concat(list.map(p => parts.get(p.partNumber).bytes)), options);
          upload.completed = true;
          events.push({ type: 'complete', key });
          return result;
        },
        async abort() { upload.aborted = true; events.push({ type: 'abort', key }); },
      };
      uploads.push(upload);
      return upload;
    },
  };
  return bucket;
}

export function exportRequest(makeBody, onExport = () => {}) {
  return async (url, init) => {
    assert.equal(init.redirect, 'manual');
    if (new URL(url).hostname === 'api.cloudflare.com') {
      onExport();
      return Response.json({ success: true, result: { status: 'complete',
        result: { signed_url: 'https://export.r2.cloudflarestorage.com/synthetic?SECRET' } } });
    }
    return new Response(makeBody());
  };
}
