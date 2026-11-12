export const all = async <T = any>(db: D1Database, sql: string, ...args: any[]): Promise<T[]> => (await db.prepare(sql).bind(...args).all<T>()).results || [];
export const first = <T = any>(db: D1Database, sql: string, ...args: any[]) => db.prepare(sql).bind(...args).first<T>();
export const run = (db: D1Database, sql: string, ...args: any[]) => db.prepare(sql).bind(...args).run();
export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
}
export async function setSetting(db: D1Database, key: string, value: string) {
  await run(db, 'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}
export async function audit(db: D1Database, actor: string, action: string, target = '', data: any = null) {
  await run(db, 'INSERT INTO audit (actor,action,target,data) VALUES (?,?,?,?)', actor, action, target, data ? JSON.stringify(data) : null);
}
export async function track(db: D1Database, e: { vid?: string; user_id?: number | null; type: string; data?: any; ip?: string | null; ua?: string | null }) {
  await run(db, 'INSERT INTO events (vid,user_id,type,data,ip,ua) VALUES (?,?,?,?,?,?)', e.vid || null, e.user_id || null, e.type, e.data ? JSON.stringify(e.data) : null, e.ip || null, (e.ua || '').slice(0, 200));
}
