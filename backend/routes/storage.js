import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { StorageCleanupSetting } from '../models/StorageCleanupSetting.js';
import { PrivacyAuditLog } from '../models/PrivacyAuditLog.js';
import { getCleanupMetrics, executeShopCleanup } from '../services/storageCleanupService.js';

export const storageRouter = express.Router();

/**
 * GET /api/storage/cleanup
 * Returns cleanup metrics and approval status for the authenticated shop.
 * Enforces strict shop isolation (req.user.shopId).
 */
storageRouter.get('/cleanup', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID is required' });
    }

    const metrics = await getCleanupMetrics(shopId);

    let setting = await StorageCleanupSetting.findOne({ shopId });
    if (!setting) {
      setting = await StorageCleanupSetting.create({
        shopId,
        status: metrics.totalEligible > 0 ? 'PENDING_APPROVAL' : 'NO_ACTION',
        eligibleEnquiriesCount: metrics.eligibleEnquiries,
        eligibleFollowUpsCount: metrics.eligibleFollowUps,
        eligibleActivitiesCount: metrics.eligibleActivities,
        totalEligibleCount: metrics.totalEligible
      });
    } else {
      // Update fresh counts
      setting.eligibleEnquiriesCount = metrics.eligibleEnquiries;
      setting.eligibleFollowUpsCount = metrics.eligibleFollowUps;
      setting.eligibleActivitiesCount = metrics.eligibleActivities;
      setting.totalEligibleCount = metrics.totalEligible;

      if (setting.status === 'APPROVED' && setting.approvedAt) {
        // Kept as APPROVED until completed
      } else {
        setting.status = metrics.totalEligible > 0 ? 'PENDING_APPROVAL' : 'NO_ACTION';
      }
      await setting.save();
    }

    res.json({
      success: true,
      shopId,
      eligibleEnquiries: metrics.eligibleEnquiries,
      eligibleFollowUps: metrics.eligibleFollowUps,
      eligibleActivities: metrics.eligibleActivities,
      totalEligible: metrics.totalEligible,
      approvalRequired: metrics.totalEligible > 0 && setting.status !== 'APPROVED',
      status: setting.status,
      approvedAt: setting.approvedAt,
      approvedByUserId: setting.approvedByUserId,
      lastCleanupAt: setting.lastCleanupAt,
      lastCleanupSummary: setting.lastCleanupSummary || null
    });

  } catch (err) {
    console.error('Error fetching storage cleanup status:', err);
    res.status(500).json({ error: 'Failed to fetch storage cleanup status' });
  }
});

/**
 * POST /api/storage/cleanup/approve
 * Records owner approval for 30-day cleanup.
 * DOES NOT delete records immediately — sets approvedAt timestamp and marks status as APPROVED.
 */
storageRouter.post('/cleanup/approve', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID is required' });
    }

    const metrics = await getCleanupMetrics(shopId);

    if (metrics.totalEligible === 0) {
      return res.status(400).json({ error: 'There are currently no eligible records (> 30 days old) to approve for cleanup.' });
    }

    let setting = await StorageCleanupSetting.findOne({ shopId });
    if (!setting) {
      setting = new StorageCleanupSetting({ shopId });
    }

    setting.status = 'APPROVED';
    setting.approvedAt = new Date();
    setting.approvedByUserId = req.user.id;
    setting.eligibleEnquiriesCount = metrics.eligibleEnquiries;
    setting.eligibleFollowUpsCount = metrics.eligibleFollowUps;
    setting.eligibleActivitiesCount = metrics.eligibleActivities;
    setting.totalEligibleCount = metrics.totalEligible;

    await setting.save();

    // Log Privacy & Security Audit Event
    try {
      const ipAddress = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();
      const userAgent = req.headers['user-agent'] || 'QuickR-Client';
      await PrivacyAuditLog.create({
        id: `PAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: req.user.id,
        shopId: shopId,
        action: 'PRIVACY_REQUEST_CREATED',
        resourceType: 'StorageCleanup',
        resourceId: shopId,
        ipAddress,
        userAgent,
        metadata: {
          action: 'STORAGE_CLEANUP_APPROVED',
          eligibleEnquiries: metrics.eligibleEnquiries,
          eligibleFollowUps: metrics.eligibleFollowUps,
          eligibleActivities: metrics.eligibleActivities,
          totalEligible: metrics.totalEligible
        }
      });
    } catch (auditErr) {
      console.warn('Failed to log cleanup approval audit:', auditErr.message);
    }

    // Trigger immediate 90-day safe deletion pass if any records are already >= 90 days old
    const executionResult = await executeShopCleanup(shopId);

    res.json({
      success: true,
      status: setting.status,
      approvedAt: setting.approvedAt,
      approvedByUserId: setting.approvedByUserId,
      totalEligible: metrics.totalEligible,
      message: 'Storage cleanup approved. Eligible records will remain available until they reach 90 days of age.',
      immediateExecution: executionResult
    });

  } catch (err) {
    console.error('Error approving storage cleanup:', err);
    res.status(500).json({ error: 'Failed to record storage cleanup approval' });
  }
});
