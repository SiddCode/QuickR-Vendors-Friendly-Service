/**
 * QuickR Reliable Campaign Sending Engine & Queue Worker
 * 
 * Features:
 * - Recipient-level official Meta WhatsApp Cloud API template dispatch
 * - In-memory throttled queue with database-backed persistence
 * - Idempotency & duplicate-prevention
 * - Concurrency control & rate-limiting (adhering to Meta Cloud API tiers)
 * - Exponential backoff for temporary/rate-limit errors
 * - Worker crash/restart recovery
 * - Atomic campaign statistics synchronization
 */

import crypto from 'crypto';
import { Campaign } from '../models/Campaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { Shop } from '../models/Shop.js';
import { Activity } from '../models/Activity.js';
import {
  getShopWhatsAppCredentials,
  sendWhatsAppTemplateMessage,
  buildTemplateComponents,
  renderTemplatePreviewText
} from './whatsapp.js';

// Unique instance ID for distributed MongoDB-backed worker locking
const WORKER_INSTANCE_ID = `WORKER-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

// Track active workers locally within this node process
const activeWorkers = new Set();

// Configurable worker parameters
export const BATCH_SIZE = 10;
export const DISPATCH_THROTTLE_MS = 150; // ~6-7 messages per second per campaign, safe for Meta tier
export const MAX_TEMPORARY_RETRIES = 3;

/**
 * Synchronizes the parent Campaign document's cached metrics with actual recipient records.
 */
export const syncCampaignStats = async (campaignId, shopId) => {
  try {
    const recipients = await CampaignRecipient.find({ campaignId, shopId }).lean();
    if (!recipients || recipients.length === 0) return null;

    let queuedCount = 0;
    let pendingCount = 0;
    let sentCount = 0;
    let deliveredCount = 0;
    let readCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let cancelledCount = 0;

    recipients.forEach(r => {
      if (r.status === 'QUEUED' || r.status === 'SENDING') queuedCount++;
      else if (r.status === 'PENDING') pendingCount++;
      else if (r.status === 'SENT') sentCount++;
      else if (r.status === 'DELIVERED') { sentCount++; deliveredCount++; }
      else if (r.status === 'READ') { sentCount++; deliveredCount++; readCount++; }
      else if (r.status === 'FAILED') failedCount++;
      else if (r.status === 'SKIPPED') skippedCount++;
      else if (r.status === 'CANCELLED') cancelledCount++;
      else if (r.status === 'MANUAL_SENT') sentCount++;
    });

    const campaign = await Campaign.findOne({ id: campaignId, shopId });
    if (!campaign) return null;

    campaign.totalRecipients = recipients.length;
    campaign.eligibleRecipients = recipients.filter(r => r.status !== 'SKIPPED').length;
    campaign.queuedCount = queuedCount;
    campaign.sentCount = sentCount;
    campaign.deliveredCount = deliveredCount;
    campaign.readCount = readCount;
    campaign.failedCount = failedCount;
    campaign.skippedCount = skippedCount;
    campaign.cancelledCount = cancelledCount;

    // Check if sending has finished
    const isFinished = queuedCount === 0 && pendingCount === 0;

    if (isFinished && campaign.status === 'SENDING') {
      if (failedCount === 0 && sentCount > 0) {
        campaign.status = 'COMPLETED';
      } else if (failedCount > 0 && sentCount > 0) {
        campaign.status = 'PARTIALLY_COMPLETED';
      } else if (sentCount === 0 && failedCount > 0) {
        campaign.status = 'FAILED';
      } else if (cancelledCount > 0 && sentCount === 0) {
        campaign.status = 'CANCELLED';
      } else {
        campaign.status = 'COMPLETED';
      }
      campaign.completedAt = new Date();

      // Log completion in Activity
      await Activity.create({
        id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: 'system',
        shopId,
        type: 'campaign_completed',
        description: `Campaign "${campaign.title}" finished: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped.`,
        metadata: {
          campaignId,
          sentCount,
          failedCount,
          skippedCount,
          status: campaign.status
        }
      }).catch(() => {});
    }

    await campaign.save();
    return campaign;
  } catch (err) {
    console.error(`[SYNC CAMPAIGN STATS ERROR] Campaign ${campaignId}:`, err.message);
    return null;
  }
};

/**
 * Core asynchronous queue processor for a single campaign.
 * Implements MongoDB-backed distributed locking, monotonic processing,
 * rate-limiting with Retry-After respect, and mid-campaign opt-out enforcement.
 */
const processCampaignQueue = async (campaignId, shopId) => {
  const workerKey = `${shopId}:${campaignId}`;
  if (activeWorkers.has(workerKey)) {
    console.log(`[CAMPAIGN WORKER] Campaign ${campaignId} is already being processed by this instance.`);
    return;
  }

  // 1. Acquire distributed MongoDB-backed lock with a 2-minute lease
  const LEASE_MS = 2 * 60 * 1000;
  const staleLockThreshold = new Date(Date.now() - LEASE_MS);

  let acquiredCampaign = null;
  try {
    acquiredCampaign = await Campaign.findOneAndUpdate(
      {
        id: campaignId,
        shopId,
        status: { $in: ['READY', 'SENDING'] },
        $or: [
          { workerLockId: null },
          { workerLockedAt: null },
          { workerLockedAt: { $lt: staleLockThreshold } },
          { workerLockId: WORKER_INSTANCE_ID }
        ]
      },
      {
        $set: {
          status: 'SENDING',
          workerLockId: WORKER_INSTANCE_ID,
          workerLockedAt: new Date(),
          startedAt: new Date()
        }
      },
      { new: true }
    );
  } catch (lockErr) {
    console.error(`[CAMPAIGN WORKER LOCK ERROR] Failed acquiring distributed lock for ${campaignId}:`, lockErr.message);
    return;
  }

  if (!acquiredCampaign) {
    console.log(`[CAMPAIGN WORKER] Campaign ${campaignId} is locked by another distributed worker or not in SENDING state.`);
    return;
  }

  activeWorkers.add(workerKey);
  console.log(`🚀 [CAMPAIGN WORKER STARTED] Shop: ${shopId}, Campaign: ${campaignId}, Worker: ${WORKER_INSTANCE_ID}`);

  try {
    const campaign = acquiredCampaign;

    // Shop details for template variables
    const shopDoc = await Shop.findOne({ customId: shopId }).lean();
    const shopName = shopDoc?.name || 'QuickR Shop';

    // Verify shop's official WhatsApp connection
    const creds = await getShopWhatsAppCredentials(shopId);
    if (!creds.connected) {
      console.error(`[CAMPAIGN WORKER BLOCKED] Shop ${shopId} WhatsApp not connected.`);
      campaign.status = 'FAILED';
      await campaign.save();
      // Mark all QUEUED recipients as failed with clear error
      await CampaignRecipient.updateMany(
        { campaignId, shopId, status: { $in: ['QUEUED', 'SENDING'] } },
        {
          status: 'FAILED',
          errorCode: 'WHATSAPP_NOT_CONNECTED',
          errorMessage: 'Shop WhatsApp Business account not connected.'
        }
      );
      await syncCampaignStats(campaignId, shopId);
      return;
    }

    let hasMore = true;

    while (hasMore) {
      // Refresh distributed heartbeat lock lease in MongoDB
      await Campaign.updateOne(
        { id: campaignId, workerLockId: WORKER_INSTANCE_ID },
        { $set: { workerLockedAt: new Date() } }
      ).catch(() => {});

      // Re-verify campaign has not been cancelled mid-execution
      const freshCamp = await Campaign.findOne({ id: campaignId, shopId }).lean();
      if (!freshCamp || freshCamp.status === 'CANCELLED') {
        console.log(`[CAMPAIGN WORKER] Campaign ${campaignId} was cancelled by user. Halting.`);
        await CampaignRecipient.updateMany(
          { campaignId, shopId, status: { $in: ['QUEUED', 'SENDING'] } },
          { status: 'CANCELLED', errorMessage: 'Campaign cancelled by user.' }
        );
        break;
      }

      // Distributed fencing check: verify this worker still holds the active lease
      if (freshCamp.workerLockId && freshCamp.workerLockId !== WORKER_INSTANCE_ID) {
        console.warn(`[CAMPAIGN WORKER FENCED] Worker ${WORKER_INSTANCE_ID} lost lease ownership for campaign ${campaignId} (current lock: ${freshCamp.workerLockId}). Halting.`);
        break;
      }

      // Fetch next batch of QUEUED or interrupted SENDING recipients
      const batch = await CampaignRecipient.find({
        campaignId,
        shopId,
        status: { $in: ['QUEUED', 'SENDING'] }
      }).limit(BATCH_SIZE);

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const recipient of batch) {
        // Double check cancellation & fencing
        const currentCamp = await Campaign.findOne({ id: campaignId, shopId }).lean();
        if (currentCamp?.status === 'CANCELLED' || (currentCamp?.workerLockId && currentCamp.workerLockId !== WORKER_INSTANCE_ID)) {
          if (currentCamp?.workerLockId && currentCamp.workerLockId !== WORKER_INSTANCE_ID) {
            console.warn(`[CAMPAIGN WORKER FENCED] Worker ${WORKER_INSTANCE_ID} lost lease ownership mid-batch. Halting.`);
            break;
          }
          recipient.status = 'CANCELLED';
          recipient.errorMessage = 'Campaign cancelled by user.';
          await recipient.save();
          continue;
        }

        // 1. RE-CHECK MARKETING CONSENT: Respect mid-campaign opt-outs fail-closed (scoped by shopId)
        const consentRecord = await ConsentRecord.findOne({
          shopId,
          userId: recipient.customerId,
          purpose: 'marketing',
          status: 'active'
        }).lean();
        if (!consentRecord) {
          recipient.status = 'SKIPPED';
          recipient.errorCode = 'CONSENT_WITHDRAWN_MID_CAMPAIGN';
          recipient.errorMessage = 'Customer opted out or withdrew marketing consent before message dispatch.';
          await recipient.save();
          continue;
        }

        // 2. NETWORK TIMEOUT RECOVERY CHECK: Verify message wasn't delivered via webhook while in retry
        const checkRecipient = await CampaignRecipient.findById(recipient._id).lean();
        if (checkRecipient && ['SENT', 'DELIVERED', 'READ'].includes(checkRecipient.status)) {
          console.log(`[CAMPAIGN WORKER] Recipient ${recipient.id} was already confirmed ${checkRecipient.status} via webhook. Skipping duplicate send.`);
          continue;
        }

        // Mark recipient in-flight before making network call
        recipient.status = 'SENDING';
        recipient.lastAttemptAt = new Date();
        await recipient.save();

        // Build official Meta template parameters
        const components = buildTemplateComponents(
          campaign,
          { name: recipient.customerName || 'Customer' },
          shopName
        );

        const renderedPreview = renderTemplatePreviewText(
          campaign.templateName,
          campaign,
          recipient.customerName,
          shopName
        );

        recipient.renderedMessage = renderedPreview;

        // Dispatch via official Meta WhatsApp Cloud API with callbackData
        const sendResult = await sendWhatsAppTemplateMessage({
          recipientPhone: recipient.phone,
          templateName: campaign.templateName,
          languageCode: campaign.templateLanguage || 'en',
          components,
          customCredentials: creds,
          callbackData: recipient.id
        });

        if (sendResult.success) {
          recipient.status = 'SENT';
          recipient.providerMessageId = sendResult.providerMessageId;
          recipient.sentAt = new Date();
          recipient.attempts += 1;
          recipient.errorCode = '';
          recipient.errorMessage = '';
          await recipient.save();
        } else {
          recipient.attempts += 1;

          // Temporary error retry with exponential backoff and Retry-After header respect
          if (sendResult.isRetryable && recipient.attempts < MAX_TEMPORARY_RETRIES) {
            const waitMs = sendResult.retryAfterMs || (Math.pow(2, recipient.attempts) * 1000);
            console.warn(`[CAMPAIGN WORKER RETRY] Recipient ${recipient.id} hit temporary error. Waiting ${waitMs}ms before next attempt. Details: ${sendResult.errorMessage}`);
            await new Promise(r => setTimeout(r, waitMs));
            // Keep status QUEUED to retry on next loop
            recipient.status = 'QUEUED';
            recipient.errorMessage = sendResult.errorMessage || 'Temporary dispatch failure; queued for retry.';
            await recipient.save();
          } else {
            // Permanent failure or retry limit exceeded
            recipient.status = 'FAILED';
            recipient.errorCode = sendResult.errorCode || 'SEND_ERROR';
            recipient.errorMessage = sendResult.errorMessage || 'Failed to send WhatsApp message.';
            await recipient.save();
          }
        }

        // Throttle rate to prevent Meta API rate limiting
        await new Promise(resolve => setTimeout(resolve, DISPATCH_THROTTLE_MS));
      }

      // Sync stats incrementally after each batch
      await syncCampaignStats(campaignId, shopId);
    }

    // Final sync
    await syncCampaignStats(campaignId, shopId);

  } catch (err) {
    console.error(`[CAMPAIGN WORKER CRITICAL ERROR] Campaign ${campaignId}:`, err);
  } finally {
    activeWorkers.delete(workerKey);
    // Release distributed MongoDB-backed lock
    await Campaign.updateOne(
      { id: campaignId, workerLockId: WORKER_INSTANCE_ID },
      { $set: { workerLockId: null, workerLockedAt: null } }
    ).catch(() => {});
    console.log(`🏁 [CAMPAIGN WORKER FINISHED] Shop: ${shopId}, Campaign: ${campaignId}`);
  }
};

/**
 * Enqueues a campaign for asynchronous processing.
 */
export const enqueueCampaign = (campaignId, shopId) => {
  // Fire and forget asynchronously
  setImmediate(() => {
    processCampaignQueue(campaignId, shopId).catch(err => {
      console.error(`[CAMPAIGN WORKER DISPATCH ERROR] ${campaignId}:`, err);
    });
  });
};

/**
 * Cancels active sending for a campaign.
 */
export const cancelCampaignSending = async (campaignId, shopId) => {
  const campaign = await Campaign.findOne({ id: campaignId, shopId });
  if (!campaign) throw new Error('Campaign not found.');

  campaign.status = 'CANCELLED';
  await campaign.save();

  // Cancel any pending or queued recipients
  await CampaignRecipient.updateMany(
    { campaignId, shopId, status: { $in: ['PENDING', 'QUEUED'] } },
    { status: 'CANCELLED', errorMessage: 'Campaign cancelled by user.' }
  );

  await syncCampaignStats(campaignId, shopId);

  await Activity.create({
    id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    customerId: 'system',
    shopId,
    type: 'campaign_cancelled',
    description: `Campaign "${campaign.title}" was cancelled by user.`,
    metadata: { campaignId }
  }).catch(() => {});

  return campaign;
};

/**
 * Retries all failed recipients for a campaign.
 */
export const retryFailedRecipients = async (campaignId, shopId) => {
  const campaign = await Campaign.findOne({ id: campaignId, shopId });
  if (!campaign) throw new Error('Campaign not found.');

  const failedRecipients = await CampaignRecipient.find({
    campaignId,
    shopId,
    status: 'FAILED'
  });

  if (failedRecipients.length === 0) {
    return { success: false, message: 'No failed recipients found to retry.' };
  }

  // Reset failed recipients to QUEUED
  await CampaignRecipient.updateMany(
    { campaignId, shopId, status: 'FAILED' },
    {
      status: 'QUEUED',
      attempts: 0,
      errorCode: '',
      errorMessage: ''
    }
  );

  campaign.status = 'SENDING';
  await campaign.save();

  await syncCampaignStats(campaignId, shopId);

  // Re-enqueue
  enqueueCampaign(campaignId, shopId);

  return {
    success: true,
    retriedCount: failedRecipients.length,
    message: `Enqueued ${failedRecipients.length} failed recipient(s) for retry.`
  };
};

/**
 * Startup recovery: resumes any campaigns that were in SENDING state before a server restart.
 */
export const initWorkerRecovery = async () => {
  try {
    const interruptedCampaigns = await Campaign.find({ status: 'SENDING' });
    if (!interruptedCampaigns || interruptedCampaigns.length === 0) return;

    console.log(`🔄 [CAMPAIGN WORKER RECOVERY] Found ${interruptedCampaigns.length} interrupted campaign(s). Resuming...`);

    for (const c of interruptedCampaigns) {
      // Reset any in-flight SENDING recipients back to QUEUED for retry
      await CampaignRecipient.updateMany(
        { campaignId: c.id, shopId: c.shopId, status: 'SENDING' },
        { $set: { status: 'QUEUED' } }
      );
      // Clear stale locks
      await Campaign.updateOne(
        { id: c.id, shopId: c.shopId },
        { $set: { workerLockId: null, workerLockedAt: null } }
      );
      enqueueCampaign(c.id, c.shopId);
    }
  } catch (err) {
    console.error('[CAMPAIGN WORKER RECOVERY ERROR]:', err.message);
  }
};

export const campaignWorker = {
  syncCampaignStats,
  enqueueCampaign,
  cancelCampaignSending,
  cancelCampaign: cancelCampaignSending,
  retryFailedRecipients,
  initWorkerRecovery,
  BATCH_SIZE,
  MIN_INTERVAL_MS: DISPATCH_THROTTLE_MS,
  MAX_TEMPORARY_RETRIES
};

export default campaignWorker;
