const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { createState, addLinks, findGroup, allLinks, validateSettings, splitGroup, parseLinks } = require('./groups');
const { ClipboardMonitor } = require('./monitor');
const { TransferServer } = require('./server');
app.setName('ClipHarbor');

let win, state, stateFile, transfer, monitor, monitorError = '', lastCapture = null;
function save() {
  fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), 'utf8');
  fs.renameSync(`${stateFile}.tmp`, stateFile);
}
function notify(selectedId) { if (win && !win.isDestroyed()) win.webContents.send('changed', { selectedId }); }
async function copy(text) { monitor.ignore(text); await clipboard.writeText(text); }
function importText(text, source, name) {
  const count = parseLinks(text).length;
  if (!count) return null;
  const previous = structuredClone(state.groups);
  try {
    const id = addLinks(state, text, source, name);
    save(); lastCapture = { count, time: Date.now() }; notify(id);
    return id;
  } catch (error) { state.groups = previous; throw error; }
}
async function setMonitor(enabled) {
  monitorError = '';
  if (enabled) monitor.start(); else monitor.stop();
  notify();
}
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
}
const actions = {
  state: () => ({ ...state, monitoring: monitor.running, monitorError, lastCapture, stateFile, transfers: transfer.list() }),
  monitor: enabled => setMonitor(!!enabled),
  settings: settings => { state.settings = validateSettings(settings); splitGroup(state.groups[0], state.settings.m); save(); notify(); },
  storage: () => require('electron').shell.showItemInFolder(stateFile),
  paste: async () => importText(await clipboard.readText(), 'clipboard'),
  import: async () => {
    const result = await dialog.showOpenDialog(win, { title: '导入链接文本文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'text'] }, { name: '所有文件', extensions: ['*'] }] });
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
    if (id === 'common') { state.groups[0].links = []; state.groups[0].children = []; }
    else {
      state.groups = state.groups.filter(g => g.id !== id);
      state.groups.forEach(g => { g.children = g.children.filter(c => c.id !== id); });
    }
    save(); notify();
  },
  clearAll: async () => {
    const answer = await dialog.showMessageBox(win, { type: 'warning', title: '清空全部数据', message: '确定清空全部数据？', detail: '删除全部收藏、区域、互传记录和应用接收的文件。保留 n/m 设置；不删除你原先分享的源文件。此操作不可撤销。', buttons: ['取消', '清空全部'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return false;
    const wasRunning = monitor.running;
    monitor.stop();
    try {
      await transfer.stop();
      fs.rmSync(transfer.directory, { recursive: true, force: true });
      fs.mkdirSync(transfer.directory, { recursive: true });
      transfer.items = [];
      state.groups = createState().groups; lastCapture = null; save();
      // Continue watching, but don't collect the unchanged clipboard again after clearing.
      if (wasRunning) { monitor.last = await clipboard.readText(); monitor.running = true; monitor.check(monitor.session); }
      notify(); return true;
    } catch (error) { if (wasRunning) monitor.start(); throw error; }
  },
  linkQR: async text => {
    if (typeof text !== 'string' || !parseLinks(text).includes(text)) throw new Error('请选择有效链接');
    try { return await QRCode.toDataURL(text, { width: 320, margin: 2 }); }
    catch { throw new Error('链接过长，无法生成二维码，请复制或通过局域网发送'); }
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
    monitor = new ClipboardMonitor(() => clipboard.readText(), text => {
      const hadError = !!monitorError; monitorError = '';
      const id = importText(text, 'clipboard');
      if (hadError && !id) notify();
      return id;
    }, error => { monitorError = error.message; notify(); });
    splitGroup(state.groups[0], state.settings.m);
    save();
    win = new BrowserWindow({ width: 1200, height: 820, minWidth: 900, minHeight: 620, backgroundColor: '#f6f7f9', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
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
  app.on('before-quit', () => { monitor?.stop(); transfer?.stop(); });
}
