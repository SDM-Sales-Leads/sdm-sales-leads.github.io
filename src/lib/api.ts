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
    try { const va = JSON.parse(sessionStorage.getItem('sdm_view_as') || 'null'); if (va?.id) headers.set('x-view-as', va.id); } catch { /* none */ }
    const res = await original(API_BASE + url.slice(4), { ...init, headers });
    if (res.status === 401 && token) {
      // the session is no longer valid: go back to the sign-in page
      window.dispatchEvent(new CustomEvent('sdm-session-expired'));
    }
    return res;
  };
}
