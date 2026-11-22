const mongoose = require('mongoose');

const AllocationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LotteryEvent',
      required: true,
      index: true
    },
    allocationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    sequenceNumber: {
      type: Number,
      required: true,
      index: true
    },
    allocationType: {
      type: String,
      enum: ['FIXED', 'RANDOM'],
      required: true,
      index: true
    },
    participantRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      required: true
    },
    participantId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    participantName: {
      type: String,
      required: true,
      trim: true
    },
    registrationNumber: {
      type: String,
      default: ''
    },
    mobileNumber: {
      type: String,
      default: ''
    },
    flatRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Flat',
      required: true
    },
    flatNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    wing: {
      type: String,
      default: '',
      index: true
    },
    floor: {
      type: String,
      default: '',
      index: true
    },
    building: {
      type: String,
      default: ''
    },
    societyName: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['SUCCESSFULLY_ALLOCATED', 'AMENDED_BY_ADMIN'],
      default: 'SUCCESSFULLY_ALLOCATED'
    },
    verificationHash: {
      type: String,
      required: true
    },
    verificationPayload: {
      type: String,
      required: true
    },
    idempotencyKey: {
      type: String,
      default: undefined
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true
    },
    initiatedByName: {
      type: String,
      required: true
    },
    allocatedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    collection: 'Allocations',
    timestamps: true
  }
);

// Database-level guarantees:
// 1. Every Allocation ID is globally unique
// 2. One Participant can NEVER receive more than 1 Flat in an event
// 3. One Flat can NEVER be allocated to more than 1 Participant in an event
// 4. Repeated clicks with the same idempotencyKey cannot create duplicates
AllocationSchema.index({ allocationId: 1 }, { unique: true });
AllocationSchema.index({ eventId: 1, participantRef: 1 }, { unique: true });
AllocationSchema.index({ eventId: 1, flatRef: 1 }, { unique: true });
AllocationSchema.index({ eventId: 1, participantId: 1 }, { unique: true });
AllocationSchema.index({ eventId: 1, flatNumber: 1 }, { unique: true });
AllocationSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
AllocationSchema.index({ eventId: 1, allocationType: 1, allocatedAt: -1 });

module.exports = mongoose.models.Allocation || mongoose.model('Allocation', AllocationSchema);
