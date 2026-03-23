const crypto = require('crypto');
const User = require('./models/User');
const Notification = require('./models/Notification');

const PRODUCT_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

class LicenseStore {
  constructor(options = {}) {
    this.userSessionTtlMs = Number(options.userSessionTtlMs || 7 * 24 * 60 * 60 * 1000);
    this.adminSessionTtlMs = Number(options.adminSessionTtlMs || 12 * 60 * 60 * 1000);
    this.adminUsername = String(options.adminUsername || 'admin').trim();
    this.adminPassword = String(options.adminPassword || 'change-me');

    this.userSessions = new Map();  // token -> { userId, expiresAt }
    this.adminSessions = new Map(); // token -> { username, expiresAt }
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

  // ─── Users ───────────────────────────────────────────────

  async listUsers() {
    return User.find().sort({ createdAt: -1 }).lean();
  }

  async getUserById(userId) {
    try {
      return await User.findById(userId).lean();
    } catch (_) {
      return null;
    }
  }

  async getUserByProductKey(productKey) {
    const key = String(productKey || '').trim().toUpperCase();
    if (!key) return null;
    return User.findOne({ productKey: key }).lean();
  }

  async getUserByEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    return User.findOne({ email: normalized }).lean();
  }

  async _uniqueProductKey() {
    for (let i = 0; i < 20; i++) {
      const candidate = generateProductKey(12);
      const existing = await User.findOne({ productKey: candidate }).lean();
      if (!existing) return candidate;
    }
    throw new Error('Could not generate a unique product key');
  }

  async createUser({ name, email, description }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('name is required');

    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail) {
      const taken = await this.getUserByEmail(normalizedEmail);
      if (taken) throw new Error('email already exists');
    }

