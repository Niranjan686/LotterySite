const mongoose = require('mongoose');

const FixedMappingSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LotteryEvent',
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
      default: ''
    },
    floor: {
      type: String,
      default: ''
    },
    building: {
      type: String,
      default: ''
    },
    reason: {
      type: String,
      trim: true,
      default: 'Pre-approved society fixed flat assignment',
      maxlength: 300
    },
    allocationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Allocation',
      default: null
    },
    allocationId: {
      type: String,
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true
    },
    createdByName: {
      type: String,
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null
    }
  },
  {
    collection: 'FixedMappings',
    timestamps: true
  }
);

// Strictly enforce 1-to-1 Fixed Mapping (no participant or flat can be mapped twice)
FixedMappingSchema.index({ eventId: 1, participantRef: 1 }, { unique: true });
FixedMappingSchema.index({ eventId: 1, flatRef: 1 }, { unique: true });
FixedMappingSchema.index({ eventId: 1, participantId: 1 }, { unique: true });
FixedMappingSchema.index({ eventId: 1, flatNumber: 1 }, { unique: true });

module.exports = mongoose.models.FixedMapping || mongoose.model('FixedMapping', FixedMappingSchema);
