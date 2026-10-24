import { chainHash, equalBytes, hashBytes, toBase64 } from './crypto';
import { CHUNK_BYTES, WINDOW_BYTES, decodeFrame, encodeFrame, parseControl } from './protocol';
import type { Manifest, Control } from './protocol';
import type { Sink } from './storage';
export type Progress = { bytes: number; speed: number; total: number };
export type TransferCallbacks = {
  manifest: (file: Manifest) => void;
  state: (state: 'ready' | 'transferring' | 'verifying' | 'complete' | 'canceled') => void;
  progress: (progress: Progress) => void;
  complete: (root: string, url?: string) => void;
  error: (message: string) => void;
};

export class Transfer {
  private stopped = false;
  private started = false;
  private finishing = false;
  private completed = false;
  private sink?: Sink;
  private fileInfo?: Manifest;
  private sent = 0;
  private ack = 0;
  private received = 0;
  private count = 0;
  private root: Uint8Array<ArrayBuffer> = new Uint8Array(32);
  private queue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private lastActivity = Date.now();
  private sampleTime = Date.now();
  private sampleBytes = 0;
  private speed = 0;
  private timer: ReturnType<typeof setInterval>;
  constructor(private channel: RTCDataChannel, private callbacks: TransferCallbacks, private source?: File, private maxChunk = CHUNK_BYTES) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = WINDOW_BYTES / 2;
    channel.onmessage = e => {
      if (this.stopped || this.completed) return;
      const size = e.data instanceof ArrayBuffer ? e.data.byteLength : typeof e.data === 'string' ? e.data.length : Infinity;
      this.queuedBytes += size;
      if (this.queuedBytes > 2 * WINDOW_BYTES + 4096) { this.fail('The other device sent data too quickly.'); return; }
      this.queue = this.queue.then(async () => {
        try {
          if (!this.stopped && !this.completed) { this.lastActivity = Date.now(); await this.onMessage(e.data); }
        } finally { this.queuedBytes -= size; }
      }).catch(e => this.fail(e instanceof Error ? e.message : 'Transfer failed.'));
    };
    channel.onclose = () => { if (!this.stopped && !this.completed) this.fail('The direct connection closed. Keep both tabs open and try the transfer again.'); };
    channel.onerror = () => this.fail('The direct connection failed. Try another network and start again.');
    this.timer = setInterval(() => {
      if (this.started && !this.completed && !this.stopped && Date.now() - this.lastActivity > 60_000) this.fail('No transfer progress for a minute. Check both connections and start again.');
    }, 5000);
  }
  announce(file: Manifest) { this.fileInfo = file; this.send({ type: 'manifest', file }); }
  receive(sink: Sink) {
    if (this.source || this.started || !this.fileInfo || this.stopped) throw new Error('The transfer is not ready.');
    this.sink = sink; this.started = true; this.sampleTime = Date.now(); this.lastActivity = Date.now();
    this.callbacks.state('transferring'); this.send({ type: 'ready' });
  }
  cancel(notify = true) {
    if (this.stopped || this.completed) return;
    if (notify && this.channel.readyState === 'open') this.send({ type: 'cancel' });
    this.stopped = true; clearInterval(this.timer);
    void this.sink?.abort(); this.callbacks.state('canceled');
  }
  dispose() { this.stopped = true; clearInterval(this.timer); if (!this.completed) void this.sink?.abort(); this.channel.close(); }
  private fail(message: string) {
    if (this.stopped || this.completed) return;
    this.stopped = true; clearInterval(this.timer); void this.sink?.abort(); this.channel.close(); this.callbacks.error(message);
  }
  private send(message: Control) { if (this.channel.readyState !== 'open') throw new Error('The direct connection is closed.'); this.channel.send(JSON.stringify(message)); }
  private report(bytes: number) {
    const now = Date.now(); const interval = (now - this.sampleTime) / 1000;
    if (interval >= .4) { this.speed = (bytes - this.sampleBytes) / interval; this.sampleBytes = bytes; this.sampleTime = now; }
    this.callbacks.progress({ bytes, speed: this.speed, total: this.fileInfo?.size ?? 0 });
  }
  private async waitUntil(condition: () => boolean) {
    while (!condition()) {
      if (this.stopped || this.channel.readyState !== 'open') throw new Error('Transfer interrupted.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (this.stopped) throw new Error('Transfer canceled.');
  }
  private async sendFile() {
    if (!this.source || !this.fileInfo) return;
    try {
      while (this.sent < this.source.size) {
        await this.waitUntil(() => this.channel.bufferedAmount < WINDOW_BYTES && this.sent - this.ack < WINDOW_BYTES);
        const offset = this.sent;
        const chunk = await this.source.slice(offset, offset + this.maxChunk).arrayBuffer();
        const digest = await hashBytes(chunk);
        if (this.stopped) return;
        this.root = await chainHash(this.root, digest);
        if (this.stopped) return;
        this.channel.send(encodeFrame(offset, digest, chunk));
        this.sent += chunk.byteLength; this.count++;
      }
      await this.waitUntil(() => this.ack === this.source!.size);
      this.finishing = true; this.lastActivity = Date.now(); this.callbacks.state('verifying');
      this.send({ type: 'finish', root: toBase64(this.root), chunks: this.count });
    } catch (e) { this.fail(e instanceof Error ? e.message : 'Could not read the selected file.'); }
  }
  private async onMessage(raw: unknown) {
    if (raw instanceof ArrayBuffer) {
      if (this.source || !this.started || this.finishing || !this.sink || !this.fileInfo) throw new Error('Unexpected file data.');
      const { data, hash } = decodeFrame(raw, this.received, this.fileInfo.size);
      const digest = await hashBytes(data);
      if (!equalBytes(digest, hash)) throw new Error('Verification failed. This download was stopped to avoid saving a damaged file.');
      await this.sink.write(data);
      this.root = await chainHash(this.root, digest);
      if (this.stopped) return;
      this.received += data.byteLength; this.count++; this.report(this.received);
      this.send({ type: 'ack', offset: this.received });
      return;
    }
    if (typeof raw !== 'string') throw new Error('Unexpected transfer data.');
    const msg = parseControl(raw);
    if (msg.type === 'cancel') { this.cancel(false); return; }
    if (msg.type === 'manifest' && !this.source && !this.fileInfo) {
      this.fileInfo = msg.file; this.callbacks.manifest(msg.file); this.callbacks.state('ready'); return;
    }
    if (msg.type === 'ready' && this.source && !this.started) {
      this.started = true; this.sampleTime = Date.now(); this.callbacks.state('transferring'); void this.sendFile(); return;
    }
    if (msg.type === 'ack' && this.source && this.started && !this.finishing) {
      if (msg.offset <= this.ack || msg.offset > this.sent) throw new Error('Invalid receiver progress.');
      this.ack = msg.offset; this.report(this.ack); return;
    }
    if (msg.type === 'finish' && !this.source && this.started && !this.finishing && this.sink) {
      if (this.received !== this.fileInfo!.size || msg.chunks !== this.count || msg.root !== toBase64(this.root)) throw new Error('The complete file could not be verified.');
      this.finishing = true; this.callbacks.state('verifying');
      const url = await this.sink.finish();
      if (this.stopped) { if (url) URL.revokeObjectURL(url); return; }
      this.send({ type: 'complete', root: msg.root });
      this.completed = true; clearInterval(this.timer); this.report(this.received); this.callbacks.state('complete'); this.callbacks.complete(msg.root, url); return;
    }
    if (msg.type === 'complete' && this.source && this.finishing && msg.root === toBase64(this.root)) {
      this.completed = true; clearInterval(this.timer); this.report(this.source.size); this.callbacks.state('complete'); this.callbacks.complete(msg.root); return;
    }
    throw new Error('The other device sent a message out of sequence.');
  }
}
