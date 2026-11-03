// Poll in the main process so collection continues while the window is unfocused.
class ClipboardMonitor {
  constructor(read, collect, onError, delay = 300) {
    this.read = read; this.collect = collect; this.onError = onError; this.delay = delay;
    this.running = false; this.revision = 0; this.session = 0; this.last = null;
  }
  start() {
    this.stop(); this.running = true; this.last = null;
    this.check(this.session);
  }
  stop() { this.running = false; this.session++; clearTimeout(this.timer); }
  ignore(text) { this.last = text; this.revision++; }
  async check(session) {
    if (!this.running || session !== this.session) return;
    const revision = this.revision;
    try {
      const text = await this.read();
      if (this.running && session === this.session && revision === this.revision && text !== this.last) {
        await this.collect(text);
        if (revision === this.revision) this.last = text;
      }
    } catch (error) { if (this.running) this.onError(error); }
    finally {
      // A stop/start creates its own polling chain; don't revive the old chain.
      if (this.running && session === this.session) this.timer = setTimeout(() => this.check(session), this.delay);
    }
  }
}
module.exports = { ClipboardMonitor };
