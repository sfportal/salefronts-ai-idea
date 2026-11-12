import type { APIRoute } from 'astro';
import { handle, json, body, fail } from '../../lib/util';
import { all, first, run } from '../../lib/db';
import { supportReply, type ChatMsg } from '../../lib/ai';

export const POST: APIRoute = ({ request, locals }) => handle(async () => {
  const env = locals.runtime.env; const b = await body(request); const text = String(b.text || '').trim().slice(0, 1000);
  if (!text) fail(400, 'Câu hỏi trống');
  let s: any = await first(env.DB, "SELECT * FROM support_sessions WHERE vid=? AND status!='closed' ORDER BY id DESC LIMIT 1", locals.vid);
  if (!s) { await run(env.DB, 'INSERT INTO support_sessions (vid,user_id) VALUES (?,?)', locals.vid, locals.user?.id || null); s = await first(env.DB, 'SELECT * FROM support_sessions WHERE vid=? ORDER BY id DESC LIMIT 1', locals.vid); }
  const n: any = await first(env.DB, "SELECT COUNT(*) n FROM support_messages WHERE session_id=? AND created_at > datetime('now','-1 hour')", s.id);
  if (n.n > 40) fail(429, 'Bạn hỏi hơi nhanh, đợi chút hoặc nhắn Zalo 0938 266 958 nhé.');
  await run(env.DB, 'INSERT INTO support_messages (session_id,role,content) VALUES (?,?,?)', s.id, 'user', text);
  const hist = await all<ChatMsg>(env.DB, 'SELECT role,content FROM support_messages WHERE session_id=? ORDER BY id DESC LIMIT 12', s.id);
  let reply: string;
  try { reply = await supportReply(env, locals.settings, hist.reverse()); } catch (e: any) { reply = 'Trợ lý đang bận. Bạn nhắn Zalo 0938 266 958 nhé.'; }
  const human = /(gặp người|nhân viên|tư vấn viên|gọi lại)/i.test(text);
  await run(env.DB, "INSERT INTO support_messages (session_id,role,content) VALUES (?,?,?)", s.id, 'assistant', reply);
  await run(env.DB, `UPDATE support_sessions SET updated_at=datetime('now'), user_id=COALESCE(user_id,?) ${human ? ", status='needs_human'" : ''} WHERE id=?`, locals.user?.id || null, s.id);
  return json({ ok: true, reply });
});

export const GET: APIRoute = ({ locals }) => handle(async () => {
  const env = locals.runtime.env;
  const s: any = await first(env.DB, "SELECT id FROM support_sessions WHERE vid=? AND status!='closed' ORDER BY id DESC LIMIT 1", locals.vid);
  const messages = s ? await all(env.DB, 'SELECT role,content FROM support_messages WHERE session_id=? ORDER BY id DESC LIMIT 30', s.id) : [];
  return json({ ok: true, messages: messages.reverse() });
});
