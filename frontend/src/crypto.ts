export type Envelope = { iv: string; data: string };
export function toBase64(bytes: Uint8Array) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid link secret.');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
export function randomId(bytes = 18) { return toBase64(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function hashBytes(data: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}
export async function chainHash(previous: Uint8Array, chunkHash: Uint8Array) {
  const combined = new Uint8Array(64); combined.set(previous); combined.set(chunkHash, 32);
  return hashBytes(combined.buffer);
}
export function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let different = 0; for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
export async function signalKey(secret: string, room: string) {
  const raw = fromBase64(secret);
  if (raw.byteLength !== 32 || secret.length !== 43) throw new Error('This link is incomplete. Ask the sender to copy the full link.');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(room), info: new TextEncoder().encode('thread:signaling:v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(key: CryptoKey, aad: string, message: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(JSON.stringify(message)));
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}
export async function unseal(key: CryptoKey, aad: string, env: Envelope): Promise<unknown> {
  if (!env || typeof env.iv !== 'string' || env.iv.length !== 16 || typeof env.data !== 'string' || env.data.length > 28000) throw new Error('Invalid encrypted message.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: new TextEncoder().encode(aad) }, key, fromBase64(env.data));
  return JSON.parse(new TextDecoder().decode(bytes));
}
