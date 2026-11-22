const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LotteryEvent',
      default: null,
      index: true
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    entityType: {
      type: String,
      enum: [
        'PARTICIPANT',
        'FLAT',
        'FIXED_MAPPING',
        'ALLOCATION',
        'LOTTERY_EVENT',
        'ADMIN_USER',
        'BACKUP',
        'SYSTEM'
      ],
      default: 'SYSTEM',
      index: true
    },
    entityId: {
      type: String,
      default: ''
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
      index: true
    },
    actorUsername: {
      type: String,
      default: 'system'
    },
    actorRole: {
      type: String,
      default: 'SYSTEM'
    },
    ipAddress: {
      type: String,
      default: ''
    },
    summary: {
      type: String,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    collection: 'AuditLogs',
    timestamps: { createdAt: true, updatedAt: false }
  }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ eventId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
