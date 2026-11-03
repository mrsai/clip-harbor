const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const { ClipboardMonitor } = require('../src/monitor');
async function until(check) {
  const deadline = Date.now() + 1500;
  while (!check()) { if (Date.now() > deadline) assert.fail('monitor did not deliver change'); await pause(5); }
}
test('automatically captures sync and async clipboard changes, ignores own copies, pauses and retries errors', async () => {
  let value = 'first', fail = false, asyncRead = false;
  const captured = [], errors = [];
  const monitor = new ClipboardMonitor(() => { if (fail) { fail = false; throw Error('busy'); } return asyncRead ? Promise.resolve(value) : value; }, text => captured.push(text), error => errors.push(error.message), 5);
  try {
    monitor.start(); await until(() => captured.length === 1);
    value = 'second'; asyncRead = true; await until(() => captured.length === 2);
    monitor.ignore('own-copy'); value = 'own-copy'; await pause(30);
    assert.deepEqual(captured, ['first', 'second']);
    fail = true; value = 'third'; await until(() => captured.length === 3);
    assert.deepEqual(errors, ['busy']);
    monitor.stop(); value = 'paused'; await pause(25); assert.equal(captured.length, 3);
    monitor.start(); await until(() => captured.at(-1) === 'paused');
  } finally { monitor.stop(); }
});
test('old in-flight reads cannot collect after stop/restart or overwrite own-copy suppression', async () => {
  const reads = [], captured = [];
  const monitor = new ClipboardMonitor(() => new Promise(resolve => reads.push(resolve)), text => captured.push(text), () => {}, 1000);
  try {
    monitor.start(); monitor.stop(); monitor.start();
    reads[0]('stale'); reads[1]('fresh'); await pause(5);
    assert.deepEqual(captured, ['fresh']);
    monitor.stop(); monitor.start(); monitor.ignore('own-copy'); reads[2]('old-before-copy'); await pause(5);
    assert.deepEqual(captured, ['fresh']);
  } finally { monitor.stop(); }
});
