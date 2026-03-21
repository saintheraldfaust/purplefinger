const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true, trim: true },
    category: { type: String, default: 'info', trim: true },
    createdBy: { type: String, default: 'admin', trim: true },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'notifications',
  },
);

notificationSchema.index({ userId: 1, readAt: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
