const $ = id => document.getElementById(id);
let state, selected = 'common', connection = { running: false, urls: [] }, toastTimer, pendingSelection, deleteTarget;
const call = (action, value) => window.harbor.call(action, value);
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(text, handler, className = '') { const node = el('button', className, text); node.onclick = () => run(handler); return node; }
async function run(fn) { try { await fn(); } catch (e) { toast(e.message); } }
function links(group) { return [...group.links, ...group.children.flatMap(c => c.links)]; }
function current() { return state.groups.flatMap(g => [g, ...g.children]).find(g => g.id === selected) || state.groups[0]; }
async function refresh() {
  const nextState = await call('state');
  if (document.activeElement?.matches('.inline-title, #group-title')) { refreshQueued = true; return; }
  state = nextState;
  if (pendingSelection) { selected = pendingSelection; pendingSelection = null; }
  selected = current().id;
  $('total').textContent = state.groups.reduce((n, g) => n + links(g).length, 0);
  $('monitor').textContent = state.monitoring ? '暂停监听' : '开启监听';
  $('monitor-label').textContent = state.monitorError ? `读取失败：${state.monitorError}` : state.monitoring ? `监听中${state.lastCapture ? ` · 最近收集 ${state.lastCapture.count} 条` : ' · 等待复制'}` : '监听已暂停';
  $('storage-path').textContent = state.stateFile;
  if (document.activeElement !== $('n') && document.activeElement !== $('m')) { $('n').value = state.settings.n; $('m').value = state.settings.m; }
  $('groups').replaceChildren();
  for (const group of state.groups) {
    tree(group);
    group.children.forEach(child => tree(child, true));
  }
  renderContent(); renderTransfers();
}
function tree(group, child = false) {
  const row = el('div', `tree-row ${selected === group.id ? 'selected' : ''} ${child ? 'child-row' : ''}`);
  const choose = button('›', async () => { selected = group.id; show('links'); await refresh(); }, 'tree-select');
  choose.setAttribute('aria-label', `查看 ${group.name}`);
  const title = editableTitle(group);
  title.onfocus = () => { selected = group.id; show('links'); renderContent(); };
  const copy = button('⧉', async () => { await call('copy', group.id); toast('区域链接已复制'); }, 'tree-copy'); copy.title = `复制 ${group.name}`; copy.setAttribute('aria-label', copy.title);
  row.append(choose, title, el('span', 'muted', String(links(group).length)), copy); $('groups').append(row);
}
function editableTitle(group) {
  const input = el('input', 'inline-title'); input.value = group.name; input.maxLength = 100;
  input.setAttribute('aria-label', `区域名称 ${group.name}`);
  input.onchange = () => run(async () => { try { await call('rename', { id: group.id, name: input.value }); } catch (e) { input.value = group.name; throw e; } });
  input.onkeydown = event => { if (event.key === 'Enter') input.blur(); };
  return input;
}
function displayName(link) {
  try {
    if (/^magnet:/i.test(link)) return new URL(link).searchParams.get('dn') || '未命名磁力链接';
    return decodeURIComponent(link.split('|')[2]);
  } catch { return '未命名链接'; }
}
function renderContent() {
  const group = current();
  if (document.activeElement !== $('group-title')) { $('group-title').value = group.name; $('group-title').dataset.id = group.id; }
  $('group-count').textContent = `${links(group).length} 条`;
  $('remove').textContent = group.id === 'common' ? '清空' : '删除';
  const container = $('content'); container.replaceChildren();
  if (group.children.length) {
    const grid = el('div', 'subgroups');
    for (const child of group.children) {
      const card = el('div', 'subgroup-card');
      card.append(editableTitle(child), el('span', 'muted', `${child.links.length} 条`), button('查看', async () => { selected = child.id; await refresh(); }), button('复制', async () => { await call('copy', child.id); toast('已复制'); })); grid.append(card);
    }
    container.append(grid); return;
  }
  if (!group.links.length) {
    const empty = el('div', 'empty');
    empty.append(el('p', '', '开启监听后复制 Magnet / ed2k 链接，或导入 TXT、MD 等文本。')); container.append(empty); return;
  }
  const list = el('div', 'link-list');
  group.links.forEach((link, i) => {
    const row = el('div', 'link-row'), info = el('div', 'link-info');
    const title = el('strong', '', displayName(link)); title.title = title.textContent;
    const code = el('code', '', link); code.title = link; info.append(title, code);
    row.append(el('span', 'link-num', String(i + 1)), info, button('二维码', async () => { $('link-qr').src = await call('linkQR', link); $('qr-link-text').value = link; $('link-qr-dialog').showModal(); }), button('复制', async () => { await call('copyText', link); toast('链接已复制'); })); list.append(row);
  }); container.append(list);
}
function renderTransfers() {
  $('transfers').replaceChildren();
  if (!state.transfers.length) { $('transfers').append(el('p', '', '还没有传输记录，先发送一段文字吧。')); return; }
  for (const item of state.transfers) {
    const row = el('div', 'transfer-item'), details = el('div', 'details');
    details.append(el('strong', '', item.type === 'file' ? item.name : item.text), el('small', '', `${item.from} · ${new Date(item.created).toLocaleTimeString()}${item.size !== undefined ? ` · ${(item.size / 1024 / 1024).toFixed(2)} MB` : ''}`));
    row.append(el('span', 'file-icon', item.type === 'file' ? '▧' : '≡'), details, button(item.type === 'file' ? '另存为' : '复制文字', async () => { await call(item.type === 'file' ? 'saveFile' : 'copyText', item.type === 'file' ? item.id : item.text); if (item.type === 'text') toast('文字已复制'); })); $('transfers').append(row);
  }
}
function show(view) { $('links-view').hidden = view !== 'links'; $('lan-view').hidden = view !== 'lan'; $('links-tab').classList.toggle('active', view === 'links'); $('lan-tab').classList.toggle('active', view === 'lan'); }
async function renderConnection() {
  connection = await call('connection');
  $('lan-toggle').textContent = connection.running ? '停止服务' : '启动服务';
  $('lan-status').textContent = connection.running ? '扫码连接' : '服务未启动';
  $('qr').hidden = !connection.urls.length;
  $('addresses').replaceChildren();
  if (connection.running && !connection.urls.length) { $('addresses').append(el('p', '', '未检测到局域网 IPv4 地址，请连接 Wi-Fi 后重启服务')); return; }
  if (!connection.urls.length) return;
  const select = el('select'); select.setAttribute('aria-label', '选择局域网网卡地址');
  connection.urls.forEach((url, i) => { const option = el('option', '', new URL(url).host); option.value = i; select.append(option); });
  const address = el('p', 'address-text');
  function update() { $('qr').src = connection.codes[select.value]; address.textContent = connection.urls[select.value]; }
  select.onchange = update; update();
  $('addresses').append(select, address, button('复制连接地址', async () => { await call('copyText', connection.urls[select.value]); toast('连接地址已复制'); }));
}
$('links-tab').onclick = () => show('links');
$('lan-tab').onclick = () => run(async () => { show('lan'); await renderConnection(); });
$('monitor').onclick = () => run(async () => { await call('monitor', !state.monitoring); await refresh(); });
async function importFile() { const id = await call('import'); if (id) { selected = id; toast('文件已导入'); } else toast('未导入链接：请确认文件包含有效链接'); await refresh(); }
$('import').onclick = $('import-side').onclick = () => run(importFile);
$('settings').onsubmit = event => { event.preventDefault(); run(async () => { await call('settings', { n: Number($('n').value), m: Number($('m').value) }); toast('规则已保存，下次收集时生效'); await refresh(); }); };
$('copy-group').onclick = () => run(async () => { await call('copy', selected); toast('区域链接已复制'); });
$('group-title').onchange = () => run(async () => { const input = $('group-title'); const name = input.value; const id = input.dataset.id; try { await call('rename', { id, name }); } catch (e) { input.value = current().name; throw e; } });
$('group-title').onkeydown = event => { if (event.key === 'Enter') event.target.blur(); };
$('open-storage').onclick = () => run(() => call('storage'));
$('clear-all').onclick = () => run(async () => { if (await call('clearAll')) { selected = 'common'; await renderConnection(); await refresh(); toast('全部数据已清空'); } });
$('remove').onclick = () => { deleteTarget = selected; $('delete-dialog').showModal(); };
$('delete-dialog').onclose = () => { if ($('delete-dialog').returnValue === 'remove') run(async () => { await call('remove', deleteTarget); await refresh(); }); };
$('share-group').onclick = () => run(async () => { await call('shareGroup', selected); show('lan'); await renderConnection(); await refresh(); toast('已添加到互传，启动服务后手机可查看'); });
$('lan-toggle').onclick = () => run(async () => { $('lan-toggle').disabled = true; try { await call('lan', !connection.running); await renderConnection(); } finally { $('lan-toggle').disabled = false; } });
$('share-files').onclick = () => run(async () => { await call('shareFiles'); await refresh(); });
$('send-text').onclick = () => run(async () => { await call('shareText', $('share-text').value); $('share-text').value = ''; await refresh(); toast('文字已发送'); });
let refreshQueued = false;
window.harbor.onChange(value => {
  if (value?.selectedId) pendingSelection = value.selectedId;
  // Don't replace an input while the user is typing a title.
  if (document.activeElement?.matches('.inline-title, #group-title')) { refreshQueued = true; return; }
  run(refresh);
});
document.addEventListener('focusout', () => { if (refreshQueued) { refreshQueued = false; run(refresh); } });
window.harbor.onError(toast); run(refresh);
