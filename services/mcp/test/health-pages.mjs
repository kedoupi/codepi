import assert from 'node:assert/strict';

export async function healthData(fixture, token, name, args = {}) {
  const chunks = [];
  let cursor, totalBytes, asOf;
  for (let index = 0; index < 200; index++) {
    const result = await fixture.tool(token, name, { ...args, ...(cursor ? { cursor } : {}) });
    assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
    const data = result.structuredContent;
    assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 12 * 1024);
    if (index === 0 && !data.pagination) return data;
    const page = data.pagination;
    assert.equal(page.format, 'health_data_json_v1');
    assert.equal(page.cursor, cursor ?? null);
    assert.equal(page.chunk_bytes, Buffer.byteLength(page.chunk));
    totalBytes ??= page.total_bytes;
    asOf ??= data.as_of;
    assert.equal(page.total_bytes, totalBytes);
    assert.equal(data.as_of, asOf);
    chunks.push(page.chunk);
    if (page.complete) {
      assert.equal(page.next_cursor, null);
      const complete = chunks.join('');
      assert.equal(Buffer.byteLength(complete), totalBytes);
      return JSON.parse(complete);
    }
    assert.equal(typeof page.next_cursor, 'string');
    assert.notEqual(page.next_cursor, cursor);
    cursor = page.next_cursor;
  }
  assert.fail('Health tool pagination did not finish');
}
