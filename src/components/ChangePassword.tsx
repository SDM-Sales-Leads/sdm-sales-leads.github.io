import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../services/AuthContext';
import { Logo } from '../constants';
import { AnimatedBackground } from './AnimatedBackground';

/** Shown instead of the app when an administrator gave you a temporary password. The new password is only accepted with the
 *  6-digit code e-mailed to your work address: that proves the person signing in is the owner of the account. */
export const ChangePassword: React.FC = () => {
  const { logout, user, refreshPermissions } = useAuth();
  const [code, setCode] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);

  const post = async (path: string, payload: any) => {
    const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  };
  const sendCode = async () => {
    setError(''); setInfo('');
    try { await post('/auth/forgot', { email: user?.email || '' }); setInfo(`A 6-digit code was sent to ${user?.email}. It can take a minute: check Junk as well.`); }
    catch (err: any) { setError(err.message); }
  };
  useEffect(() => { if (user?.email && !sent.current) { sent.current = true; void sendCode(); } }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return setError('Enter the 6-digit code from your e-mail.');
    if (a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a)) return setError('Use at least 10 characters, with letters and digits.');
    if (a !== b) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await post('/auth/reset', { email: user?.email || '', code: code.replace(/\s/g, ''), password: a });
      await refreshPermissions();
    } catch (err: any) { setError(err.message || 'Could not change the password.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <AnimatedBackground />
      <form onSubmit={submit} className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl p-8 border border-white/20 z-10 space-y-4">
        <div className="flex flex-col items-center"><Logo height="h-16" /></div>
        <h1 className="text-lg font-bold text-brand-black text-center">Choose your own password</h1>
        <p className="text-sm text-brand-gray text-center">{user?.email}<br />You signed in with a temporary password. To confirm it is you, we e-mailed a 6-digit code to this address.</p>
        {info && <p className="text-emerald-700 text-xs text-center font-semibold">{info}</p>}
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input-field tracking-[0.4em] text-center font-mono text-lg" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <input type="password" autoComplete="new-password" className="input-field" placeholder="New password (10+ characters, letters and digits)" value={a} onChange={(e) => setA(e.target.value)} required />
        <input type="password" autoComplete="new-password" className="input-field" placeholder="Repeat new password" value={b} onChange={(e) => setB(e.target.value)} required />
        {error && <p className="text-brand-red text-sm text-center">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full py-3">{busy ? 'Saving...' : 'Save and continue'}</button>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={() => void sendCode()} className="text-brand-red underline">Send the code again</button>
          <button type="button" onClick={() => logout()} className="text-brand-gray underline">Sign out</button>
        </div>
      </form>
    </div>
  );
};
