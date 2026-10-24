export const PROTOCOL = 1;
export const CHUNK_BYTES = 16 * 1024;
export const HEADER_BYTES = 40;
export const WINDOW_BYTES = 512 * 1024;
export const MEMORY_LIMIT = 64 * 1024 * 1024;
export type Manifest = { id: string; name: string; size: number; mime: string };
export type Control =
  | { type: 'manifest'; file: Manifest }
  | { type: 'ready' }
  | { type: 'ack'; offset: number }
  | { type: 'finish'; root: string; chunks: number }
  | { type: 'complete'; root: string }
  | { type: 'cancel' };

export function parseControl(raw: string): Control {
  if (raw.length > 4096) throw new Error('The other device sent an oversized message.');
  const v = JSON.parse(raw);
  if (!v || typeof v !== 'object') throw new Error('Invalid transfer message.');
  switch (v.type) {
    case 'manifest': {
      const f = v.file;
      if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(f.id) ||
        typeof f.name !== 'string' || !f.name.length || f.name.length > 512 ||
        typeof f.mime !== 'string' || f.mime.length > 255 ||
        !Number.isSafeInteger(f.size) || f.size < 0) throw new Error('Invalid file information.');
      return { type: 'manifest', file: { id: f.id, name: f.name, size: f.size, mime: f.mime } };
    }
    case 'ack':
      if (!Number.isSafeInteger(v.offset) || v.offset < 0) throw new Error('Invalid acknowledgement.');
      return { type: 'ack', offset: v.offset };
    case 'finish':
      if (!Number.isSafeInteger(v.chunks) || v.chunks < 0 || typeof v.root !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.root)) throw new Error('Invalid verification result.');
      return { type: 'finish', root: v.root, chunks: v.chunks };
    case 'complete':
      if (typeof v.root !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.root)) throw new Error('Invalid completion receipt.');
      return { type: 'complete', root: v.root };
    case 'ready': case 'cancel': return { type: v.type };
    default: throw new Error('Unknown transfer message.');
  }
}

export function encodeFrame(offset: number, hash: Uint8Array, chunk: ArrayBuffer): ArrayBuffer {
  if (!Number.isSafeInteger(offset) || offset < 0 || hash.length !== 32 || chunk.byteLength < 1 || chunk.byteLength > CHUNK_BYTES) throw new Error('Invalid frame.');
  const frame = new Uint8Array(HEADER_BYTES + chunk.byteLength);
  new DataView(frame.buffer).setBigUint64(0, BigInt(offset));
  frame.set(hash, 8); frame.set(new Uint8Array(chunk), HEADER_BYTES);
  return frame.buffer;
}

export function decodeFrame(frame: ArrayBuffer, expected: number, size: number) {
  if (frame.byteLength <= HEADER_BYTES || frame.byteLength > CHUNK_BYTES + HEADER_BYTES) throw new Error('Invalid chunk length.');
  const offset = Number(new DataView(frame).getBigUint64(0));
  const data = frame.slice(HEADER_BYTES);
  if (!Number.isSafeInteger(offset) || offset !== expected || data.byteLength > size - expected) throw new Error('The file arrived out of order or exceeded its declared size.');
  return { data, hash: new Uint8Array(frame.slice(8, HEADER_BYTES)) };
}

export function safeFilename(name: string) {
  return name.replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, '_').replace(/^\.+/, '_').slice(0, 180) || 'download';
}

export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
