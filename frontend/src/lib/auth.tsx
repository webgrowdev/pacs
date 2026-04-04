/**
 * Auth context — HIPAA §164.312(a)(2)(i)
 *
 * Security decisions:
 *  - Access token: kept in memory only (React state) — lost on page refresh but
 *    restored via /auth/refresh which reads the httpOnly cookie
 *  - Refresh token: httpOnly cookie set by server — never accessible to JavaScript
 *  - User profile: stored in sessionStorage (cleared on tab close), NOT localStorage
 *  - Idle timeout: 30 minutes of inactivity auto-logs out (HIPAA workstation timeout)
 *  - mustChangePassword: enforced at login — redirected to /change-password
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode
} from 'react';
import { api } from './api';

export type UserRole = 'ADMIN' | 'DOCTOR' | 'PATIENT';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

// ─── Idle timeout configuration ───────────────────────────────────────────────
const IDLE_TIMEOUT_MS  = 30 * 60 * 1000; // 30 minutes (HIPAA workstation standard)
const IDLE_WARN_MS     = 25 * 60 * 1000; // warn at 25 minutes

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,               setUser]               = useState<AuthUser | null>(null);
  const [isLoading,          setIsLoading]          = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const idleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutRef    = useRef<(() => Promise<void>) | null>(null);

  // ─── Restore session on mount (via httpOnly cookie refresh) ────────────────
  useEffect(() => {
    const init = async () => {
      // Try to restore user from sessionStorage (survives page refresh in same tab)
      const stored = sessionStorage.getItem('pacsUser');
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as AuthUser;
          // Verify by refreshing the access token via cookie
          const { data } = await api.post('/auth/refresh', {});
          setAccessToken(data.accessToken);
          setUser(parsed);
        } catch {
          // Cookie expired — clear session
          sessionStorage.removeItem('pacsUser');
        }
      }
      setIsLoading(false);
    };
    init();
  }, []);

  // ─── Idle timeout logic ────────────────────────────────────────────────────
  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current)  clearTimeout(idleTimer.current);
    if (warnTimer.current)  clearTimeout(warnTimer.current);

    if (!user) return;

    warnTimer.current = setTimeout(() => {
      // Show a non-blocking warning (could be a toast/modal in the future)
      console.warn('[SESSION] Sesión por expirar por inactividad en 5 minutos');
    }, IDLE_WARN_MS);

    idleTimer.current = setTimeout(() => {
      console.warn('[SESSION] Cierre de sesión por inactividad (30 min)');
      logoutRef.current?.();
    }, IDLE_TIMEOUT_MS);
  }, [user]);

  // Register activity event listeners when user is logged in
  useEffect(() => {
    if (!user) return;

    const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    EVENTS.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
    resetIdleTimer(); // start the initial timer

    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (warnTimer.current) clearTimeout(warnTimer.current);
    };
  }, [user, resetIdleTimer]);

  // ─── Login ─────────────────────────────────────────────────────────────────
  const login = async (email: string, password: string): Promise<{ mustChangePassword: boolean }> => {
    const { data } = await api.post('/auth/login', { email, password });

    const authUser: AuthUser = {
      id:        data.user.id,
      email:     data.user.email,
      firstName: data.user.firstName,
      lastName:  data.user.lastName,
      role:      data.user.role
    };

    // Store access token in memory (via api interceptor)
    setAccessToken(data.accessToken);

    // Store user profile in sessionStorage (not localStorage — clears on tab close)
    sessionStorage.setItem('pacsUser', JSON.stringify(authUser));

    setUser(authUser);
    setMustChangePassword(!!data.mustChangePassword);

    return { mustChangePassword: !!data.mustChangePassword };
  };

  // ─── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {}

    // Clear all local state — server already cleared httpOnly cookie
    clearAccessToken();
    sessionStorage.removeItem('pacsUser');
    setUser(null);
    setMustChangePassword(false);

    if (idleTimer.current)  clearTimeout(idleTimer.current);
    if (warnTimer.current)  clearTimeout(warnTimer.current);
  }, []);

  // Keep logoutRef up to date for idle timer closure
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      mustChangePassword,
      login,
      logout,
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// ─── In-memory access token store ─────────────────────────────────────────────
// The access token lives ONLY in memory — not in localStorage or sessionStorage.
// This prevents XSS from stealing tokens. It's lost on page refresh but
// restored automatically via the httpOnly refresh cookie.
let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

export function getAccessToken(): string | null {
  return _accessToken;
}