    const productKey = await this._uniqueProductKey();
    const user = await User.create({
      name: cleanName,
      email: normalizedEmail,
      description: String(description || '').trim(),
      productKey,
      active: true,
    });
    return user.toObject();
  }

  async updateUser(userId, payload = {}) {
    const user = await User.findById(userId);
    if (!user) throw new Error('user not found');

    if (payload.name !== undefined) {
      const nextName = String(payload.name || '').trim();
      if (!nextName) throw new Error('name is required');
      user.name = nextName;
    }
    if (payload.email !== undefined) {
      const nextEmail = normalizeEmail(payload.email);
      if (nextEmail) {
        const taken = await User.findOne({ email: nextEmail, _id: { $ne: userId } }).lean();
        if (taken) throw new Error('email already exists');
      }
      user.email = nextEmail;
    }
    if (payload.description !== undefined) {
      user.description = String(payload.description || '').trim();
    }
    if (payload.active !== undefined) {
      user.active = !!payload.active;
    }

    await user.save();
    return user.toObject();
  }

  async regenerateProductKey(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('user not found');

    user.productKey = await this._uniqueProductKey();
    await user.save();

    // Invalidate any active sessions for this user
    for (const [token, session] of this.userSessions.entries()) {
      if (session?.userId === String(userId)) this.userSessions.delete(token);
    }

    return user.toObject();
  }

  // ─── User Sessions ──────────────────────────────────────

  async createUserSession(productKey) {
    this._cleanupSessions();
    const user = await this.getUserByProductKey(productKey);
    if (!user || !user.active) throw new Error('invalid product key');

    const token = generateToken(30);
    this.userSessions.set(token, {
      userId: String(user._id),
      expiresAt: Date.now() + this.userSessionTtlMs,
    });

    await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
    const updated = await User.findById(user._id).lean();

    return {
      token,
      expiresInSec: Math.floor(this.userSessionTtlMs / 1000),
      user: updated,
    };
  }

  async getUserBySessionToken(token) {
    this._cleanupSessions();
    const normalized = String(token || '').trim();
    if (!normalized) return null;

    const session = this.userSessions.get(normalized);
    if (!session) return null;

    const user = await User.findById(session.userId).lean();
    if (!user || !user.active) {
      this.userSessions.delete(normalized);
      return null;
    }
    return user;
  }

  async inspectUserSessionToken(token) {
    this._cleanupSessions();
    const normalized = String(token || '').trim();
    if (!normalized) return { ok: false, reason: 'missing_token' };

    const session = this.userSessions.get(normalized);
    if (!session) return { ok: false, reason: 'missing_session' };

    const user = await User.findById(session.userId).lean();
    if (!user) {
      this.userSessions.delete(normalized);
      return { ok: false, reason: 'missing_user' };
    }
    if (!user.active) {
      this.userSessions.delete(normalized);
      return { ok: false, reason: 'inactive_user', user };
    }
    return { ok: true, user };
  }

  async reserveVoiceCharacters(userId, charCount, options = {}) {
    const limit = Number(options.limit || 5000);
    const windowMs = Number(options.windowMs || 60 * 60 * 1000);
    const requested = Math.max(0, Number(charCount || 0));
    const user = await User.findById(userId);
    if (!user) throw new Error('user not found');

    const nowMs = Date.now();
    const startMs = user.voiceWindowStartedAt ? user.voiceWindowStartedAt.getTime() : 0;
    const expired = !startMs || (nowMs - startMs) >= windowMs;

    if (expired) {
      user.voiceWindowStartedAt = new Date(nowMs);
      user.voiceCharsUsed = 0;
    }

    const used = Number(user.voiceCharsUsed || 0);
    const resetAt = new Date((user.voiceWindowStartedAt?.getTime() || nowMs) + windowMs);

    if ((used + requested) > limit) {
      return { ok: false, used, requested, limit, resetAt };
    }

    user.voiceCharsUsed = used + requested;
    await user.save();
    return { ok: true, used: user.voiceCharsUsed, requested, limit, resetAt };
  }

  async beginSessionWindow(userId, options = {}) {
    const sessionMs = Number(options.sessionMs || 60 * 60 * 1000);
    const cooldownMs = Number(options.cooldownMs || 60 * 60 * 1000);
    const user = await User.findById(userId);
    if (!user) throw new Error('user not found');

    const nowMs = Date.now();
    const hasLegacyCooldown = (user.sessionMsUsed === undefined || user.sessionMsUsed === null) && !!user.sessionCooldownUntil;
    if (hasLegacyCooldown) {
      user.sessionStartedAt = null;
      user.sessionEndsAt = null;
      user.sessionMsUsed = 0;
      user.sessionCooldownUntil = null;
    }

    const previousCooldownUntilMs = user.sessionCooldownUntil ? user.sessionCooldownUntil.getTime() : 0;
    if (previousCooldownUntilMs && nowMs >= previousCooldownUntilMs) {
      user.sessionStartedAt = null;
      user.sessionEndsAt = null;
      user.sessionMsUsed = 0;
      user.sessionCooldownUntil = null;
    }

    const cooldownUntilMs = user.sessionCooldownUntil ? user.sessionCooldownUntil.getTime() : 0;
    if (cooldownUntilMs && nowMs < cooldownUntilMs) {
      return { ok: false, cooldownUntil: user.sessionCooldownUntil, sessionEndsAt: user.sessionEndsAt };
    }

    const usedMs = Math.max(0, Math.min(sessionMs, Number(user.sessionMsUsed || 0)));
    const remainingMs = Math.max(0, sessionMs - usedMs);
    if (remainingMs <= 0) {
      user.sessionStartedAt = null;
      user.sessionEndsAt = null;
      user.sessionCooldownUntil = new Date(nowMs + cooldownMs);
      await user.save();
      return { ok: false, cooldownUntil: user.sessionCooldownUntil, sessionEndsAt: null };
    }

    user.sessionStartedAt = new Date(nowMs);
    user.sessionEndsAt = new Date(nowMs + remainingMs);
    user.sessionCooldownUntil = null;
    await user.save();

    return {
      ok: true,
      sessionStartedAt: user.sessionStartedAt,
      sessionEndsAt: user.sessionEndsAt,
      cooldownUntil: user.sessionCooldownUntil,
      usedMs,
      remainingMs,
    };
  }

  async finalizeSessionUsage(userId, options = {}) {
    const sessionMs = Number(options.sessionMs || 60 * 60 * 1000);
    const cooldownMs = Number(options.cooldownMs || 60 * 60 * 1000);
    const endedAtMs = Math.max(0, Number(options.endedAtMs || Date.now()));
    const user = await User.findById(userId);
    if (!user) throw new Error('user not found');

    const hasLegacyCooldown = (user.sessionMsUsed === undefined || user.sessionMsUsed === null) && !!user.sessionCooldownUntil;
    if (hasLegacyCooldown) {
      user.sessionMsUsed = 0;
      user.sessionCooldownUntil = null;
    }

    const cooldownUntilMs = user.sessionCooldownUntil ? user.sessionCooldownUntil.getTime() : 0;
    if (cooldownUntilMs && endedAtMs >= cooldownUntilMs) {
      user.sessionMsUsed = 0;
      user.sessionCooldownUntil = null;
    }

    const startedAtMs = user.sessionStartedAt ? user.sessionStartedAt.getTime() : 0;
    const baseUsedMs = Math.max(0, Math.min(sessionMs, Number(user.sessionMsUsed || 0)));
    const segmentUsedMs = startedAtMs ? Math.max(0, endedAtMs - startedAtMs) : 0;
    const totalUsedMs = Math.min(sessionMs, baseUsedMs + segmentUsedMs);

    user.sessionMsUsed = totalUsedMs;
    user.sessionStartedAt = null;
    user.sessionEndsAt = null;
    user.sessionCooldownUntil = totalUsedMs >= sessionMs ? new Date(endedAtMs + cooldownMs) : null;
    await user.save();

    return {
      ok: true,
      usedMs: user.sessionMsUsed,
      remainingMs: Math.max(0, sessionMs - user.sessionMsUsed),
      cooldownUntil: user.sessionCooldownUntil,
    };
  }

  async getUsageSnapshot(userId, options = {}) {
    const voiceLimit = Number(options.voiceLimit || 5000);
    const voiceWindowMs = Number(options.voiceWindowMs || 60 * 60 * 1000);
    const sessionLimitMs = Number(options.sessionMs || 60 * 60 * 1000);
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('user not found');

    const nowMs = Date.now();
    const voiceStartMs = user.voiceWindowStartedAt ? new Date(user.voiceWindowStartedAt).getTime() : 0;
    const voiceExpired = !voiceStartMs || (nowMs - voiceStartMs) >= voiceWindowMs;
    const voiceUsed = voiceExpired ? 0 : Number(user.voiceCharsUsed || 0);
    const voiceResetAt = new Date((voiceExpired ? nowMs : voiceStartMs) + voiceWindowMs);

    const sessionEndsAt = user.sessionEndsAt ? new Date(user.sessionEndsAt) : null;
    const ownedActive = options.activeSession && String(options.activeSession.ownerUserId || '') === String(user._id || '');
    const sessionActive = !!(ownedActive && sessionEndsAt && sessionEndsAt.getTime() > nowMs);
    const hasLegacyCooldown = (user.sessionMsUsed === undefined || user.sessionMsUsed === null) && !!user.sessionCooldownUntil;
    const cooldownUntil = hasLegacyCooldown ? null : (user.sessionCooldownUntil ? new Date(user.sessionCooldownUntil) : null);
    const baseUsedMs = Math.max(0, Math.min(sessionLimitMs, Number(user.sessionMsUsed || 0)));
    const liveSegmentMs = sessionActive && user.sessionStartedAt ? Math.max(0, nowMs - new Date(user.sessionStartedAt).getTime()) : 0;
    const usedMs = Math.min(sessionLimitMs, baseUsedMs + liveSegmentMs);
    const remainingMs = Math.max(0, sessionLimitMs - usedMs);

    return {
      voice: {
        limit: voiceLimit,
        used: voiceUsed,
        remaining: Math.max(0, voiceLimit - voiceUsed),
        resetAt: voiceResetAt,
        resetInMs: Math.max(0, voiceResetAt.getTime() - nowMs),
      },
      session: {
        limitMs: sessionLimitMs,
        active: sessionActive,
        usedMs,
        remainingMs,
        startedAt: user.sessionStartedAt || null,
        endsAt: sessionEndsAt,
        activeRemainingMs: sessionActive ? remainingMs : 0,
        cooldownUntil,
        cooldownRemainingMs: cooldownUntil ? Math.max(0, cooldownUntil.getTime() - nowMs) : 0,
      },
    };
  }

  invalidateUserToken(token) {
    this.userSessions.delete(String(token || '').trim());
  }

  // ─── Admin Sessions ─────────────────────────────────────

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

  // ─── User lookup by any identifier ──────────────────────

  async findUserByIdentifier({ userId, email, productKey }) {
    if (userId) {
      const user = await this.getUserById(String(userId).trim());
      if (user) return user;
    }
    if (email) {
      const user = await this.getUserByEmail(email);
      if (user) return user;
    }
    if (productKey) {
      const user = await this.getUserByProductKey(productKey);
      if (user) return user;
    }
    return null;
  }

  // ─── Notifications ──────────────────────────────────────

  async createNotification({ userId, message, category = 'info', createdBy = 'admin' }) {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('user not found');

    const text = String(message || '').trim();
    if (!text) throw new Error('message is required');

    const notification = await Notification.create({
      userId: user._id,
      message: text,
      category: String(category || 'info').trim() || 'info',
      createdBy: String(createdBy || 'admin').trim() || 'admin',
    });

    return notification.toObject();
  }

  async listNotificationsForUser(userId, options = {}) {
    const includeRead = !!options.includeRead;
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));

    const filter = { userId };
    if (!includeRead) filter.readAt = null;

    return Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async markNotificationRead(userId, notificationId) {
    const notification = await Notification.findOne({ _id: notificationId, userId });
    if (!notification) throw new Error('notification not found');
    if (notification.readAt) return notification.toObject();

    notification.readAt = new Date();
    await notification.save();
    return notification.toObject();
  }
}

module.exports = { LicenseStore };
