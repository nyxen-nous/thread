import { hashBytes, randomId, seal, signalKey, toBase64, unseal } from './crypto';
import type { Envelope } from './crypto';
import { CHUNK_BYTES, HEADER_BYTES } from './protocol';
import type { Manifest } from './protocol';
import { Transfer } from './transfer';
import type { Sink } from './storage';

export type Stage = 'idle' | 'starting' | 'sharing' | 'approval' | 'connecting' | 'ready' | 'transferring' | 'verifying' | 'complete' | 'canceled' | 'error' | 'ended';
export interface Snapshot {
  stage: Stage; room?: string; link?: string; file?: Manifest; bytes: number; speed: number;
  connected: boolean; verification?: string; receipt?: string; downloadUrl?: string;
  error?: string; notice?: string; expiresAt?: number;
}
export const initialSnapshot: Snapshot = { stage: 'idle', bytes: 0, speed: 0, connected: false };
type Signal = { seq: number; kind: 'hello' | 'offer' | 'answer' | 'ice'; value?: unknown };
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${apiBase}${path}`;

export class Session {
  private ws?: WebSocket;
  private pc?: RTCPeerConnection;
  private transfer?: Transfer;
  private secret = '';
  private room = '';
  private session = '';
  private key?: CryptoKey;
  private closed = false;
  private stage: Stage = 'idle';
  private role: 'host' | 'guest';
  private outgoing = 0;
  private incoming = 0;
  private incomingQueue: Promise<void> = Promise.resolve();
  private outgoingQueue: Promise<void> = Promise.resolve();
  private pendingIce: RTCIceCandidateInit[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private iceServers: RTCIceServer[] = [];
  private hasHello = false;
  constructor(private update: (patch: Partial<Snapshot>) => void, private source?: File) { this.role = source ? 'host' : 'guest'; }
  private emit(patch: Partial<Snapshot>) { if (this.closed) return; if (patch.stage) this.stage = patch.stage; this.update(patch); }
  async start(room?: string, secret?: string) {
    this.emit({ stage: 'starting', error: undefined, notice: undefined });
    try {
      if (!window.isSecureContext || !crypto.subtle || typeof RTCPeerConnection === 'undefined') throw new Error('Open Thread over HTTPS in a current browser. WebRTC and secure browser APIs are required.');
      if (this.role === 'guest') {
        if (!room || !/^[A-Za-z0-9_-]{24}$/.test(room) || !secret) throw new Error('This link is incomplete. Ask the sender to copy the entire link, including the part after #.');
        this.room = room; this.secret = secret; this.key = await signalKey(secret, room);
      } else this.secret = randomId(32);
      const response = await fetch(apiUrl('/api/config'), { signal: AbortSignal.timeout(25_000), cache: 'no-store' });
      if (!response.ok) throw new Error('The connection service is unavailable. Please try again shortly.');
      const config = await response.json();
      if (config.protocol !== 1 || !Array.isArray(config.iceServers)) throw new Error('The server and this app use different versions. Reload the page.');
      this.iceServers = config.iceServers;
      if (this.closed) return;
      const url = new URL(apiUrl('/api/ws'), window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = this.ws = new WebSocket(url);
      this.deadline = setTimeout(() => this.fail('The connection service did not respond. It may be waking up; try again.'), 25_000);
      ws.onopen = () => { this.send(this.role === 'host' ? { type: 'create' } : { type: 'join', room: this.room }); this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000); };
      ws.onmessage = e => { this.incomingQueue = this.incomingQueue.then(() => this.message(JSON.parse(e.data))).catch(e => this.fail(e instanceof Error ? e.message : 'Connection failed.')); };
      ws.onerror = () => this.fail('Could not reach the connection service. Please try again.');
      ws.onclose = () => {
        clearInterval(this.heartbeat);
        if (this.closed || ['complete','error','ended','canceled'].includes(this.stage)) return;
        if (this.pc?.connectionState === 'connected') this.emit({ notice: 'The connection service is offline. This direct transfer can continue, but new connections need a new share.' });
        else this.fail('The connection service disconnected. Ask the sender to create a new share.');
      };
    } catch (e) { this.fail(e instanceof Error ? e.message : 'Could not start the connection.'); }
  }
  private send(message: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  private aad(role: 'host' | 'guest') { return `thread:v1:${this.room}:${this.session}:${role}`; }
  private signal(kind: Signal['kind'], value?: unknown) {
    const session = this.session, aad = this.aad(this.role), seq = this.outgoing++;
    this.outgoingQueue = this.outgoingQueue.then(async () => {
      if (this.closed || session !== this.session || !this.key) return;
      const envelope = await seal(this.key, aad, { seq, kind, value });
      if (session === this.session && !this.closed) this.send({ type: 'signal', session, envelope });
    }).catch(() => this.fail('Could not encrypt the connection details.'));
  }
  private async message(m: Record<string, unknown>) {
    if (this.closed || !m || typeof m.type !== 'string') return;
    if (m.type === 'pong') return;
    if (m.type === 'error' || m.type === 'ended') { this.fail(typeof m.message === 'string' ? m.message : 'This share has ended.'); return; }
    if (m.type === 'created' && this.role === 'host') {
      clearTimeout(this.deadline);
      if (typeof m.room !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(m.room)) throw new Error('Invalid share response.');
      this.room = m.room; this.key = await signalKey(this.secret, this.room);
      this.emit({ stage: 'sharing', room: this.room, link: `${location.origin}/s/${this.room}#${this.secret}`, expiresAt: Date.now() + 4 * 3600_000 }); return;
    }
    if ((m.type === 'guest_joined' && this.role === 'host') || (m.type === 'joined' && this.role === 'guest')) {
      clearTimeout(this.deadline);
      if (typeof m.session !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(m.session)) throw new Error('Invalid session.');
      this.resetPeer(); this.session = m.session; this.outgoing = this.incoming = 0; this.hasHello = false;
      const verification = toBase64(await hashBytes(new TextEncoder().encode(`${this.secret}:${this.session}`).buffer)).slice(0, 12).match(/.{1,4}/g)!.join(' ');
      this.emit({ connected: false, bytes: 0, speed: 0, receipt: undefined, verification });
      if (this.role === 'guest') { this.emit({ stage: 'approval' }); this.signal('hello'); }
      return;
    }
    if (m.type === 'guest_left' && this.role === 'host' && m.session === this.session) {
      this.resetPeer(); this.session = ''; this.hasHello = false;
      if (this.stage !== 'complete') this.emit({ stage: 'sharing', connected: false, bytes: 0, speed: 0, notice: 'The recipient disconnected. They can open the link and try again.' });
      else this.emit({ connected: false });
      return;
    }
    if (m.type !== 'signal' || m.session !== this.session || !this.key) return;
    let signal: Signal;
    try {
      signal = await unseal(this.key, this.aad(this.role === 'host' ? 'guest' : 'host'), m.envelope as Envelope) as Signal;
      if (!signal || signal.seq !== this.incoming || !['hello','offer','answer','ice'].includes(signal.kind)) throw new Error('Replay or invalid message.');
      this.incoming++;
    } catch {
      if (this.role === 'host') { this.send({ type: 'reject', session: this.session }); this.emit({ notice: 'A connection with an invalid link secret was rejected.' }); return; }
      throw new Error('This private link could not be verified. Ask the sender for a fresh, complete link.');
    }
    if (signal.kind === 'hello' && this.role === 'host' && !this.hasHello) { this.hasHello = true; this.emit({ stage: 'approval', notice: undefined }); return; }
    if (signal.kind === 'offer' && this.role === 'guest' && !this.pc) {
      this.makePeer(); this.emit({ stage: 'connecting' });
      await this.pc!.setRemoteDescription(signal.value as RTCSessionDescriptionInit); await this.flushIce();
      const answer = await this.pc!.createAnswer(); await this.pc!.setLocalDescription(answer); this.signal('answer', this.pc!.localDescription); return;
    }
    if (signal.kind === 'answer' && this.role === 'host' && this.pc && !this.pc.remoteDescription) { await this.pc.setRemoteDescription(signal.value as RTCSessionDescriptionInit); await this.flushIce(); return; }
    if (signal.kind === 'ice') {
      if (!signal.value || typeof signal.value !== 'object') throw new Error('Invalid connection route.');
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(signal.value as RTCIceCandidateInit);
      else { if (this.pendingIce.length >= 64) throw new Error('Too many connection routes.'); this.pendingIce.push(signal.value as RTCIceCandidateInit); }
      return;
    }
    throw new Error('Unexpected connection message.');
  }
  async approve() {
    if (this.role !== 'host' || this.stage !== 'approval' || !this.hasHello) return;
    try {
      this.emit({ stage: 'connecting', notice: undefined }); this.send({ type: 'approve', session: this.session }); this.makePeer();
      const channel = this.pc!.createDataChannel('thread-file', { ordered: true }); this.setupChannel(channel);
      const offer = await this.pc!.createOffer(); await this.pc!.setLocalDescription(offer); this.signal('offer', this.pc!.localDescription);
    } catch (e) { this.fail(e instanceof Error ? e.message : 'Could not establish a direct connection.'); }
  }
  decline() { this.send({ type: 'reject', session: this.session }); this.emit({ stage: 'sharing', notice: 'Connection declined. Your share is still open.' }); }
  private async flushIce() { for (const candidate of this.pendingIce) await this.pc!.addIceCandidate(candidate); this.pendingIce = []; }
  private makePeer() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.deadline = setTimeout(() => this.fail('No direct route was found. Try a home Wi-Fi connection or a phone hotspot on either device, then start again.'), 35_000);
    pc.onicecandidate = e => { if (e.candidate) this.signal('ice', e.candidate.toJSON()); };
    pc.ondatachannel = e => { if (this.role === 'guest' && !this.transfer && e.channel.label === 'thread-file') this.setupChannel(e.channel); else e.channel.close(); };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc || this.closed) return;
      if (pc.connectionState === 'connected') this.emit({ connected: true });
      if (pc.connectionState === 'failed') this.fail('The devices could not maintain a direct connection. Try a different network and create a new share.');
    };
  }
  private setupChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      if (this.closed || !this.pc) { channel.close(); return; }
      clearTimeout(this.deadline);
      const max = this.pc.sctp?.maxMessageSize ?? 65536;
      if (max !== 0 && max <= HEADER_BYTES) { this.fail('This browser cannot send the required message size.'); return; }
      this.transfer = new Transfer(channel, {
        manifest: file => this.emit({ file }),
        state: stage => this.emit({ stage }),
        progress: p => this.emit({ bytes: p.bytes, speed: p.speed }),
        complete: (receipt, downloadUrl) => this.emit({ receipt, downloadUrl }),
        error: error => this.fail(error),
      }, this.source, max ? Math.min(CHUNK_BYTES, max - HEADER_BYTES) : CHUNK_BYTES);
      this.emit({ connected: true, stage: 'ready' });
      if (this.source) this.transfer.announce({ id: randomId(), name: this.source.name, size: this.source.size, mime: this.source.type });
    };
  }
  receive(sink: Sink) {
    if (!this.transfer || this.stage !== 'ready') { void sink.abort(); throw new Error('The sender is no longer connected. Open the share again.'); }
    this.transfer.receive(sink);
  }
  cancel() { this.transfer?.cancel(); this.stop('canceled'); }
  stop(stage: Stage = 'ended') {
    if (this.closed) return;
    this.emit({ stage, connected: false }); this.closed = true;
    if (this.role === 'host') this.send({ type: 'close' });
    this.resetPeer(); clearInterval(this.heartbeat); clearTimeout(this.deadline); this.ws?.close();
  }
  private resetPeer() { this.transfer?.dispose(); this.transfer = undefined; this.pc?.close(); this.pc = undefined; this.pendingIce = []; clearTimeout(this.deadline); }
  private fail(error: string) {
    if (this.closed || this.stage === 'complete') return;
    this.emit({ stage: 'error', error, connected: false }); this.closed = true;
    this.resetPeer(); clearInterval(this.heartbeat); clearTimeout(this.deadline); this.ws?.close();
  }
}
