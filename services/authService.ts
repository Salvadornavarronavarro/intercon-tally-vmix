export interface AuthSession {
  email: string;
  authenticatedAt: number;
  expiresAt: number;
}

const STORAGE_KEY = 'intercon_tally_auth_session';
export const SESSION_DURATION_DAYS = 30;
export const THIRTY_DAYS_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

export const GOOGLE_APPS_SCRIPT_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbwDVK2CCI9xgtVNlT0_nHtDs9TRQO19L-6UXNipPIE5o12uh5gaZpqGSlluZxA2HhpgMg/exec';

// High-risk disposable / temporary / burner email domains
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempail.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'grr.la',
  'sharklasers.com',
  'pokemail.net',
  'spam4.me',
  'trashmail.com',
  'trashmail.me',
  'trashmail.at',
  'trashmail.io',
  'getairmail.com',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'throwawaymail.com',
  'dispostable.com',
  'fakeinbox.com',
  'mohmal.com',
  'burnermail.io',
  'inboxkitten.com',
  'crazymailing.com',
  'mytemp.email',
  'dropmail.me',
  'emailondeck.com',
  'generator.email',
  'getnada.com',
  'maildrop.cc',
  'nada.ltd',
  'mytrashmail.com',
  'fastmail.fm',
  'harakirimail.com',
  'binkmail.com',
  'safetymail.info',
]);

const FAKE_TEST_DOMAINS = new Set([
  'test.com',
  'test.test',
  'example.com',
  'example.org',
  'example.net',
  'asdf.com',
  'fake.com',
  'sample.com',
  'domain.com',
  'invalid.com',
  'mail.com',
  'abc.com',
]);

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const { hostname, port, protocol } = window.location;
    if (port === '8081' || port === '19006') {
      return `${protocol}//${hostname}:3000`;
    }
    return '';
  }
  return '';
}

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
   * Real-time email validation verifying format, valid domain structure, and rejecting burner/temporary emails.
   */
  validateEmail(email: string): { valid: boolean; reason?: string } {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      return { valid: false, reason: 'Introduce tu correo electrónico.' };
    }
    if (trimmed.length > 254) {
      return { valid: false, reason: 'El correo electrónico es demasiado largo.' };
    }

    // Standard RFC-compliant email syntax regex
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(trimmed)) {
      return { valid: false, reason: 'Formato de correo no válido (ej. usuario@estudio.com).' };
    }

    const parts = trimmed.split('@');
    if (parts.length !== 2) {
      return { valid: false, reason: 'Formato de correo no válido.' };
    }

    const domain = parts[1];
    if (!domain.includes('.')) {
      return { valid: false, reason: 'El dominio del correo debe incluir una extensión válida (ej. .com, .es).' };
    }

    const domainParts = domain.split('.');
    const tld = domainParts[domainParts.length - 1];
    if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
      return { valid: false, reason: 'Extensión de dominio inválida (ej. .com, .net, .org, .es).' };
    }

    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      return { valid: false, reason: 'No se permiten correos temporales o desechables. Usa tu correo real o corporativo.' };
    }

    if (FAKE_TEST_DOMAINS.has(domain)) {
      return { valid: false, reason: 'Por favor, introduce un correo electrónico real de trabajo o personal.' };
    }

    return { valid: true };
  },

  /**
   * Helper returning boolean for validity check.
   */
  isValidEmail(email: string): boolean {
    return this.validateEmail(email).valid;
  },

  /**
   * Asynchronously dispatches registration payload to Google Apps Script webhook using mode 'no-cors'.
   * Never blocks or disrupts the user flow.
   */
  async triggerGoogleWebhook(email: string, room: string = '', role: string = 'director'): Promise<void> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanRoom = room.trim();
    const cleanRole = role.trim();

    if (!cleanEmail) return;

    const payload = {
      email: cleanEmail,
      room: cleanRoom,
      role: cleanRole,
    };

    try {
      console.log('[GoogleAppsScriptWebhook] Dispatching registration payload:', payload);
      // HTTP POST with mode 'no-cors' and text/plain prevents CORS preflight OPTIONS failures with Google Apps Script
      fetch(GOOGLE_APPS_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          email: cleanEmail,
          room: cleanRoom,
          role: cleanRole,
        }),
      }).catch((err) => {
        console.warn('[GoogleAppsScriptWebhook] Non-blocking dispatch notice:', err);
      });
    } catch (err) {
      console.warn('[GoogleAppsScriptWebhook] Non-blocking error:', err);
    }
  },

  /**
   * Asynchronously dispatches verified subscriber lead to server backend and Google Sheets pipeline.
   */
  async registerSubscriberLead(
    email: string,
    role: string = 'director',
    room: string = ''
  ): Promise<boolean> {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/subscribers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          role,
          room: room.trim(),
          timestamp: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        console.log(`[authService] Successfully registered lead: ${cleanEmail}`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[authService] Non-blocking subscriber lead sync notice:', err);
      return false;
    }
  },

  /**
   * Stores an authenticated session valid for 30 days and triggers background lead registration.
   */
  login(email: string, role: string = 'director', room: string = ''): AuthSession {
    const cleanEmail = email.trim().toLowerCase();
    const session: AuthSession = {
      email: cleanEmail,
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

    // 1. Immediately trigger the Google Apps Script webhook directly with mode 'no-cors'
    this.triggerGoogleWebhook(cleanEmail, room, role).catch(() => {});

    // 2. Asynchronously log lead into server persistence & server-side Google Sheets dispatcher
    this.registerSubscriberLead(cleanEmail, role, room).catch(() => {});

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
};
