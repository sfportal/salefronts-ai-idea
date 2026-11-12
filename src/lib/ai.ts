import Anthropic from '@anthropic-ai/sdk';
import { esc, parseJSON } from './util';

export type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Opts = { system: string; messages: ChatMsg[]; maxTokens?: number; schema?: any; effort?: 'low' | 'medium' | 'high' };

export function aiAvailable(env: Env, provider: string) {
  return provider === 'deepseek' ? !!env.DEEPSEEK_API_KEY : !!env.ANTHROPIC_API_KEY;
}

// One call to the configured provider. Returns text (JSON text when schema is given).
export async function complete(env: Env, provider: string, model: string, o: Opts): Promise<string> {
  if (provider === 'deepseek') {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: model || 'deepseek-chat', max_tokens: Math.min(o.maxTokens || 4000, 8000),
        messages: [{ role: 'system', content: o.system + (o.schema ? '\n\nTrả lời DUY NHẤT bằng một object JSON hợp lệ theo schema: ' + JSON.stringify(o.schema) : '') }, ...o.messages],
        ...(o.schema ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!r.ok) throw new Error('DeepSeek lỗi ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const d: any = await r.json(); return d.choices?.[0]?.message?.content || '';
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.beta.messages.create({
    model: model || 'claude-opus-5-5',
    max_tokens: o.maxTokens || 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: o.system,
    messages: o.messages,
    output_config: { effort: o.effort || 'low', ...(o.schema ? { format: { type: 'json_schema', schema: o.schema } } : {}) },
  } as any);
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối yêu cầu này');
  return res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
}

// ---------------------------------------------------------------- Requirement interview
const INTERVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reply', 'fields', 'done', 'out_of_template', 'out_note'],
  properties: {
    reply: { type: 'string', description: 'Câu trả lời tiếp theo gửi khách, tiếng Việt, ngắn gọn' },
    fields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } } },
    done: { type: 'boolean' },
    out_of_template: { type: 'boolean' },
    out_note: { type: 'string' },
  },
};

export type InterviewResult = { reply: string; fields: Record<string, string>; done: boolean; out_of_template: boolean; out_note: string };

// Points asked for every template, before the template's own options.
export const COMMON_OPTIONS = [
  { key: 'brand_name', label: 'Tên thương hiệu hiển thị', question: 'Tên thương hiệu hoặc cửa hàng sẽ hiển thị trên sản phẩm là gì?', required: true, price: 0 },
  { key: 'color', label: 'Màu chủ đạo', question: 'Bạn thích màu chủ đạo nào? Ví dụ: xanh lá, cam đất, đen vàng, hoặc mã màu #ff7a45.', required: true, price: 0 },
  { key: 'logo', label: 'Logo', question: 'Bạn có logo không? Bấm 📎 để tải logo lên, hoặc ghi "chưa có" để Salefronts làm logo chữ.', required: false, price: 0 },
  { key: 'slogan', label: 'Thông điệp chính / slogan', question: 'Câu thông điệp chính hoặc slogan bạn muốn khách nhớ là gì?', required: false, price: 0 },
  { key: 'audience', label: 'Khách hàng mục tiêu', question: 'Khách hàng chính của bạn là ai (độ tuổi, khu vực, mua lẻ hay doanh nghiệp)?', required: true, price: 0 },
  { key: 'refs', label: 'Mẫu tham khảo', question: 'Có website, video hay hình mẫu nào bạn thích để tham khảo không? Dán link giúp mình.', required: false, price: 0 },
];
export function tplOptions(tpl: any): any[] {
  const own = parseJSON<any[]>(tpl.options, []).filter((o) => o.key !== 'brand');
  return [...COMMON_OPTIONS.filter((c) => !own.some((o) => o.key === c.key)), ...own];
}
export function missingRequired(tpl: any, fields: Record<string, string>) {
  return tplOptions(tpl).filter((o) => o.required && !String(fields[o.key] || '').trim());
}

