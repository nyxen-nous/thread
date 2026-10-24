import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, decodeFrame, parseControl, safeFilename, CHUNK_BYTES, formatBytes } from '../src/protocol.ts';
import { randomId, signalKey, seal, unseal, hashBytes, chainHash, equalBytes, fromBase64, toBase64 } from '../src/crypto.ts';

test('binary frame preserves bytes and a large safe integer offset', () => {
  const bytes = new Uint8Array([0, 255, 18]); const digest = new Uint8Array(32).fill(9); const offset = 2**40;
  const frame = encodeFrame(offset, digest, bytes.buffer); const out = decodeFrame(frame, offset, offset+3);
  assert.deepEqual(new Uint8Array(out.data), bytes); assert.deepEqual(out.hash, digest);
});
test('rejects oversize, duplicate/out-of-order, out-of-bounds and empty frames', () => {
  const frame = encodeFrame(0,new Uint8Array(32),new Uint8Array(10).buffer);
  assert.throws(()=>decodeFrame(frame,10,100)); assert.throws(()=>decodeFrame(frame,0,5));
  assert.throws(()=>decodeFrame(new ArrayBuffer(40),0,10));
  assert.throws(()=>encodeFrame(0,new Uint8Array(32),new ArrayBuffer(CHUNK_BYTES+1)));
});
test('validates metadata and sequence message shape', () => {
  assert.throws(()=>parseControl(JSON.stringify({type:'manifest',file:{id:'x'.repeat(24),name:'x',size:-1,mime:''}})));
  assert.throws(()=>parseControl(JSON.stringify({type:'ack',offset:1.1})));
  assert.throws(()=>parseControl('x'.repeat(5000)));
  assert.equal(parseControl('{"type":"ready"}').type,'ready');
});
test('filenames are safe suggestions and units are honest', () => {
  assert.equal(safeFilename('../secret\\file\u0000.txt'),'__secret_file_.txt');
  assert.equal(formatBytes(1024),'1 KiB'); assert.equal(formatBytes(0),'0 B');
});
test('secret encoding has 256 bits; base64url round trips binary', () => {
  const secret = randomId(32); assert.equal(secret.length,43); assert.equal(fromBase64(secret).length,32);
  assert.equal(toBase64(fromBase64(secret)),secret);
});
test('signaling hides messages, rejects wrong secret, tampering and wrong session', async () => {
  const key=await signalKey(randomId(32),'room'); const wrong=await signalKey(randomId(32),'room');
  const env=await seal(key,'room:session:host',{seq:0,kind:'hello'});
  assert.deepEqual(await unseal(key,'room:session:host',env),{seq:0,kind:'hello'});
  await assert.rejects(unseal(wrong,'room:session:host',env));
  await assert.rejects(unseal(key,'different-session',env));
  const changed={...env,data:(env.data[0]==='a'?'b':'a')+env.data.slice(1)};
  await assert.rejects(unseal(key,'room:session:host',changed));
});
test('rejects incomplete link secrets', async () => { await assert.rejects(signalKey('abc','room')); });
test('digest chain is bounded, deterministic, and order-sensitive', async () => {
  const a=await hashBytes(new TextEncoder().encode('first').buffer), b=await hashBytes(new TextEncoder().encode('second').buffer);
  const root=await chainHash(await chainHash(new Uint8Array(32),a),b);
  assert.equal(root.length,32); assert.ok(equalBytes(root,await chainHash(await chainHash(new Uint8Array(32),a),b)));
  assert.ok(!equalBytes(root,await chainHash(await chainHash(new Uint8Array(32),b),a)));
});
