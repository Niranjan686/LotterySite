const mongoose = require('mongoose');

const FlatSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LotteryEvent',
      required: true,
      index: true
    },
    flatNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50
    },
    wing: {
      type: String,
      trim: true,
      default: '',
      maxlength: 60,
      index: true
    },
    floor: {
      type: String,
      trim: true,
      default: '',
      maxlength: 30,
      index: true
    },
    building: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 250
    },
    sequenceOrder: {
      type: Number,
      default: 0
    },
    isAvailableForLottery: {
      type: Boolean,
      default: true,
      index: true
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'FIXED_MAPPED', 'ALLOCATED'],
      default: 'AVAILABLE',
      index: true
    },
    allocatedParticipantRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      default: null
    },
    allocatedParticipantId: {
      type: String,
      default: null
    },
    allocatedParticipantName: {
      type: String,
      default: null
    },
    allocationId: {
      type: String,
      default: null
    },
    allocationType: {
      type: String,
      enum: ['FIXED', 'RANDOM', null],
      default: null
    },
    allocatedAt: {
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
    collection: 'Flats',
    timestamps: true
  }
);

// Prevent duplicate Flat Numbers within a lottery event
FlatSchema.index({ eventId: 1, flatNumber: 1 }, { unique: true });
FlatSchema.index({ eventId: 1, status: 1, isAvailableForLottery: 1 });
FlatSchema.index({ eventId: 1, wing: 1, floor: 1, sequenceOrder: 1 });

module.exports = mongoose.models.Flat || mongoose.model('Flat', FlatSchema);
