// One-password login for the admin and team hub.
//
// The password is the secret ADMIN_PASSWORD (set in Cloudflare under Variables and Secrets).
// A correct password gets a signed cookie that lasts 14 days. The cookie is signed with a key made
// from the password, so changing the password signs everyone out. Too many wrong guesses in a row
// from one address are blocked for a while.

const COOKIE = 'knight_hub';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW_S = 15 * 60;
const enc = new TextEncoder();

export function adminEnabled(env) {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= 8;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compare passwords without leaking their length or where they differ. */
export async function passwordMatches(env, given) {
  if (!adminEnabled(env)) return false;
  const [a, b] = await Promise.all([hmacHex('compare', String(given ?? '')), hmacHex('compare', env.ADMIN_PASSWORD)]);
  return sameText(a, b);
}

export async function makeSession(env, now = new Date()) {
  const expires = now.getTime() + SESSION_MS;
  return `${expires}.${await hmacHex(`session|${env.ADMIN_PASSWORD}`, String(expires))}`;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function hasSession(request, env, now = new Date()) {
  if (!adminEnabled(env)) return false;
  const value = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (!value) return false;
  const [expires, sig] = value.split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < now.getTime()) return false;
  return sameText(sig, await hmacHex(`session|${env.ADMIN_PASSWORD}`, expires));
}

export function sessionCookie(value, request, { clear = false } = {}) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${clear ? '' : value}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${clear ? 0 : Math.floor(SESSION_MS / 1000)}`;
}

// ---------- slowing down password guessing ----------

const failKey = (request) => `login-fails:${request.headers.get('cf-connecting-ip') || 'local'}`;

export async function tooManyFails(request, env) {
  if (!env.REPORTS) return false;
  try {
    const rec = await env.REPORTS.get(failKey(request), 'json');
    return !!rec && rec.count >= MAX_FAILS;
  } catch {
    return false;
  }
}

export async function noteFail(request, env) {
  if (!env.REPORTS) return;
  try {
    const rec = (await env.REPORTS.get(failKey(request), 'json')) || { count: 0 };
    await env.REPORTS.put(failKey(request), JSON.stringify({ count: rec.count + 1 }), { expirationTtl: FAIL_WINDOW_S });
  } catch {
    // Not being able to count must never lock the owner out.
  }
}

export async function clearFails(request, env) {
  if (!env.REPORTS || !env.REPORTS.delete) return;
  try {
    await env.REPORTS.delete(failKey(request));
  } catch {
    // ignore
  }
}

/** Changes need the hub's own header, so another website cannot make your browser send them. */
export function isHubRequest(request) {
  return request.headers.get('x-requested-with') === 'knight-hub';
}
