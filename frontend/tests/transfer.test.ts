import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
// Compile the actual engine, then run it against an asynchronous in-process channel.
const file = new URL('../src/transfer.ts', import.meta.url);
let code = ts.transpileModule(await readFile(file,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
code = code.replace(/from '\.\/([^']+)'/g, (_,name)=>`from '${new URL(`../src/${name}.ts`,import.meta.url).href}'`);
const {Transfer} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

class Channel {
  readyState='open'; bufferedAmount=0; bufferedAmountLowThreshold=0; binaryType='arraybuffer'; peak=0;
  other:any; onmessage:any; onclose:any; onerror:any; tamper=false;
  send(raw:any) {
    const size=typeof raw==='string'?raw.length:raw.byteLength;
    this.bufferedAmount+=size; this.peak=Math.max(this.peak,this.bufferedAmount);
    if (this.tamper && raw instanceof ArrayBuffer) {raw=raw.slice(0);new Uint8Array(raw)[raw.byteLength-1]^=1;this.tamper=false;}
    setImmediate(()=>{this.bufferedAmount-=size;if(this.other.readyState==='open')this.other.onmessage?.({data:raw})});
  }
  close(){this.readyState='closed';this.onclose?.();}
}
const tick = (ms=5)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){const deadline=Date.now()+5000;while(!fn()){if(Date.now()>deadline)throw new Error('Test timed out');await tick();}}
async function pair(bytes:Uint8Array,{slow=false,corrupt=false,failWrite=false}={}) {
  const a=new Channel(),b=new Channel();a.other=b;b.other=a;a.tamper=corrupt;
  const source=new File([bytes],'test.bin',{type:'application/octet-stream'});
  const chunks:ArrayBuffer[]=[];const senderStates:string[]=[],receiverStates:string[]=[],errors:string[]=[];
  let manifest:any,finalized=false,aborted=false,progress=0;
  let receiver:any;
  const sink={mode:'disk',async write(chunk:ArrayBuffer){if(failWrite)throw new Error('Disk full');if(slow)await tick(8);chunks.push(chunk)},async finish(){finalized=true},async abort(){aborted=true;chunks.length=0}};
  const sender=new Transfer(a,{manifest(){},state(s:string){senderStates.push(s)},progress(p:any){progress=p.bytes},complete(){},error(e:string){errors.push(e)}},source);
  receiver=new Transfer(b,{manifest(f:any){manifest=f},state(s:string){receiverStates.push(s);if(s==='ready')receiver.receive(sink)},progress(){},complete(){},error(e:string){errors.push(e)}});
  sender.announce({id:'a'.repeat(24),name:source.name,size:source.size,mime:source.type});
  return {sender,receiver,a,b,source,chunks,senderStates,receiverStates,errors,get finalized(){return finalized},get aborted(){return aborted},get progress(){return progress},get manifest(){return manifest}};
}

test('full transfer preserves a multi-chunk binary file and waits for disk finalization',async()=>{
  const bytes=Uint8Array.from({length:300_001},(_,i)=>i%251);const p=await pair(bytes);
  try{await until(()=>p.senderStates.includes('complete'));assert.ok(p.finalized);assert.ok(p.receiverStates.includes('complete'));assert.equal(p.progress,bytes.length);assert.deepEqual(Buffer.concat(p.chunks.map(c=>Buffer.from(c))),Buffer.from(bytes));assert.deepEqual(p.errors,[]);}finally{p.sender.dispose();p.receiver.dispose()}
});
test('empty files complete and close their output writer',async()=>{const p=await pair(new Uint8Array());try{await until(()=>p.senderStates.includes('complete'));assert.ok(p.finalized);assert.equal(p.chunks.length,0);}finally{p.sender.dispose();p.receiver.dispose()}});
test('slow receiver keeps sender queues bounded',async()=>{const p=await pair(new Uint8Array(2_000_000),{slow:true});try{await until(()=>p.senderStates.includes('complete'));assert.ok(p.a.peak<600_000);assert.equal(p.progress,2_000_000);}finally{p.sender.dispose();p.receiver.dispose()}});
test('corruption aborts the destination and never reports success',async()=>{const p=await pair(new Uint8Array(100_000),{corrupt:true});try{await until(()=>p.errors.length>0);assert.match(p.errors[0],/Verification failed/);assert.ok(p.aborted);assert.ok(!p.finalized);assert.ok(!p.senderStates.includes('complete'));}finally{p.sender.dispose();p.receiver.dispose()}});
test('disk failures are surfaced without success',async()=>{const p=await pair(new Uint8Array(100_000),{failWrite:true});try{await until(()=>p.errors.length>0);assert.equal(p.errors[0],'Disk full');assert.ok(!p.finalized);}finally{p.sender.dispose();p.receiver.dispose()}});
test('cancellation releases the writer and does not finalize',async()=>{const p=await pair(new Uint8Array(2_000_000),{slow:true});try{await until(()=>p.receiverStates.includes('transferring'));p.receiver.cancel();await until(()=>p.senderStates.includes('canceled'));assert.ok(p.aborted);assert.ok(!p.finalized);}finally{p.sender.dispose();p.receiver.dispose()}});