export async function interview(env: Env, s: Record<string, string>, ctx: { lead: any; tpl: any; fields: Record<string, string>; history: ChatMsg[]; userText: string }): Promise<InterviewResult> {
  const { tpl, lead, fields } = ctx;
  const options = tplOptions(tpl);
  if (!aiAvailable(env, s.ai_provider)) return mockInterview(tpl, options, fields, ctx.userText);
  const system = `Bạn là trợ lý của Salefronts, giúp khách SME chốt yêu cầu làm sản phẩm số. Luôn nói tiếng Việt, thân thiện, câu ngắn.
Khách: ${lead.name}, ngành ${lead.industry || 'chưa rõ'}, công ty ${lead.company || 'chưa rõ'}.
Loại sản phẩm: ${tpl.kind}. Mẫu đã chọn: "${tpl.name}". Mô tả mẫu: ${tpl.summary}
Sản phẩm luôn làm TRÊN MẪU NÀY. Các điểm chỉnh được của mẫu (key, câu hỏi, bắt buộc?):
${options.map((o) => `- ${o.key}: ${o.label}. Hỏi: "${o.question}". ${o.required ? 'BẮT BUỘC' : 'tùy chọn'}${o.price ? `, cộng ${o.price}đ nếu chọn` : ''}`).join('\n')}
Thông tin đã có: ${JSON.stringify(fields)}

Quy tắc:
- Mỗi lượt chỉ hỏi 1 đến 2 điểm còn thiếu, ưu tiên điểm bắt buộc. Gợi ý 2 đến 3 lựa chọn cụ thể theo ngành của khách để khách chọn nhanh.
- Câu trả lời mơ hồ (ví dụ "đẹp", "tuỳ bạn") thì hỏi lại một lần kèm gợi ý, rồi ghi lựa chọn hợp lý nhất và nói rõ để khách sửa được.
- Khách có thể tự sửa phiếu ở khung bên cạnh, nên luôn dựa trên "Thông tin đã có".
- Ghi mọi thông tin khách vừa cung cấp vào "fields" (key đúng như danh sách trên, value là tóm tắt rõ ràng). Với điểm tùy chọn có giá, ghi value bắt đầu bằng "Có" hoặc "Không".
- Khách có thể tải tệp; tin nhắn "[Đã tải tệp: ...]" nghĩa là đã có tư liệu.
- Nếu khách muốn điều mà mẫu không làm được hoặc khác hẳn mẫu, đặt out_of_template=true và ghi rõ phần khác vào out_note; nói với khách phần này sẽ được Salefronts báo giá riêng.
- Không tự báo giá. Không hứa thời gian khác mẫu (${tpl.days} ngày).
- Khi mọi điểm bắt buộc đã đủ và đã hỏi qua điểm tùy chọn, đặt done=true và nói khách bấm "Tổng kết & xem mockup".`;
  const out = await complete(env, s.ai_provider, s.ai_model, {
    system, schema: INTERVIEW_SCHEMA, maxTokens: 2000,
    messages: [...ctx.history.slice(-16), { role: 'user', content: ctx.userText }],
  });
  const r = parseJSON<any>(out, null);
  if (!r) return { reply: out || 'Mình chưa hiểu, bạn nói rõ hơn giúp mình nhé.', fields: {}, done: false, out_of_template: false, out_note: '' };
  const f: Record<string, string> = {};
  for (const x of r.fields || []) if (x?.key && options.some((o) => o.key === x.key)) f[x.key] = String(x.value);
  const merged = { ...fields, ...f };
  return { reply: r.reply, fields: f, done: !!r.done && missingRequired(tpl, merged).length === 0, out_of_template: !!r.out_of_template, out_note: r.out_note || '' };
}

