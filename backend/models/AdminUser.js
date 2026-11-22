const mongoose = require('mongoose');

const AdminUserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 60
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    passwordHash: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'LOTTERY_OPERATOR', 'AUDITOR'],
      default: 'LOTTERY_OPERATOR',
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    lastLoginAt: {
      type: Date,
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null
    }
  },
  {
    collection: 'AdminUsers',
    timestamps: true
  }
);

AdminUserSchema.index({ username: 1 }, { unique: true });
AdminUserSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.AdminUser || mongoose.model('AdminUser', AdminUserSchema);
