const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRODUCT_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function generateToken(size = 24) {
  return crypto.randomBytes(size).toString('base64url');
}

function generateProductKey(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PRODUCT_KEY_ALPHABET[Math.floor(Math.random() * PRODUCT_KEY_ALPHABET.length)];
  }
  return out;
}

class LicenseStore {
  constructor(options = {}) {
    this.dbPath = path.resolve(process.cwd(), options.dbPath || '.licenses.json');
    this.userSessionTtlMs = Number(options.userSessionTtlMs || 7 * 24 * 60 * 60 * 1000);
    this.adminSessionTtlMs = Number(options.adminSessionTtlMs || 12 * 60 * 60 * 1000);
    this.adminUsername = String(options.adminUsername || 'admin').trim();
    this.adminPassword = String(options.adminPassword || 'change-me');

    this.userSessions = new Map(); // token -> { userId, expiresAt }
    this.adminSessions = new Map(); // token -> { username, expiresAt }
    this.db = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        const seed = { users: [], notifications: [] };
        this._save(seed);
        return seed;
      }
      const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      if (!Array.isArray(data.users)) data.users = [];
      if (!Array.isArray(data.notifications)) data.notifications = [];
      return data;
    } catch {
      return { users: [], notifications: [] };
    }
  }

  _save(nextDb = this.db) {
    this.db = nextDb;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf8');
  }

  _cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of this.userSessions.entries()) {
      if (!session || session.expiresAt <= now) this.userSessions.delete(token);
    }
    for (const [token, session] of this.adminSessions.entries()) {
      if (!session || session.expiresAt <= now) this.adminSessions.delete(token);
    }
  }

  listUsers() {
    return [...this.db.users].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getUserById(userId) {
    return this.db.users.find((u) => u.id === userId) || null;
  }

  getUserByProductKey(productKey) {
    const key = String(productKey || '').trim().toUpperCase();
    if (!key) return null;
    return this.db.users.find((u) => u.productKey === key) || null;
  }

  getUserByEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    return this.db.users.find((u) => normalizeEmail(u.email) === normalized) || null;
  }

  _uniqueProductKey() {
    for (let i = 0; i < 20; i++) {
      const candidate = generateProductKey(12);
      if (!this.getUserByProductKey(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not generate a unique product key');
  }

  createUser({ name, email, description }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new Error('name is required');
    }

    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail && this.getUserByEmail(normalizedEmail)) {
      throw new Error('email already exists');
    }

    const user = {
      id: generateId('usr'),
      name: cleanName,
      email: normalizedEmail,
      description: String(description || '').trim(),
      productKey: this._uniqueProductKey(),
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastLoginAt: null,
    };

    const nextDb = {
      ...this.db,
      users: [...this.db.users, user],
    };
    this._save(nextDb);
    return user;
  }

  updateUser(userId, payload = {}) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('user not found');

    const nextName = payload.name !== undefined ? String(payload.name || '').trim() : user.name;
    const nextEmail = payload.email !== undefined ? normalizeEmail(payload.email) : user.email;
    const nextDescription = payload.description !== undefined ? String(payload.description || '').trim() : user.description;
    const nextActive = payload.active !== undefined ? !!payload.active : user.active;

    if (!nextName) throw new Error('name is required');
    if (nextEmail) {
      const takenBy = this.getUserByEmail(nextEmail);
      if (takenBy && takenBy.id !== userId) {
        throw new Error('email already exists');
      }
    }

    const updated = {
      ...user,
      name: nextName,
      email: nextEmail,
      description: nextDescription,
      active: nextActive,
      updatedAt: nowIso(),
    };

    const nextUsers = this.db.users.map((u) => (u.id === userId ? updated : u));
    this._save({ ...this.db, users: nextUsers });
    return updated;
  }

  regenerateProductKey(userId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('user not found');

    const updated = {
      ...user,
      productKey: this._uniqueProductKey(),
      updatedAt: nowIso(),
    };

    const nextUsers = this.db.users.map((u) => (u.id === userId ? updated : u));
    this._save({ ...this.db, users: nextUsers });

    for (const [token, session] of this.userSessions.entries()) {
      if (session?.userId === userId) this.userSessions.delete(token);
    }

    return updated;
  }

  createUserSession(productKey) {
    this._cleanupSessions();
    const user = this.getUserByProductKey(productKey);
    if (!user || !user.active) {
      throw new Error('invalid product key');
    }

    const token = generateToken(30);
    this.userSessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + this.userSessionTtlMs,
    });

    const nextUser = { ...user, lastLoginAt: nowIso(), updatedAt: nowIso() };
    const nextUsers = this.db.users.map((u) => (u.id === user.id ? nextUser : u));
    this._save({ ...this.db, users: nextUsers });

    return {
      token,
      expiresInSec: Math.floor(this.userSessionTtlMs / 1000),
      user: nextUser,
    };
  }

  getUserBySessionToken(token) {
    this._cleanupSessions();
    const normalized = String(token || '').trim();
    if (!normalized) return null;

    const session = this.userSessions.get(normalized);
    if (!session) return null;

    const user = this.getUserById(session.userId);
    if (!user || !user.active) {
      this.userSessions.delete(normalized);
      return null;
    }
    return user;
  }

  invalidateUserToken(token) {
    this.userSessions.delete(String(token || '').trim());
  }

  createAdminSession(username, password) {
    this._cleanupSessions();
    if (String(username || '').trim() !== this.adminUsername || String(password || '') !== this.adminPassword) {
      throw new Error('invalid admin credentials');
    }

    const token = generateToken(30);
    this.adminSessions.set(token, {
      username: this.adminUsername,
      expiresAt: Date.now() + this.adminSessionTtlMs,
    });

    return {
      token,
      expiresInSec: Math.floor(this.adminSessionTtlMs / 1000),
      username: this.adminUsername,
    };
  }

  isValidAdminToken(token) {
    this._cleanupSessions();
    const normalized = String(token || '').trim();
    if (!normalized) return false;
    return this.adminSessions.has(normalized);
  }

  findUserByIdentifier({ userId, email, productKey }) {
    if (userId) {
      const user = this.getUserById(String(userId).trim());
      if (user) return user;
    }
    if (email) {
      const user = this.getUserByEmail(email);
      if (user) return user;
    }
    if (productKey) {
      const user = this.getUserByProductKey(productKey);
      if (user) return user;
    }
    return null;
  }

  createNotification({ userId, message, category = 'info', createdBy = 'admin' }) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('user not found');

    const text = String(message || '').trim();
    if (!text) throw new Error('message is required');

    const notification = {
      id: generateId('ntf'),
      userId,
      message: text,
      category: String(category || 'info').trim() || 'info',
      createdBy: String(createdBy || 'admin').trim() || 'admin',
      createdAt: nowIso(),
      readAt: null,
    };

    this._save({
      ...this.db,
      notifications: [...this.db.notifications, notification],
    });

    return notification;
  }

  listNotificationsForUser(userId, options = {}) {
    const includeRead = !!options.includeRead;
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));

    return this.db.notifications
      .filter((n) => n.userId === userId)
      .filter((n) => includeRead || !n.readAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  markNotificationRead(userId, notificationId) {
    const target = this.db.notifications.find((n) => n.id === notificationId && n.userId === userId);
    if (!target) throw new Error('notification not found');
    if (target.readAt) return target;

    const updated = { ...target, readAt: nowIso() };
    const nextNotifications = this.db.notifications.map((n) => (n.id === target.id ? updated : n));
    this._save({ ...this.db, notifications: nextNotifications });
    return updated;
  }
}

module.exports = { LicenseStore };
