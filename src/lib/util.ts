export const json = (data: any, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
export class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
export const fail = (status: number, msg: string) => { throw new HttpError(status, msg); };
export async function handle(fn: () => Promise<Response>) {
  try { return await fn(); } catch (e: any) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error(e); return json({ ok: false, error: 'Lỗi hệ thống: ' + (e?.message || e) }, 500);
  }
}
export async function body(request: Request): Promise<any> {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return await request.json(); } catch { fail(400, 'Body JSON không hợp lệ'); } }
  if (ct.includes('form')) return Object.fromEntries((await request.formData()).entries());
  return {};
}
export const vnd = (n: number | null | undefined) => (Number(n || 0)).toLocaleString('vi-VN') + 'đ';
export function randCode(prefix: string, len = 6) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(len));
  return prefix + [...r].map((x) => a[x % a.length]).join('');
}
export const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function cleanPhone(p: string) { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('84') ? '0' + d.slice(2) : d; }
export const isPhone = (p: string) => /^0\d{9,10}$/.test(cleanPhone(p));
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
export function parseJSON<T = any>(s: any, d: T): T { try { return s ? JSON.parse(s) : d; } catch { return d; } }

// Minimal, safe markdown -> HTML (headings, bold, code, lists, links, tables, paragraphs)
export function md(src: string): string {
  if (!src) return '';
  const inline = (t: string) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = src.replace(/\r/g, '').split('\n'); let out = ''; let list: string | null = null; let table: string[][] | null = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const closeTable = () => {
    if (table) { const [h, ...rows] = table.filter((r) => !r.every((c) => /^:?-+:?$/.test(c.trim())));
      out += '<div class="tbl"><table><thead><tr>' + h.map((c) => `<th>${inline(c.trim())}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'; table = null; }
  };
  for (const l of lines) {
    if (/^\|.*\|\s*$/.test(l)) { closeList(); (table ||= []).push(l.trim().slice(1, -1).split('|')); continue; } else closeTable();
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { closeList(); const n = m[1].length + 1; out += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*\d+\.\s+(.*)/))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) { closeList(); }
    else { closeList(); out += `<p>${inline(l)}</p>`; }
  }
  closeList(); closeTable(); return out;
}
