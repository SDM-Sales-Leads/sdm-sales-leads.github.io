import { API_BASE, SUPABASE_KEY } from '../config';
import { supabase } from './supabase';

/**
 * The UI was written against an Express server and calls fetch('/api/...').
 * This wrapper sends exactly those calls to the Supabase edge function instead, with the signed-in user's
 * token. Nothing else in the app needs to know where the server lives.
 */
export function installApiFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('/api/') && url !== '/api') return original(input as any, init);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('apikey', SUPABASE_KEY);
    let viewAs = false;
    try { const va = JSON.parse(sessionStorage.getItem('sdm_view_as') || 'null'); if (va?.id) { headers.set('x-view-as', va.id); viewAs = true; } } catch { /* none */ }
    // View as is for looking only. The server refuses changes too, but it lets /users, /admin and /auth through in the admin's own name:
    // refuse every change here as well (crash reports and id lookups stay allowed, like on the server). Signed out (no token) is not
    // View as: a left-over flag in this tab must not block "Forgot password" on the sign-in page
    const method = String(init.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') || 'GET').toUpperCase();
    if (viewAs && token && method !== 'GET' && method !== 'HEAD' && !/^\/api\/(client-issues|client-error|admin\/report-error|crm\/ids)/.test(url)) {
      return new Response(JSON.stringify({ error: 'View as is read-only. Exit View as to make changes.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    let res = await original(API_BASE + url.slice(4), { ...init, headers });
    if (res.status === 401 && token) {
      // two tabs refreshing the token at the same moment can make one call fail: renew the login and try once more before signing out
      try {
        const { data: fresh } = await supabase.auth.refreshSession();
        const t2 = fresh.session?.access_token;
        if (t2 && t2 !== token) { headers.set('Authorization', `Bearer ${t2}`); res = await original(API_BASE + url.slice(4), { ...init, headers }); }
      } catch { /* fall through to the sign-out below */ }
    }
    if (res.status === 401 && token) {
      // the session is no longer valid: go back to the sign-in page
      window.dispatchEvent(new CustomEvent('sdm-session-expired'));
    }
    return res;
  };
}
