import { Enquiry } from '../models/Enquiry.js';
import { FollowUp } from '../models/FollowUp.js';
import { Activity } from '../models/Activity.js';
import { StorageCleanupSetting } from '../models/StorageCleanupSetting.js';
import { PrivacyAuditLog } from '../models/PrivacyAuditLog.js';

// Status constants based on codebase audit
const INACTIVE_ENQUIRY_STATUSES = ['Purchased', "Didn't Purchase"];
const INACTIVE_FOLLOWUP_STATUSES = ['completed', 'closed'];
const EXCLUDED_ACTIVITY_TYPES = ['LOGIN', 'LOGIN_FAILED', 'ACCOUNT_DELETED', 'CONSENT_GRANTED', 'CONSENT_WITHDRAWN'];

/**
 * Calculates current eligible counts for a given shopId (> 30 days old + inactive).
 */
export const getCleanupMetrics = async (shopId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const eligibleEnquiries = await Enquiry.countDocuments({
    shopId,
    createdAt: { $lte: thirtyDaysAgo },
    purchaseStatus: { $in: INACTIVE_ENQUIRY_STATUSES }
  });

  const eligibleFollowUps = await FollowUp.countDocuments({
    shopId,
    createdAt: { $lte: thirtyDaysAgo },
    status: { $in: INACTIVE_FOLLOWUP_STATUSES }
  });

  const eligibleActivities = await Activity.countDocuments({
    shopId,
    createdAt: { $lte: thirtyDaysAgo },
    type: { $nin: EXCLUDED_ACTIVITY_TYPES }
  });

  const totalEligible = eligibleEnquiries + eligibleFollowUps + eligibleActivities;

  return {
    eligibleEnquiries,
    eligibleFollowUps,
    eligibleActivities,
    totalEligible
  };
};

/**
 * Executes 90-day safe deletion for a specific shopId IF owner approval exists.
 * Returns detailed summary of deleted documents.
 */
export const executeShopCleanup = async (shopId) => {
  const setting = await StorageCleanupSetting.findOne({ shopId });
  if (!setting || !setting.approvedAt || setting.status !== 'APPROVED') {
    return {
      executed: false,
      reason: 'Owner approval required or missing.',
      deletedEnquiries: 0,
      deletedFollowUps: 0,
      deletedActivities: 0
    };
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // 1. Delete inactive enquiries >= 90 days old with strict shopId filter
  const enquiryRes = await Enquiry.deleteMany({
    shopId,
    createdAt: { $lte: ninetyDaysAgo },
    purchaseStatus: { $in: INACTIVE_ENQUIRY_STATUSES }
  });

  // 2. Delete completed/closed follow-ups >= 90 days old with strict shopId filter
  const followUpRes = await FollowUp.deleteMany({
    shopId,
    createdAt: { $lte: ninetyDaysAgo },
    status: { $in: INACTIVE_FOLLOWUP_STATUSES }
  });

  // 3. Delete non-critical activity logs >= 90 days old with strict shopId filter
  const activityRes = await Activity.deleteMany({
    shopId,
    createdAt: { $lte: ninetyDaysAgo },
    type: { $nin: EXCLUDED_ACTIVITY_TYPES }
  });

  const deletedEnquiries = enquiryRes.deletedCount || 0;
  const deletedFollowUps = followUpRes.deletedCount || 0;
  const deletedActivities = activityRes.deletedCount || 0;

  // Recalculate remaining eligible count (>= 30 days)
  const remainingMetrics = await getCleanupMetrics(shopId);

  // Update setting state
  setting.status = remainingMetrics.totalEligible > 0 ? 'PENDING_APPROVAL' : 'COMPLETED';
  setting.eligibleEnquiriesCount = remainingMetrics.eligibleEnquiries;
  setting.eligibleFollowUpsCount = remainingMetrics.eligibleFollowUps;
  setting.eligibleActivitiesCount = remainingMetrics.eligibleActivities;
  setting.totalEligibleCount = remainingMetrics.totalEligible;
  setting.lastCleanupAt = new Date();
  setting.lastCleanupSummary = {
    deletedEnquiries,
    deletedFollowUps,
    deletedActivities,
    timestamp: new Date()
  };

  // If all eligible records were cleaned up, reset approvedAt for next cycle
  if (remainingMetrics.totalEligible === 0) {
    setting.approvedAt = null;
    setting.approvedByUserId = '';
  }

  await setting.save();

  console.log(`[STORAGE CLEANUP Executed] Shop: ${shopId} | Deleted: Enquiries=${deletedEnquiries}, FollowUps=${deletedFollowUps}, Activities=${deletedActivities}`);

  return {
    executed: true,
    deletedEnquiries,
    deletedFollowUps,
    deletedActivities,
    remainingEligible: remainingMetrics.totalEligible
  };
};

/**
 * Server-wide background cleanup runner. Iterates over approved shop settings and runs 90-day execution.
 */
export const runScheduledStorageCleanup = async () => {
  try {
    const approvedSettings = await StorageCleanupSetting.find({
      status: 'APPROVED',
      approvedAt: { $ne: null }
    }).lean();

    for (const setting of approvedSettings) {
      await executeShopCleanup(setting.shopId);
    }
  } catch (err) {
    console.error('[STORAGE CLEANUP SCHEDULER ERROR]:', err.message);
  }
};
