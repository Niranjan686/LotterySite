const mongoose = require('mongoose');

const ParticipantSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LotteryEvent',
      required: true,
      index: true
    },
    participantId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 60
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    registrationNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80
    },
    mobileNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 30
    },
    wingPreference: {
      type: String,
      trim: true,
      default: '',
      maxlength: 60
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 300
    },
    isEligible: {
      type: Boolean,
      default: true,
      index: true
    },
    allocationStatus: {
      type: String,
      enum: ['PENDING', 'FIXED_MAPPED', 'ALLOCATED'],
      default: 'PENDING',
      index: true
    },
    allocatedFlatRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Flat',
      default: null
    },
    allocatedFlatNumber: {
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
    collection: 'Participants',
    timestamps: true
  }
);

// Prevent duplicate Participant IDs within a lottery event
ParticipantSchema.index({ eventId: 1, participantId: 1 }, { unique: true });
ParticipantSchema.index({ eventId: 1, allocationStatus: 1, isEligible: 1 });
ParticipantSchema.index({ eventId: 1, fullName: 1 });

module.exports = mongoose.models.Participant || mongoose.model('Participant', ParticipantSchema);
