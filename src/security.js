import crypto from 'node:crypto';

const ITERATIONS = 210000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export class PasswordService {
  hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return `pbkdf2$${ITERATIONS}$${salt}$${key}`;
  }

  verify(password, storedHash) {
    const [scheme, iterations, salt, key] = String(storedHash).split('$');
    if (scheme !== 'pbkdf2' || !iterations || !salt || !key) return false;
    const calculated = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST);
    const expected = Buffer.from(key, 'hex');
    return expected.length === calculated.length && crypto.timingSafeEqual(expected, calculated);
  }
}

export class SessionService {
  constructor(database, secret) {
    this.database = database;
    this.secret = secret;
    this.ttlMs = 1000 * 60 * 60 * 8;
  }

  create(userId) {
    const raw = crypto.randomBytes(32).toString('hex');
    const id = this.sign(raw);
    const expiresAt = Date.now() + this.ttlMs;
    this.database.run(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (:id, :userId, :expiresAt)',
      { id, userId, expiresAt }
    );
    return { id, expiresAt };
  }

  find(sessionId) {
    if (!sessionId) return null;
    const session = this.database.get(
      `SELECT sessions.id, sessions.expires_at, users.id AS user_id, users.email, users.role
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = :id`,
      { id: sessionId }
    );
    if (!session || session.expires_at < Date.now()) {
      if (session) this.destroy(sessionId);
      return null;
    }
    return session;
  }

  destroy(sessionId) {
    this.database.run('DELETE FROM sessions WHERE id = :id', { id: sessionId });
  }

  sign(value) {
    const hmac = crypto.createHmac('sha256', this.secret).update(value).digest('hex');
    return `${value}.${hmac}`;
  }
}

export function sanitizeText(value, maxLength = 500) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}