// Rule-based interviewer used when no AI key is configured (and in tests).
function mockInterview(tpl: any, options: any[], fields: Record<string, string>, text: string): InterviewResult {
  const asked = fields.__asked; const f: Record<string, string> = {};
  const t = text.trim();
  if (asked && t && !t.startsWith('[Bắt đầu]')) f[asked] = t;
  const oot = /(khác hoàn toàn|hoàn toàn khác|không theo mẫu|khác mẫu|làm mới từ đầu)/i.test(t);
  const merged = { ...fields, ...f };
  const next = options.find((o) => !String(merged[o.key] || '').trim() && o.question);
  if (next) {
    f.__asked = next.key;
    const lead = asked ? 'Cảm ơn bạn, mình đã ghi lại. ' : `Chào bạn! Mình sẽ hỏi vài câu để chốt yêu cầu cho mẫu "${tpl.name}". `;
    return { reply: lead + next.question + (next.required ? '' : ' (không bắt buộc, trả lời "không" để bỏ qua)'), fields: f, done: false, out_of_template: oot, out_note: oot ? t : '' };
  }
  f.__asked = '';
  return { reply: 'Mình đã có đủ thông tin. Bạn bấm "Tổng kết & xem mockup" để xem phiếu yêu cầu và bản mô phỏng nhé.', fields: f, done: true, out_of_template: oot, out_note: oot ? t : '' };
}

// ---------------------------------------------------------------- Brief (summary form)
export function priceFor(tpl: any, fields: Record<string, string>) {
  const options = tplOptions(tpl);
  let base = Number(tpl.base_price) || 0; const lines: { label: string; amount: number }[] = [];
  const num = (k: string) => { const m = String(fields[k] || '').match(/\d+/); return m ? Number(m[0]) : 0; };
  if (tpl.slug === 'media-catalogue') base = Math.max(12, num('pages') || 12) * 150000;
  else if (options.some((o) => o.key === 'count') && num('count') > 0) base = base * (tpl.slug === 'media-anh-ai' ? Math.max(1, Math.ceil(num('count') / 20)) : num('count'));
  lines.push({ label: tpl.name, amount: base });
  for (const o of options) if (o.price && /^(có|co|yes|cần|can|ok|đồng ý)/i.test(String(fields[o.key] || '').trim())) lines.push({ label: o.label, amount: o.price });
  return { lines, total: lines.reduce((a, b) => a + b.amount, 0) };
}

