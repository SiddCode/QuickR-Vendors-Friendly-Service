import mongoose from 'mongoose';

const storageCleanupSettingSchema = new mongoose.Schema(
  {
    shopId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    status: {
      type: String,
      enum: ['NO_ACTION', 'PENDING_APPROVAL', 'APPROVED', 'COMPLETED'],
      default: 'NO_ACTION'
    },
    eligibleEnquiriesCount: { type: Number, default: 0 },
    eligibleFollowUpsCount: { type: Number, default: 0 },
    eligibleActivitiesCount: { type: Number, default: 0 },
    totalEligibleCount: { type: Number, default: 0 },
    approvedAt: { type: Date, default: null },
    approvedByUserId: { type: String, default: '' },
    lastNotifiedAt: { type: Date, default: null },
    lastCleanupAt: { type: Date, default: null },
    lastCleanupSummary: {
      deletedEnquiries: { type: Number, default: 0 },
      deletedFollowUps: { type: Number, default: 0 },
      deletedActivities: { type: Number, default: 0 },
      timestamp: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

export const StorageCleanupSetting = mongoose.model('StorageCleanupSetting', storageCleanupSettingSchema);
