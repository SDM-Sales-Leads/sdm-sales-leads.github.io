import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, RolePermissions } from '../types';
import { supabase } from '../lib/supabase';
import { wipeCrmCache } from '../lib/storageGuard';
import { fetchWithTimeout } from '../lib/fetchUtils';

interface AuthContextType {
  user: User | null;
  permissions: RolePermissions | null;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  isLoading: boolean;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { shownId.current = user?.id != null ? String(user.id) : null; }, [user]);
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [mustChangePassword, setMustChange] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // who am I, and what may I do? (decided by the server from my login)
  const shownId = React.useRef<string | null>(null);   // the person this tab is showing
  const meStatus = React.useRef(0);   // last answer of /me (0 = no answer at all): tells a refused account from a busy server
  const loadMe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout('/api/me', {}, 15000);
      meStatus.current = res.status;
      if (!res.ok) return false;
      const data = await res.json();
      setUser(data.user);
      setPermissions(data.permissions);
      setMustChange(!!data.user?.mustChangePassword);
      return true;
    } catch {
      meStatus.current = 0;
      return false;
    }
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setPermissions(null);
    setMustChange(false);
    wipeCrmCache();
    try { sessionStorage.removeItem('sdm_view_as'); } catch { /* ignore */ }
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error('Invalid credentials');
    // a busy server must not look like a wrong password: try the profile a few times before giving up
    let ok = await loadMe();
    for (let i = 0; i < 3 && !ok && (meStatus.current === 0 || meStatus.current >= 500); i++) { await new Promise((r) => setTimeout(r, 1500)); ok = await loadMe(); }
    if (!ok) {
      await supabase.auth.signOut();
      throw new Error(meStatus.current === 401 || meStatus.current === 403 ? 'This account has no access' : 'PROFILE_BUSY');
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    clear();
  };

  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message || 'Could not change the password');
    await fetchWithTimeout('/api/me/password-changed', { method: 'POST' }, 15000);
    setMustChange(false);
  };

  const refreshPermissions = async () => { await loadMe(); };

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const ok = await loadMe();
        if (!ok && alive) { await supabase.auth.signOut(); clear(); }
      }
      if (alive) setIsLoading(false);
    })();
    const onExpired = () => { supabase.auth.signOut().finally(clear); };
    window.addEventListener('sdm-session-expired', onExpired);
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') clear();
      // another tab signed in as a DIFFERENT person: the login is shared by every tab of this browser, so this tab would keep
      // showing the old person's screens while loading the new person's data. Reload so the screens match the login.
      else if (session?.user?.id && shownId.current && session.user.id !== shownId.current) window.location.reload();
    });
    return () => { alive = false; window.removeEventListener('sdm-session-expired', onExpired); sub.subscription.unsubscribe(); };
  }, [loadMe, clear]);

  return (
    <AuthContext.Provider value={{ user, permissions, mustChangePassword, login, logout, changePassword, isLoading, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
