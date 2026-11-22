const mongoose = require('mongoose');

const LotteryEventSchema = new mongoose.Schema(
  {
    eventCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    eventName: {
      type: String,
      required: true,
      trim: true,
      default: 'Royal Palms Grand Flat Allocation'
    },
    societyName: {
      type: String,
      required: true,
      trim: true,
      default: 'Royal Palms Co-operative Housing Society'
    },
    societyAddress: {
      type: String,
      trim: true,
      default: 'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706'
    },
    registrationNo: {
      type: String,
      trim: true,
      default: 'MUM/CHS/RP-2026'
    },
    committeeName: {
      type: String,
      trim: true,
      default: 'Royal Palms Managing & Allotment Committee'
    },
    contactPhone: {
      type: String,
      trim: true,
      default: '+91 98200 12345'
    },
    societyLogo: {
      type: String,
      default: 'assets/images/logo.svg'
    },
    societyHeroImage: {
      type: String,
      default: 'assets/images/society-building.jpg'
    },
    status: {
      type: String,
      enum: ['DRAFT', 'READY', 'LIVE', 'PAUSED', 'COMPLETED', 'FINALIZED'],
      default: 'DRAFT',
      index: true
    },
    config: {
      countdownSeconds: { type: Number, default: 3, min: 1, max: 10 },
      nameRevealDurationMs: { type: Number, default: 2800, min: 800, max: 12000 },
      flatRevealDurationMs: { type: Number, default: 2400, min: 800, max: 12000 },
      soundEnabled: { type: Boolean, default: true },
      musicVolume: { type: Number, default: 0.5, min: 0, max: 1 },
      sfxVolume: { type: Number, default: 0.8, min: 0, max: 1 },
      confettiEnabled: { type: Boolean, default: true },
      ticketPrefix: { type: String, default: 'RP', trim: true, uppercase: true },
      allowBatchAllocation: { type: Boolean, default: true },
      requireConfirmationBeforeStart: { type: Boolean, default: true }
    },
    allocationSequenceCounter: {
      type: Number,
      default: 0
    },
    startedAt: { type: Date, default: null },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    completedAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null }
  },
  {
    collection: 'LotteryEvents',
    timestamps: true
  }
);

LotteryEventSchema.index({ eventCode: 1 }, { unique: true });

module.exports = mongoose.models.LotteryEvent || mongoose.model('LotteryEvent', LotteryEventSchema);
