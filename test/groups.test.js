const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, addLinks, parseLinks, findGroup, allLinks, validateSettings } = require('../src/groups');
const magnet = i => `magnet:?xt=urn:btih:${String(i).padStart(40, '0')}&dn=File${i}`;
const input = count => Array.from({ length: count }, (_, i) => magnet(i)).join('\r\n');
test('newline variants and mixed invalid text preserve valid link order', () => {
  const ed2k = 'ed2k://|file|example.zip|100|0123456789abcdef0123456789abcdef|/';
  assert.deepEqual(parseLinks(`hello\r\n ${magnet(1)} \r${ed2k}\u2028javascript:evil\u2029${magnet(2)}\u0085`), [magnet(1), ed2k, magnet(2)]);
});
test('n-1 → common; n → new group; m → no children; m+1 → children with remainder', () => {
  const state = createState(); state.settings = { n: 3, m: 5 };
  assert.equal(addLinks(state, input(2)), 'common');
  assert.equal(state.groups[0].links.length, 2);
  assert.notEqual(addLinks(state, input(3)), 'common');
  assert.equal(findGroup(state, addLinks(state, input(5))).children.length, 0);
  const group = findGroup(state, addLinks(state, input(11)));
  assert.deepEqual(group.children.map(c => c.links.length), [5, 5, 1]);
  assert.deepEqual(allLinks(group), parseLinks(input(11)));
});
test('file import always creates a named region and invalid input creates nothing', () => {
  const state = createState(); const id = addLinks(state, input(1), 'file', 'demo.txt');
  assert.notEqual(id, 'common'); assert.equal(findGroup(state, id).name, 'demo.txt');
  assert.equal(addLinks(state, 'hello'), null); assert.equal(state.groups.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});
test('settings reject impossible limits', () => {
  for (const settings of [{ n: 0, m: 5 }, { n: 6, m: 5 }, { n: 1.5, m: 50 }, { n: 1, m: 10001 }]) assert.throws(() => validateSettings(settings));
});
