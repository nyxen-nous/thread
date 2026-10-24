import { MEMORY_LIMIT, safeFilename } from './protocol';
import type { Manifest } from './protocol';
export interface Sink {
  mode: 'disk' | 'memory';
  write(chunk: ArrayBuffer): Promise<void>;
  finish(): Promise<string | undefined>;
  abort(): Promise<void>;
}
interface WritableFile { write(data: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface SaveHandle { createWritable(): Promise<WritableFile> }
interface PickerWindow extends Window { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> }
export function canSaveToDisk() { return typeof (window as PickerWindow).showSaveFilePicker === 'function'; }
export async function createSink(file: Manifest): Promise<Sink> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (picker) {
    // Invoke immediately in the user's click handler, before any other asynchronous work.
    const handle = await picker.call(window, { suggestedName: safeFilename(file.name) });
    const writer = await handle.createWritable();
    return { mode: 'disk', write: c => writer.write(c), finish: async () => { await writer.close(); return undefined; }, abort: async () => { try { await writer.abort(); } catch { /* already closed */ } } };
  }
  if (file.size > MEMORY_LIMIT) throw new Error('This browser can receive up to 64 MiB. Open this link in desktop Chrome or Edge to save larger files directly to disk.');
  let chunks: ArrayBuffer[] = [], total = 0;
  return {
    mode: 'memory',
    async write(chunk) { total += chunk.byteLength; if (total > MEMORY_LIMIT) throw new Error('The browser download limit was exceeded.'); chunks.push(chunk); },
    async finish() { const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' })); chunks = []; return url; },
    async abort() { chunks = []; },
  };
}
