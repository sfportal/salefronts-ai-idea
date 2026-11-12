import { first, run } from './db';
import { fail } from './util';
// File storage: R2 when the FILES binding exists, otherwise small files in D1 (fallback until R2 is enabled).
const D1_MAX = 1800 * 1024;
export async function putFile(env: Env, key: string, f: File) {
  if (env.FILES) { await env.FILES.put(key, f.stream(), { httpMetadata: { contentType: f.type || 'application/octet-stream' } }); return; }
  if (f.size > D1_MAX) fail(400, 'Tệp tối đa 1,8MB (kho tệp lớn chưa bật). Tệp lớn hơn hãy gửi link.');
  await run(env.DB, 'INSERT OR REPLACE INTO file_blobs (key,data) VALUES (?,?)', key, await f.arrayBuffer());
}
export async function getFile(env: Env, key: string): Promise<BodyInit | null> {
  if (env.FILES) { const o = await env.FILES.get(key); return o ? o.body : null; }
  const r: any = await first(env.DB, 'SELECT data FROM file_blobs WHERE key=?', key);
  return r ? new Uint8Array(r.data) : null;
}
