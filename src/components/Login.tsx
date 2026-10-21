import React, { useEffect, useState } from 'react';
import { useAuth } from '../services/AuthContext';
import { Logo } from '../constants';
import { motion } from 'motion/react';
import { AnimatedBackground } from './AnimatedBackground';
import { AUTO_LOGOUT_FLAG } from '../lib/idleLogout';

type Mode = 'login' | 'forgot' | 'code' | 'done';

export const Login: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  // shown when the last sign-out was the automatic one (1 hour without activity); cleared when the person signs in again
  const [autoOut] = useState(() => { try { return !!localStorage.getItem(AUTO_LOGOUT_FLAG); } catch { return false; } });

  // the link in the reset e-mail (#reset=name@company.com) opens the code step with the e-mail filled in
  useEffect(() => {
    const m = /#reset=([^&]+)/.exec(window.location.hash);
    if (m) { try { setEmail(decodeURIComponent(m[1])); } catch { /* ignore */ } setMode('code'); }
  }, []);

  const go = (m: Mode) => { setMode(m); setError(''); setInfo(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      try { localStorage.removeItem(AUTO_LOGOUT_FLAG); } catch { /* ignore */ }
    } catch (err: any) {
      const m = String(err?.message || '');
      setError(m === 'PROFILE_BUSY' ? 'You signed in correctly, but the system is busy and could not load your profile. Please try again in a moment.'
        : m === 'This account has no access' ? 'This account is not active or has no access to Sales Leads. Ask the administrator.'
        : 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const post = async (path: string, payload: any) => {
    const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setIsLoading(true);
    try {
      await post('/auth/forgot', { email: email.trim() });
      setInfo('If this e-mail belongs to an active account, we sent a 6-digit code to it. It can take a minute. Check Junk as well.');
      setMode('code');
    } catch (err: any) { setError(err.message); } finally { setIsLoading(false); }
  };

  const resetNow = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (newPw !== newPw2) { setError('The two passwords are not the same.'); return; }
    setIsLoading(true);
    try {
      await post('/auth/reset', { email: email.trim(), code: code.trim(), password: newPw });
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ }
      setPassword(''); setCode(''); setNewPw(''); setNewPw2('');
      setMode('done');
    } catch (err: any) { setError(err.message); } finally { setIsLoading(false); }
  };

  const link = 'text-sm text-brand-red hover:underline font-medium';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl p-8 border border-white/20 z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <Logo src="https://elsewedydevelopment.com/wp-content/uploads/2023/06/SDM-Logo-web.png" height="h-20" />
          <h1 className="text-sm font-bold mt-2 text-brand-black tracking-widest uppercase">SDM Sales Leads</h1>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {autoOut && <p role="status" className="text-sm text-center rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">You were signed out automatically because there was no activity for 1 hour.</p>}
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">Email Address</label>
              <input type="email" required className="input-field" placeholder="name@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">Password</label>
              <input type="password" required className="input-field" placeholder="••••••••" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-brand-red text-sm text-center">{error}</p>}
            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-lg">{isLoading ? 'Signing in...' : 'Sign In'}</button>
            <div className="text-center"><button type="button" className={link} onClick={() => go('forgot')}>Forgot password?</button></div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={sendCode} className="space-y-6">
            <p className="text-sm text-brand-gray">Enter your work e-mail. We will send you a 6-digit code to set a new password.</p>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">Email Address</label>
              <input type="email" required className="input-field" placeholder="name@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <p className="text-brand-red text-sm text-center">{error}</p>}
            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-lg">{isLoading ? 'Sending...' : 'Send me the code'}</button>
            <div className="flex justify-between">
              <button type="button" className={link} onClick={() => go('login')}>Back to sign in</button>
              <button type="button" className={link} onClick={() => go('code')}>I already have a code</button>
            </div>
          </form>
        )}

        {mode === 'code' && (
          <form onSubmit={resetNow} className="space-y-4">
            {info && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{info}</p>}
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">Email Address</label>
              <input type="email" required className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">6-digit code from the e-mail</label>
              <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required className="input-field tracking-[0.4em] text-center text-lg" placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">New password</label>
              <input type="password" required minLength={8} className="input-field" placeholder="At least 8 characters, letters and numbers" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-1">Confirm new password</label>
              <input type="password" required minLength={8} className="input-field" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="text-brand-red text-sm text-center">{error}</p>}
            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-lg">{isLoading ? 'Saving...' : 'Set new password'}</button>
            <div className="flex justify-between">
              <button type="button" className={link} onClick={() => go('login')}>Back to sign in</button>
              <button type="button" className={link} onClick={() => go('forgot')}>Send a new code</button>
            </div>
          </form>
        )}

        {mode === 'done' && (
          <div className="space-y-6 text-center">
            <p className="text-emerald-700 font-semibold">Your password was changed.</p>
            <button type="button" className="btn-primary w-full py-3 text-lg" onClick={() => go('login')}>Sign in</button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
