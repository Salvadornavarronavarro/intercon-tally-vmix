export interface AuthSession {
  email: string;
  authenticatedAt: number;
  expiresAt: number;
}

const STORAGE_KEY = 'intercon_tally_auth_session';
export const SESSION_DURATION_DAYS = 30;
export const THIRTY_DAYS_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

export const authService = {
  /**
   * Retrieves the current authenticated session from localStorage if valid and non-expired.
   */
  getSession(): AuthSession | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const session: AuthSession = JSON.parse(raw);
      if (!session || typeof session.email !== 'string' || typeof session.expiresAt !== 'number') {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      if (Date.now() > session.expiresAt) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return session;
    } catch (e) {
      console.warn('[authService] Error parsing session from localStorage:', e);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {}
      return null;
    }
  },

  /**
   * Stores an authenticated session valid for 30 days.
   */
  login(email: string): AuthSession {
    const session: AuthSession = {
      email: email.trim().toLowerCase(),
      authenticatedAt: Date.now(),
      expiresAt: Date.now() + THIRTY_DAYS_MS,
    };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch (err) {
        console.warn('[authService] Could not write session to localStorage:', err);
      }
    }
    return session;
  },

  /**
   * Clears the stored session from localStorage.
   */
  logout(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.warn('[authService] Could not remove session from localStorage:', err);
      }
    }
  },

  /**
   * Checks whether the given string is a valid email address.
   */
  isValidEmail(email: string): boolean {
    const trimmed = email.trim();
    if (!trimmed || trimmed.length > 254) return false;
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return emailRegex.test(trimmed);
  },
};
