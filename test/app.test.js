const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { setTimeout: pause } = require('node:timers/promises');

test('main IPC: automatic collection, selection event, MD import, QR, saved titles, confirmed clear and restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clipharbor-app-test-'));
  const app = new EventEmitter(), handlers = {}, events = [];
  let clipboardText = '', response = 0, importFiles = [], importOptions, ready, failSave = false;
  Object.assign(app, { setName() {}, requestSingleInstanceLock: () => true, getPath: () => directory, quit() {}, whenReady: () => ({ then: fn => { ready = fn; } }) });
  const webContents = { send: (name, value) => events.push({ name, value }), setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} }, mainFrame: {} };
  const fakeElectron = { app, BrowserWindow: class { constructor() { this.webContents = webContents; } isDestroyed() { return false; } loadFile() {} }, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    clipboard: { readText: () => clipboardText, writeText: text => { clipboardText = text; } },
    dialog: { showOpenDialog: async (_win, options) => { importOptions = options; return { filePaths: importFiles }; }, showMessageBox: async () => ({ response }), showErrorBox: () => assert.fail('unexpected storage error') }, shell: { showItemInFolder() {} } };
  const filename = path.resolve('src/main.js'), localRequire = createRequire(filename);
  const mainFS = { ...fs, writeFileSync: (...args) => { if (failSave) { failSave = false; throw Error('disk full'); } return fs.writeFileSync(...args); } };
  const boot = () => { new Function('require', '__dirname', fs.readFileSync(filename, 'utf8'))(name => name === 'electron' ? fakeElectron : name === 'node:fs' ? mainFS : localRequire(name), path.dirname(filename)); ready(); };
  const invoke = async (action, value) => { const result = await handlers.action({ sender: webContents, senderFrame: webContents.mainFrame }, action, value); if (result.error) throw Error(result.error); return result.value; };
  try {
    boot(); await invoke('settings', { n: 2, m: 3 });
    await invoke('monitor', true);
    const link = i => `magnet:?xt=urn:btih:${String(i).padStart(40, '0')}`;
    clipboardText = link(1); await pause(350);
    assert.equal((await invoke('state')).groups[0].links.length, 1);
    clipboardText = `${link(2)}\n${link(3)}`; await pause(350);
    let state = await invoke('state'); assert.equal(state.groups.length, 2);
    assert.equal(events.filter(e => e.value?.selectedId).at(-1).value.selectedId, state.groups[1].id);
    await invoke('copy', state.groups[1].id); await pause(350); assert.equal((await invoke('state')).groups.length, 2);
    await invoke('monitor', false);
    const file = path.join(directory, 'import.md'); fs.writeFileSync(file, `[test](${link(4)})`); importFiles = [file];
    failSave = true; await assert.rejects(invoke('import'), /disk full/);
    assert.equal((await invoke('state')).groups.length, 2);
    const imported = await invoke('import'); assert.ok(importOptions.filters[0].extensions.includes('md'));
    await invoke('rename', { id: imported, name: 'Edited title' });
    assert.ok((await invoke('linkQR', link(4))).startsWith('data:image/png;base64,'));
    state = await invoke('state'); assert.equal(state.stateFile, path.join(directory, 'groups.json'));
    assert.equal(JSON.parse(fs.readFileSync(state.stateFile)).groups.at(-1).name, 'Edited title');
    await invoke('shareText', 'test text');
    const original = path.join(directory, 'original.txt'); fs.writeFileSync(original, 'keep me');
    const received = path.join(directory, 'received', 'test'); fs.writeFileSync(received, 'received');
    response = 0; assert.equal(await invoke('clearAll'), false); assert.ok(fs.existsSync(received)); assert.equal((await invoke('state')).groups.length, 3);
    response = 1; assert.equal(await invoke('clearAll'), true);
    state = await invoke('state'); assert.equal(state.groups.length, 1); assert.equal(state.groups[0].links.length, 0); assert.equal(state.transfers.length, 0);
    assert.deepEqual(state.settings, { n: 2, m: 3 }); assert.ok(fs.existsSync(original)); assert.equal(fs.existsSync(received), false);
    app.emit('before-quit'); boot(); assert.equal((await invoke('state')).groups.length, 1);
  } finally { app.emit('before-quit'); fs.rmSync(directory, { recursive: true, force: true }); }
});
