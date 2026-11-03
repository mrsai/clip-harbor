const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { createState, addLinks, findGroup, allLinks, validateSettings } = require('./groups');
const { TransferServer } = require('./server');
app.setName('ClipHarbor');

let win, state, stateFile, transfer, timer, lastClipboard = '', clipboardBusy = false, clipboardRevision = 0;
function save() {
  fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), 'utf8');
  fs.renameSync(`${stateFile}.tmp`, stateFile);
}
function notify() { if (win && !win.isDestroyed()) win.webContents.send('changed'); }
async function copy(text) { clipboardRevision++; lastClipboard = text; await clipboard.writeText(text); }
function importText(text, source, name) {
  const id = addLinks(state, text, source, name);
  if (id) { save(); notify(); }
  return id;
}
async function setMonitor(enabled) {
  clearInterval(timer); timer = null;
  if (enabled) {
    lastClipboard = ''; // Capture the current clipboard once on explicit activation.
    timer = setInterval(async () => {
      if (clipboardBusy) return;
      clipboardBusy = true;
      try {
        const revision = clipboardRevision;
        const text = await clipboard.readText();
        if (revision !== clipboardRevision || !timer) return;
        if (text !== lastClipboard) { lastClipboard = text; importText(text, 'clipboard'); }
      } catch (e) { win?.webContents.send('app-error', e.message); }
      finally { clipboardBusy = false; }
    }, 600);
  }
  notify();
}
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
}
const actions = {
  state: () => ({ ...state, monitoring: !!timer, transfers: transfer.list() }),
  monitor: enabled => setMonitor(!!enabled),
  settings: settings => { state.settings = validateSettings(settings); save(); },
  paste: async () => importText(await clipboard.readText(), 'clipboard'),
  import: async () => {
    const result = await dialog.showOpenDialog(win, { title: '导入链接文本文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '文本文件', extensions: ['txt', 'log', 'csv'] }, { name: '所有文件', extensions: ['*'] }] });
    let id = null;
    for (const file of result.filePaths) {
      if (fs.statSync(file).size > 20 * 1024 ** 2) throw new Error('链接文本文件不能超过 20 MB');
      id = importText(decodeText(fs.readFileSync(file)), 'file', path.basename(file)) || id;
    }
    return id;
  },
  copy: async id => copy(allLinks(findGroup(state, id)).join('\r\n')),
  copyText: async text => { if (typeof text !== 'string') throw new Error('无效文本'); await copy(text); },
  rename: ({ id, name }) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('名称长度应为 1–100 字');
    findGroup(state, id).name = name.trim(); save(); notify();
  },
  remove: id => {
    if (id === 'common') state.groups[0].links = [];
    else {
      state.groups = state.groups.filter(g => g.id !== id);
      state.groups.forEach(g => { g.children = g.children.filter(c => c.id !== id); });
    }
    save(); notify();
  },
  lan: async enabled => { if (enabled) await transfer.start(); else await transfer.stop(); notify(); return actions.connection(); },
  connection: async () => {
    const info = transfer.info();
    return { ...info, codes: await Promise.all(info.urls.map(url => QRCode.toDataURL(url, { width: 240, margin: 2 }))) };
  },
  shareText: text => transfer.addText(text),
  shareGroup: id => transfer.addText(allLinks(findGroup(state, id)).join('\r\n')),
  shareFiles: async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    result.filePaths.forEach(file => transfer.addFile(file));
  },
  saveFile: async id => {
    const item = transfer.items.find(i => i.id === id && i.type === 'file');
    if (!item) throw new Error('文件不存在');
    const result = await dialog.showSaveDialog(win, { defaultPath: item.name });
    if (!result.canceled) await fs.promises.copyFile(item.diskPath, result.filePath);
  }
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    stateFile = path.join(app.getPath('userData'), 'groups.json');
    state = createState();
    if (fs.existsSync(stateFile)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        validateSettings(loaded.settings);
        if (!Array.isArray(loaded.groups) || loaded.groups[0]?.id !== 'common') throw new Error('数据格式异常');
        state = loaded;
      } catch (e) {
        dialog.showErrorBox('读取历史失败', `原始文件已保留，请先备份：${stateFile}\n${e.message}`);
        app.quit(); return;
      }
    }
    transfer = new TransferServer(path.join(app.getPath('userData'), 'received'), notify);
    win = new BrowserWindow({ width: 1200, height: 820, minWidth: 900, minHeight: 620, backgroundColor: '#f6f7f9', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ipcMain.handle('action', async (event, action, value) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !Object.hasOwn(actions, action)) throw new Error('无效请求');
      try { return { value: await actions[action](value) }; }
      catch (e) { return { error: e.message }; }
    });
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { clearInterval(timer); transfer?.stop(); });
}
