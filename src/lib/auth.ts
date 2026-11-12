import { first, run } from './db';
import { fail, randCode } from './util';

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const SESSION_DAYS = 30;
export const ROLE_LEVEL: Record<string, number> = { customer: 0, staff: 1, admin: 2, owner: 3 };

function secret(env: Env) { return env.SESSION_SECRET || 'dev-only-secret-change-me'; }

async function hmac(env: Env, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export async function sign(env: Env, payload: any) {
  const p = b64u(enc.encode(JSON.stringify(payload))); return p + '.' + (await hmac(env, p));
}
export async function verify(env: Env, token: string | undefined | null): Promise<any | null> {
  if (!token || !token.includes('.')) return null;
  const [p, s] = token.split('.'); if ((await hmac(env, p)) !== s) return null;
  try { const v = JSON.parse(new TextDecoder().decode(fromB64u(p))); return v.exp && v.exp < Date.now() ? null : v; } catch { return null; }
}

export async function hashPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$100000$${b64u(salt)}$${b64u(bits)}`;
}
export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false; const [, it, s, h] = stored.split('$');
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromB64u(s), iterations: Number(it), hash: 'SHA-256' }, key, 256);
  return b64u(bits) === h;
}
export async function sha256(s: string) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

export function cookie(name: string, value: string, maxAge: number, httpOnly = true) {
  return `${name}=${value}; Path=/; ${httpOnly ? 'HttpOnly; ' : ''}Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function readCookie(request: Request, name: string) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null;
}

export async function sessionCookie(env: Env, uid: number) {
  const token = await sign(env, { uid, exp: Date.now() + SESSION_DAYS * 864e5 });
  return cookie('sid', token, SESSION_DAYS * 86400);
}
export async function currentUser(env: Env, request: Request) {
  const s = await verify(env, readCookie(request, 'sid')); if (!s?.uid) return null;
  return first(env.DB, 'SELECT id,email,name,phone,role,ref_code,avatar,referred_by,created_at,must_change_pw FROM users WHERE id=? AND active=1', s.uid);
}
export function need(user: any, role: 'customer' | 'staff' | 'admin' | 'owner') {
  if (!user) fail(401, 'Bạn cần đăng nhập');
  if ((ROLE_LEVEL[user.role] ?? 0) < ROLE_LEVEL[role]) fail(403, 'Bạn không có quyền này');
}

async function uniqueRef(env: Env) {
  for (let i = 0; i < 6; i++) { const c = randCode('', 6); if (!(await first(env.DB, 'SELECT 1 FROM users WHERE ref_code=?', c))) return c; }
  return randCode('', 8);
}
// Create or update a user; owner email always becomes owner.
export async function upsertUser(env: Env, u: { email: string; name?: string; phone?: string; password?: string; google_sub?: string; avatar?: string; ref?: string | null }) {
  const email = u.email.trim().toLowerCase();
  // Owner role is granted only through a verified Google login for OWNER_EMAIL
  const isOwner = !!u.google_sub && email === (env.OWNER_EMAIL || '').toLowerCase();
  let row: any = await first(env.DB, 'SELECT * FROM users WHERE email=?', email);
  if (!row) {
    const referrer: any = u.ref ? await first(env.DB, 'SELECT id FROM users WHERE ref_code=?', u.ref.toUpperCase()) : null;
    await run(env.DB, 'INSERT INTO users (email,name,phone,password_hash,google_sub,avatar,role,ref_code,referred_by) VALUES (?,?,?,?,?,?,?,?,?)',
      email, u.name || null, u.phone || null, u.password ? await hashPassword(u.password) : null, u.google_sub || null, u.avatar || null,
      isOwner ? 'owner' : 'customer', await uniqueRef(env), referrer?.id || null);
    row = await first(env.DB, 'SELECT * FROM users WHERE email=?', email);
  } else {
    await run(env.DB, `UPDATE users SET name=COALESCE(name,?), phone=COALESCE(phone,?), google_sub=COALESCE(?,google_sub), avatar=COALESCE(?,avatar), role=CASE WHEN ? THEN 'owner' ELSE role END WHERE id=?`,
      u.name || null, u.phone || null, u.google_sub || null, u.avatar || null, isOwner ? 1 : 0, row.id);
  }
  return row;
}

// Google OAuth 2.0 / OpenID Connect
export function googleAuthUrl(env: Env, origin: string, state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || '', redirect_uri: origin + '/api/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}
export async function googleExchange(env: Env, origin: string, code: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: origin + '/api/auth/google/callback', grant_type: 'authorization_code' }),
  });
  if (!r.ok) fail(400, 'Google từ chối đăng nhập: ' + (await r.text()).slice(0, 200));
  const t: any = await r.json();
  const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } });
  if (!u.ok) fail(400, 'Không đọc được thông tin Google');
  const info: any = await u.json();
  if (!info.email_verified) fail(400, 'Email Google chưa xác minh');
  return info as { sub: string; email: string; name: string; picture: string };
}
