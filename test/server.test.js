const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TransferServer } = require('../src/server');
test('LAN auth, cross-origin rejection, bidirectional text/files, exact downloads, token rotation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clipharbor-'));
  const server = new TransferServer(directory);
  try {
    await server.start('127.0.0.1');
    const base = `http://127.0.0.1:${server.server.address().port}/${server.token}/`;
    assert.equal((await fetch(new URL('/api/items', base))).status, 403);
    assert.equal((await fetch(base + 'api/text', { method: 'POST', body: 'evil', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base)).status, 200);
    server.addText('电脑 → 手机');
    assert.equal((await fetch(base + 'api/text', { method: 'POST', body: '手机 → 电脑\n第二行' })).status, 201);
    let items = await (await fetch(base + 'api/items')).json();
    assert.equal(items[0].text, '手机 → 电脑\n第二行'); assert.equal(items[1].text, '电脑 → 手机');
    const body = new FormData(), bytes = Buffer.from([0, 1, 255, 128, 42]);
    body.append('files', new Blob([bytes]), '中文文件.bin');
    assert.equal((await fetch(base + 'api/upload', { method: 'POST', body })).status, 201);
    items = await (await fetch(base + 'api/items')).json();
    assert.equal(items[0].size, bytes.length); assert.equal(items[0].diskPath, undefined); assert.equal(items[0].name, '中文文件.bin');
    assert.deepEqual(Buffer.from(await (await fetch(base + 'download/' + items[0].id)).arrayBuffer()), bytes);
    const local = path.join(directory, 'local.txt'); fs.writeFileSync(local, 'desktop file'); server.addFile(local);
    assert.equal(await (await fetch(base + 'download/' + server.items[0].id)).text(), 'desktop file');
    assert.equal((await fetch(base + 'download/../../../etc/passwd')).status, 403);
    const oldToken = server.token; await server.stop(); await server.start('127.0.0.1');
    assert.notEqual(server.token, oldToken);
    assert.equal((await fetch(`http://127.0.0.1:${server.server.address().port}/${oldToken}/api/items`)).status, 403);
  } finally { await server.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