export function buildBriefMd(order: any, lead: any, tpl: any, fields: Record<string, string>, price: { lines: any[]; total: number }, files: string[] = []) {
  const options = tplOptions(tpl);
  const rows = options.map((o) => `| ${o.label} | ${String(fields[o.key] || (o.required ? '(thiếu)' : 'Không')).replace(/\|/g, '/').replace(/\n/g, ' ')} |`).join('\n');
  return `## Phiếu yêu cầu ${order.code}

| Mục | Nội dung |
| --- | --- |
| Khách hàng | ${lead.name} · ${lead.phone} |
| Công ty / ngành | ${lead.company || '-'} · ${lead.industry || '-'} |
| Loại kết quả | ${({ web: 'Web', extension: 'Extension', media: 'Media' } as any)[tpl.kind]} |
| Mẫu | ${tpl.name} |
| Thời gian làm | ${tpl.days} ngày làm việc từ khi duyệt |

### Yêu cầu chi tiết

| Điểm chỉnh | Khách chọn |
| --- | --- |
${rows}
${files.length ? `\n### Tư liệu khách gửi\n\n${files.map((f) => '- ' + f).join('\n')}\n` : ''}${fields.notes ? `\n### Ghi chú thêm của khách\n\n${String(fields.notes)}\n` : ''}${order.out_of_template ? `\n### Ngoài mẫu (Salefronts báo giá riêng)\n\n${order.out_of_template_note || ''}\n` : ''}
### Chi phí

| Hạng mục | Số tiền |
| --- | --- |
${price.lines.map((l) => `| ${l.label} | ${l.amount.toLocaleString('vi-VN')}đ |`).join('\n')}
| **Tổng** | **${price.total.toLocaleString('vi-VN')}đ** |
`;
}

// ---------------------------------------------------------------- Mockup
export type MockAsset = { name: string; data: string };
type MockCtx = { lead: any; tpl: any; fields: Record<string, string>; previous?: string; feedback?: string; assets?: MockAsset[] };

const COLOR_WORDS: [RegExp, string][] = [
  [/xanh (lá|lục|ngọc lá)|green/i, '#2e9d4f'], [/xanh (ngọc|mint)|teal/i, '#14a3a3'], [/(navy|xanh (đen|than|đậm))/i, '#1f2f6b'],
  [/xanh (dương|biển|da trời)|blue/i, '#1e7be6'], [/\bcam\b|orange/i, '#f47b20'], [/đỏ|red/i, '#e0352b'], [/hồng|pink/i, '#ec4f8c'],
  [/tím|purple/i, '#8a3ffc'], [/vàng|gold|yellow/i, '#e6a817'], [/nâu|brown|cà phê/i, '#7a4b2a'], [/(be|kem|beige)\b/i, '#cdb48f'],
  [/đen|black/i, '#1b1b1f'], [/xám|gray|grey/i, '#6b7280'],
];
export function pickColor(fields: Record<string, string>, fallback: string) {
  const src = [fields.color, fields.brand, fields.__revisions].filter(Boolean).join('\n');
  const hexes = src.match(/#[0-9a-f]{6}\b/gi); if (hexes?.length) return hexes[hexes.length - 1];
  let best = fallback, at = -1;
  for (const [re, hex] of COLOR_WORDS) { const g = new RegExp(re.source, 'gi'); let m; while ((m = g.exec(src))) if (m.index > at) { at = m.index; best = hex; } }
  return best;
}
const isLogo = (n: string) => /logo/i.test(n);

export async function makeMockup(env: Env, s: Record<string, string>, ctx: MockCtx) {
  const assets = (ctx.assets || []).slice().sort((a, b) => Number(isLogo(b.name)) - Number(isLogo(a.name)));
  ctx = { ...ctx, assets };
  if (!aiAvailable(env, s.ai_provider)) return mockMockup(ctx);
  const imgNote = assets.length ? `\nKhách đã gửi ${assets.length} ảnh. Dùng đúng các ảnh này bằng thẻ <img src="{{IMGn}}"> (n từ 1): ${assets.map((a, i) => `IMG${i + 1} = "${a.name}"${isLogo(a.name) ? ' (logo)' : ''}`).join('; ')}. Logo đặt ở đầu trang; ảnh khác dùng cho banner, sản phẩm hoặc khung hình.` : '';
  const color = pickColor(ctx.fields, ctx.tpl.accent || '#7c5cff');
  const system = `Bạn là designer của Salefronts. Tạo MỘT tệp HTML tĩnh hoàn chỉnh (có <style> bên trong, KHÔNG dùng <script>, không tải tài nguyên ngoài trừ Google Fonts) mô phỏng kết quả dự kiến cho khách, làm trên mẫu "${ctx.tpl.name}" (${ctx.tpl.kind}).
- web: trang chủ của website theo mẫu, thay tên, màu, logo chữ, nội dung theo yêu cầu.
- extension: khung popup tiện ích Chrome 380x560 đặt giữa trang, có các tab và nút theo yêu cầu.
- media: storyboard dạng lưới 6 khung hình (mỗi khung: số cảnh, mô tả hình, chữ trên màn hình, lời đọc), kèm thông tin khổ hình và thời lượng.
Dùng tiếng Việt, đẹp, hiện đại, đọc tốt trên điện thoại. Màu chủ đạo bắt buộc: ${color}. Dùng đúng tên thương hiệu, slogan, khách hàng mục tiêu và mọi nội dung khách đã chốt, không bịa thêm tính năng ngoài phiếu. Chỗ cần ảnh mà khách chưa gửi thì dùng khối gradient có chú thích.${imgNote} Chỉ trả về HTML, không giải thích.`;
  const user = `Khách: ${ctx.lead.name}, ${ctx.lead.company || ''}, ngành ${ctx.lead.industry || ''}.
Yêu cầu đã chốt: ${JSON.stringify(Object.fromEntries(Object.entries(ctx.fields).filter(([k]) => !k.startsWith('__'))))}
${ctx.feedback ? `Đây là bản sửa. Góp ý của khách: ${ctx.feedback}\nGiữ nguyên những gì khách không nhắc tới.` : ''}`;
  const messages: ChatMsg[] = ctx.previous && ctx.feedback
    ? [{ role: 'user', content: user.split('\nĐây là bản sửa')[0] }, { role: 'assistant', content: assets.reduce((h, a, i) => h.split(a.data).join(`{{IMG${i + 1}}}`), ctx.previous).replace(/data:image\/[^"')\s]+/g, '').slice(0, 60000) }, { role: 'user', content: 'Sửa theo góp ý: ' + ctx.feedback }]
    : [{ role: 'user', content: user }];
  let html = await complete(env, s.ai_provider, s.ai_model, { system, messages, maxTokens: 12000 });
  html = sanitizeHtml(html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim());
  return html.replace(/\{\{IMG(\d+)\}\}/g, (_, n) => assets[Number(n) - 1]?.data || '');
}

export function sanitizeHtml(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
}

function mockMockup(ctx: MockCtx) {
  const { tpl, lead, fields } = ctx; const brand = esc(String(fields.brand_name || fields.brand || lead.company || lead.name).split(/[,.;\n]/)[0].trim().slice(0, 60));
  const color = pickColor(fields, tpl.accent || '#7c5cff');
  const assets = ctx.assets || []; const logo = assets.find((a) => isLogo(a.name)); const pics = assets.filter((a) => a !== logo);
  const logoHtml = logo ? `<img src="${logo.data}" alt="logo" style="height:40px;max-width:160px;object-fit:contain;vertical-align:middle;margin-right:10px">` : '';
  const ph = (i: number, label: string, h = 120) => pics.length ? `<div class="ph" style="height:${h}px;background:url(${pics[i % pics.length].data}) center/cover"></div>` : `<div class="ph" style="height:${h}px">${label}</div>`;
  const slogan = esc(String(fields.slogan || '').slice(0, 120));
  const fb = ctx.feedback ? `<div class="note">Đã cập nhật theo góp ý: ${esc(ctx.feedback)}</div>` : '';
  const base = `<style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b0b14;color:#f4f4f8}.note{background:#fff3;padding:8px 14px;font-size:13px}
  .c{max-width:980px;margin:auto;padding:28px}.btn{display:inline-block;background:${color};color:#fff;padding:12px 20px;border-radius:999px;font-weight:600;text-decoration:none}
  .g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.card{background:#ffffff10;border:1px solid #ffffff1f;border-radius:16px;padding:16px}
  .ph{height:120px;border-radius:12px;background:linear-gradient(135deg,${color},#111);display:flex;align-items:flex-end;padding:10px;font-size:12px;color:#fffc}</style>`;
  if (tpl.kind === 'web') {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${base}</head><body>${fb}
    <header class="c" style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:22px;color:${color}">${logoHtml}${brand}</b><nav style="opacity:.8;font-size:14px">Sản phẩm · Giới thiệu · Liên hệ · Giỏ hàng (0)</nav></header>
    <section class="c" style="padding:60px 28px"><p style="color:${color};font-weight:600">${esc(lead.industry || '')}</p><h1 style="font-size:44px;line-height:1.1;margin:8px 0">${slogan || brand + '<br>đặt mua online, giao tận nơi'}</h1>${pics[0] ? `<img src="${pics[0].data}" style="width:100%;max-height:360px;object-fit:cover;border-radius:18px;margin:10px 0">` : ''}
    <p style="opacity:.8;max-width:560px">${esc(String(fields.products || tpl.summary).slice(0, 220))}</p><a class="btn">Mua ngay</a></section>
    <section class="c"><h2>Sản phẩm nổi bật</h2><div class="g">${[1, 2, 3, 4].map((i) => `<div class="card">${ph(i, 'Ảnh sản phẩm ' + i)}<p><b>Sản phẩm ${i}</b><br><span style="color:${color}">${(i * 120000).toLocaleString('vi-VN')}đ</span></p><a class="btn" style="padding:8px 14px;font-size:13px">Thêm vào giỏ</a></div>`).join('')}</div></section>
    <section class="c"><div class="card"><b>Thanh toán:</b> ${esc(fields.payment || 'COD và chuyển khoản VietQR')}<br><b>Tên miền:</b> ${esc(fields.domain || '')}</div></section>
    <footer class="c" style="opacity:.6;font-size:13px">© ${brand} · Web dựng trên mẫu "${esc(tpl.name)}" bởi Salefronts</footer></body></html>`;
  }
  if (tpl.kind === 'extension') {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${base}</head><body style="display:grid;place-items:center;min-height:100vh;background:radial-gradient(circle at 30% 20%,${color}55,#0b0b14 60%)">${fb}
    <div style="width:380px;max-width:94vw;background:#14141f;border:1px solid #ffffff22;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px #0008">
    <div style="background:${color};padding:14px 16px;font-weight:700">${logoHtml}${brand} <span style="opacity:.8;font-weight:400">· tiện ích Chrome</span></div>
    <div style="display:flex;gap:6px;padding:10px 12px;font-size:13px"><span class="btn" style="padding:6px 12px">Khách hàng</span><span style="padding:6px 12px;opacity:.7">Chiến dịch</span><span style="padding:6px 12px;opacity:.7">Cài đặt</span></div>
    <div style="padding:6px 14px 16px">${['Nguyễn Văn A', 'Trần Thị B', 'Lê Văn C'].map((n, i) => `<div class="card" style="margin:8px 0;padding:10px;display:flex;justify-content:space-between"><span>${n}</span><span style="font-size:12px;background:${color}33;padding:2px 8px;border-radius:999px">${esc((String(fields.labels || fields.fields || 'Mới, VIP, Đã mua').split(/[,;]/)[i] || 'Mới').trim())}</span></div>`).join('')}
    <p style="font-size:12px;opacity:.7">${esc(String(fields.templates || fields.export || '').slice(0, 160))}</p><a class="btn" style="width:100%;text-align:center">Gửi tin chăm sóc</a></div></div></body></html>`;
  }
  const scenes = ['Mở đầu: logo và câu hook', 'Cận cảnh sản phẩm', 'Lợi ích chính', 'Khách hàng dùng thực tế', 'Ưu đãi / lời kêu gọi', 'Kết: logo, số Zalo'];
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${base}</head><body>${fb}<div class="c">
  <h1 style="margin:0">${logoHtml}${brand} · Storyboard</h1>${slogan ? `<p style="color:${color};font-weight:600">${slogan}</p>` : ''}<p style="opacity:.7">Mẫu: ${esc(tpl.name)} · ${esc(fields.length || fields.count || '')} · khổ ${tpl.slug === 'media-tvc' ? '16:9 và 9:16' : '9:16'}</p>
  <div class="g">${scenes.map((sc, i) => `<div class="card">${ph(i, 'Cảnh ' + (i + 1), tpl.slug === 'media-tvc' ? 110 : 200)}<p><b>${sc}</b><br><span style="font-size:13px;opacity:.8">Chữ: ${esc(String(fields.message || fields.points || fields.scene || brand).split(/[,.;\n]/)[i % 3] || brand)}</span></p></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><b>Giọng đọc:</b> ${esc(fields.voice || 'Theo phiếu')} · <b>Tư liệu:</b> ${esc(fields.assets || 'Khách gửi')}</div></div></body></html>`;
}

// ---------------------------------------------------------------- Support chatbot
export async function supportReply(env: Env, s: Record<string, string>, history: ChatMsg[]) {
  const provider = s.support_provider || 'claude';
  if (!aiAvailable(env, provider)) {
    const q = (history.at(-1)?.content || '').toLowerCase();
    const kb: [RegExp, string][] = [
      [/giá|bao nhiêu|chi phí/, 'Giá phụ thuộc mẫu bạn chọn: video Reels từ 350.000đ, mini-shop 990.000đ, web bán hàng từ 4.900.000đ, extension từ 1.500.000đ. Khi chat xong, phiếu yêu cầu sẽ hiện giá chính xác.'],
      [/thanh toán|chuyển khoản|qr/, 'Bạn thanh toán bằng mã VietQR sau khi duyệt mockup. Hệ thống tự xác nhận trong vài giây khi tiền về. Đơn từ 5 triệu chỉ cần cọc 50%.'],
      [/sửa|chỉnh/, 'Bạn được sửa mockup tối đa 2 lần trước khi thanh toán. Sau khi giao, mỗi mẫu có số vòng chỉnh sửa ghi trong phiếu.'],
      [/tư vấn|đặt lịch|gọi/, 'Bạn có thể đặt lịch tư vấn AI 60 phút (2.000.000đ) ở trang Đặt lịch tư vấn. Phí được trừ vào đơn nếu đặt làm trong 14 ngày.'],
      [/kết quả|nhận|tải/, 'Kết quả (link web/GitHub, file extension hoặc media) kèm hướng dẫn sử dụng nằm trong Tài khoản > Đơn của tôi.'],
      [/giới thiệu|affiliate|hoa hồng/, 'Mỗi tài khoản có link giới thiệu riêng ở Tài khoản > Giới thiệu bạn bè: bạn nhận 10% đơn đã giao, bạn bè giảm 5% đơn đầu.'],
    ];
    const hit = kb.find(([re]) => re.test(q));
    return hit ? hit[1] : 'Mình có thể giúp bạn về quy trình đặt làm, giá, thanh toán, nhận kết quả. Bạn cần người hỗ trợ trực tiếp? Nhắn Zalo 0938 266 958.';
  }
  return complete(env, provider, provider === 'deepseek' ? s.deepseek_model : s.support_model, {
    system: `Bạn là trợ lý chăm sóc khách hàng của Salefronts. Trả lời tiếng Việt, ngắn (tối đa 4 câu), chỉ dựa vào thông tin sau; không biết thì mời khách nhắn Zalo 0938 266 958.\n\n${s.support_kb}`,
    messages: history.slice(-12), maxTokens: 800,
  });
}

// ---------------------------------------------------------------- Hand-off package for Claude (uyminh-6)
export function handoffMd(order: any, lead: any, tpl: any, fields: Record<string, string>, files: any[], origin: string) {
  return `# Giao việc ${order.code}: ${tpl.name}

Thực hiện trong project **uyminh-6**. Làm TRÊN MẪU, chỉ đổi các điểm khách đã chốt.

- Khách: ${lead.name} · ${lead.phone} · ${lead.company || ''} · ${lead.industry || ''}
- Loại: ${tpl.kind} · Mẫu: ${tpl.slug}${tpl.repo_url ? ` · Repo mẫu: ${tpl.repo_url}` : ''}${tpl.demo_url ? ` · Demo: ${tpl.demo_url}` : ''}
- Thời hạn: ${tpl.days} ngày làm việc

## Chỉ dẫn của mẫu
${tpl.claude_notes || '(chưa có)'}

## Yêu cầu khách đã chốt
${Object.entries(fields).filter(([k]) => !k.startsWith('__')).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}
${order.out_of_template ? `\n## Ngoài mẫu (đã báo giá riêng)\n${order.out_of_template_note}\n` : ''}
## Tư liệu khách gửi
${files.length ? files.map((f) => `- [${f.name}](${origin}/api/files/${f.id})`).join('\n') : '- (không có)'}

## Mockup khách đã duyệt
${origin}/admin/orders/${order.id}#mockup

## Đầu ra cần trả
- ${tpl.kind === 'web' ? 'Link web chạy thật + link repo GitHub' : tpl.kind === 'extension' ? 'File .zip extension + link repo GitHub' : 'Tệp media (ảnh/video) đúng khổ'}
- Hướng dẫn sử dụng theo khung sau, điền chi tiết riêng của khách:

${tpl.guide_md || ''}
`;
}
