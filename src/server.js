const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const Busboy = require('busboy');

const MAX_FILE = 2 * 1024 ** 3;
async function readText(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('文本不能超过 1 MB');
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}
class TransferServer {
  constructor(directory, onChange = () => {}) {
    this.directory = directory; this.onChange = onChange; this.items = [];
    fs.mkdirSync(directory, { recursive: true });
  }
  list() { return this.items.map(({ diskPath, ...item }) => item); }
  addText(text, from = '电脑') {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 1024 * 1024) throw new Error('请输入不超过 1 MB 的文本');
    this.items.unshift({ id: randomUUID(), type: 'text', text, from, created: Date.now() });
    this.onChange();
  }
  addFile(diskPath, name = path.basename(diskPath), from = '电脑') {
    const stat = fs.statSync(diskPath);
    if (!stat.isFile()) throw new Error('请选择文件');
    this.items.unshift({ id: randomUUID(), type: 'file', name, size: stat.size, diskPath, from, created: Date.now() });
    this.onChange();
  }
  async upload(req) {
    const parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 20, fileSize: MAX_FILE, fields: 0, parts: 21 } });
    const pending = [], staged = [];
    let invalid = false;
    parser.on('filesLimit', () => { invalid = true; });
    parser.on('partsLimit', () => { invalid = true; });
    parser.on('fieldsLimit', () => { invalid = true; });
    parser.on('file', (_field, stream, info) => {
      const diskPath = path.join(this.directory, randomUUID());
      const item = { diskPath, name: path.basename(info.filename.replace(/\\/g, '/')) || '未命名文件' };
      staged.push(item);
      stream.on('limit', () => { invalid = true; });
      pending.push(pipeline(stream, fs.createWriteStream(diskPath, { flags: 'wx' })).catch(() => { invalid = true; }));
    });
    try {
      await pipeline(req, parser);
      await Promise.all(pending);
      if (invalid || !staged.length) throw new Error('上传失败：每次最多 20 个文件，单文件不超过 2 GB');
      for (const item of staged) this.addFile(item.diskPath, item.name, '手机');
    } catch (error) {
      parser.destroy();
      await Promise.all(pending);
      for (const item of staged) fs.rmSync(item.diskPath, { force: true });
      throw error;
    }
  }
  async start(host = '0.0.0.0') {
    if (this.server) return this.info();
    this.token = randomBytes(24).toString('hex');
    this.server = http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
      const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
      try {
        const url = new URL(req.url, 'http://localhost');
        const prefix = `/${this.token}/`;
        if (!url.pathname.startsWith(prefix)) return send(403, { error: '无效的访问码，请重新扫码' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: '禁止跨站请求' });
        const route = url.pathname.slice(prefix.length);
        if (req.method === 'GET' && ['', 'phone.js', 'style.css'].includes(route)) {
          const file = route || 'phone.html';
          res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/javascript' });
          return fs.createReadStream(path.join(__dirname, 'ui', file)).pipe(res);
        }
        if (route === 'api/items' && req.method === 'GET') return send(200, this.list());
        if (route === 'api/text' && req.method === 'POST') { this.addText(await readText(req), '手机'); return send(201, { ok: true }); }
        if (route === 'api/upload' && req.method === 'POST') { await this.upload(req); return send(201, { ok: true }); }
        if (route.startsWith('download/') && req.method === 'GET') {
          const item = this.items.find(i => i.id === route.slice(9) && i.type === 'file');
          if (!item) return send(404, { error: '文件不存在' });
          const stat = await fs.promises.stat(item.diskPath);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name).replace(/'/g, '%27')}` });
          await pipeline(fs.createReadStream(item.diskPath), res);
          return;
        }
        send(404, { error: '页面不存在' });
      } catch (error) {
        if (!res.headersSent && !res.destroyed) send(400, { error: error.message });
        else res.destroy();
      }
    });
    this.server.requestTimeout = 30 * 60 * 1000;
    try {
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, host, resolve); });
    } catch (error) { this.server = null; throw error; }
    this.server.on('error', () => this.onChange());
    return this.info();
  }
  info() {
    if (!this.server?.listening) return { running: false, urls: [] };
    const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
    return { running: true, urls: [...new Set(addresses)].map(ip => `http://${ip}:${this.server.address().port}/${this.token}/`) };
  }
  async stop() {
    if (!this.server) return;
    const server = this.server; this.server = null;
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}
module.exports = { TransferServer };
