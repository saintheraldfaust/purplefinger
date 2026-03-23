const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    description: { type: String, default: '', trim: true },
    productKey: { type: String, required: true, unique: true, uppercase: true, index: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    voiceWindowStartedAt: { type: Date, default: null },
    voiceCharsUsed: { type: Number, default: 0 },
    sessionStartedAt: { type: Date, default: null },
    sessionEndsAt: { type: Date, default: null },
    sessionMsUsed: { type: Number, default: 0 },
    sessionCooldownUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
