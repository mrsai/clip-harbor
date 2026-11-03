const $ = id => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; }
async function request(route, options) { const res = await fetch(route, options); const value = await res.json(); if (!res.ok) throw new Error(value.error || '传输失败'); return value; }
async function refresh() {
  const items = await request('api/items'); $('items').replaceChildren();
  if (!items.length) $('items').append(el('p', '', '暂无共享内容，发送一段文字开始吧。'));
  for (const item of items) {
    const row = el('div', 'transfer-item', ''), details = el('div', 'details', '');
    details.append(el('strong', '', item.type === 'text' ? item.text : item.name), el('small', '', `${item.from} · ${new Date(item.created).toLocaleTimeString()}${item.type === 'file' ? ` · ${(item.size / 1024 ** 2).toFixed(2)} MB` : ''}`));
    row.append(el('span', 'file-icon', item.type === 'file' ? '▧' : '≡'), details);
    if (item.type === 'file') { const a = el('a', '', '下载 ↓'); a.href = `download/${item.id}`; a.download = item.name; row.append(a); }
    else {
      const copy = el('button', '', '复制'); copy.onclick = async () => {
        try { await navigator.clipboard.writeText(item.text); $('phone-status').textContent = '文字已复制'; }
        catch {
          // HTTP mobile pages may not expose the Clipboard API; retain a selectable fallback.
          const input = document.createElement('textarea'); input.value = item.text; details.append(input); input.focus(); input.select();
          $('phone-status').textContent = document.execCommand('copy') ? '文字已复制' : '请长按选中的文字复制';
        }
      }; row.append(copy);
    } $('items').append(row);
  }
}
async function run(button, fn) { button.disabled = true; try { await fn(); } catch(e) { $('phone-status').textContent = e.message; } finally { button.disabled = false; } }
$('send-text').onclick = () => run($('send-text'), async () => { await request('api/text', { method: 'POST', body: $('text').value }); $('text').value = ''; $('phone-status').textContent = '文字已发送到电脑'; await refresh(); });
$('send-files').onclick = () => run($('send-files'), async () => {
  const files = [...$('files').files]; if (!files.length || files.length > 20 || files.some(f => f.size > 2 * 1024 ** 3)) throw new Error('请选择 1–20 个文件，单文件不超过 2 GB');
  const body = new FormData(); files.forEach(f => body.append('files', f));
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', 'api/upload');
    xhr.upload.onprogress = event => { $('phone-status').textContent = event.lengthComputable ? `正在上传 ${Math.round(event.loaded / event.total * 100)}%` : '正在上传…'; };
    xhr.onload = () => { if (xhr.status === 201) resolve(); else { let message = '上传失败'; try { message = JSON.parse(xhr.responseText).error; } catch {} reject(new Error(message)); } };
    xhr.onerror = () => reject(new Error('连接中断，请检查 Wi-Fi 和电脑上的服务')); xhr.send(body);
  });
  $('files').value = ''; $('phone-status').textContent = '文件已发送到电脑'; await refresh();
});
$('refresh').onclick = () => run($('refresh'), refresh);
let refreshing = false;
setInterval(async () => { if (refreshing || document.querySelector('#items textarea:focus')) return; refreshing = true; try { await refresh(); } catch { $('phone-status').textContent = '连接中断，请检查电脑服务，或重新扫码'; } finally { refreshing = false; } }, 5000);
refresh().catch(e => { $('phone-status').textContent = e.message; });
