const { randomUUID, randomInt } = require('node:crypto');

function parseLinks(text) {
  return String(text).split(/[\r\n\u0085\u2028\u2029]+/).flatMap(line => {
    // Strip Markdown wrappers before extracting links; bare URLs retain parentheses.
    const plain = line.replace(/\[[^\]]*\]\((magnet:\?[^\s]+|ed2k:\/\/[^\s]+)\)/gi, '$1');
    return plain.match(/magnet:\?[^\s<>"`]+|ed2k:\/\/\|file\|[^\r\n]+?\|\d+\|[a-f\d]{32}\|\//gi) || [];
  });
}
function validateSettings({ n, m }) {
  if (!Number.isInteger(n) || !Number.isInteger(m) || n < 1 || m < n || m > 10000)
    throw new Error('请输入整数，满足 1 ≤ n ≤ m ≤ 10000');
  return { n, m };
}
function createState() {
  return { settings: { n: 5, m: 50 }, groups: [{ id: 'common', name: '常用', links: [], children: [], created: Date.now() }] };
}
function addLinks(state, text, source = 'clipboard', name) {
  const links = parseLinks(text);
  if (!links.length) return null;
  const { n, m } = validateSettings(state.settings);
  if (source === 'clipboard' && links.length < n) {
    const common = state.groups[0];
    if (!common.children.length) common.links.push(...links);
    else for (const link of links) {
      let tail = common.children.at(-1);
      if (tail.links.length >= m) {
        tail = { id: randomUUID(), name: `分组 ${common.children.length + 1}`, links: [], children: [] };
        common.children.push(tail);
      }
      tail.links.push(link);
    }
    splitGroup(common, m);
    return state.groups[0].id;
  }
  const group = { id: randomUUID(), name: name || `${['松林', '海湾', '星河', '山岚'][randomInt(4)]} ${randomInt(1000, 10000)}`, links: [], children: [], created: Date.now() };
  group.links = links;
  splitGroup(group, m);
  state.groups.push(group);
  return group.id;
}
function splitGroup(group, m) {
  if (group.links.length <= m && group.children.every(c => c.links.length <= m)) return;
  const links = allLinks(group), previous = group.children;
  group.links = []; group.children = [];
  for (let i = 0; i < links.length; i += m)
    group.children.push({ id: previous[i / m]?.id || randomUUID(), name: previous[i / m]?.name || `分组 ${i / m + 1}`, links: links.slice(i, i + m), children: [] });
}
function findGroup(state, id) {
  for (const group of state.groups) {
    if (group.id === id) return group;
    const child = group.children.find(c => c.id === id);
    if (child) return child;
  }
  throw new Error('区域不存在');
}
const allLinks = group => [...group.links, ...group.children.flatMap(c => c.links)];
module.exports = { parseLinks, validateSettings, createState, addLinks, findGroup, allLinks, splitGroup };
