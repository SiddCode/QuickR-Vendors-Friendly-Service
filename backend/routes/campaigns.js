import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireNonStaff } from '../middleware/auth.js';
import { escapeRegex, sanitizeSpreadsheetCell } from '../utils/security.js';
import { Campaign } from '../models/Campaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { CampaignResponse } from '../models/CampaignResponse.js';
import { Product } from '../models/Product.js';
import { Customer } from '../models/Customer.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { Sale } from '../models/Sale.js';
import { Enquiry } from '../models/Enquiry.js';
import { FollowUp } from '../models/FollowUp.js';
import { Activity } from '../models/Activity.js';
import {
  getWhatsAppConfig,
  sendWhatsAppCloudMessage,
  sanitizePhoneNumber,
  getShopWhatsAppCredentials,
  getAvailableTemplates,
  STANDARD_WHATSAPP_TEMPLATES
} from '../services/whatsapp.js';
import {
  enqueueCampaign,
  cancelCampaignSending,
  retryFailedRecipients,
  syncCampaignStats
} from '../services/campaignWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_UPLOADS_DIR = path.join(__dirname, '../uploads/temp_campaign_media');

// Ensure temporary storage directory exists
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}

export const campaignRouter = express.Router();

// Helper: Check if customer has explicit active marketing consent (scoped by shopId)
const getMarketingConsentMap = async (customerIds, shopId) => {
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return new Set();
  }
  const consents = await ConsentRecord.find({
    shopId,
    userId: { $in: customerIds },
    purpose: 'marketing',
    status: 'active'
  }).select('userId').lean();
  return new Set(consents.map(c => c.userId));
};

// ----------------------------------------------------------------------
// 0. GET /api/campaigns/provider-status — Shop WhatsApp & Template Provider Status
// ----------------------------------------------------------------------
campaignRouter.get('/provider-status', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const shopCreds = await getShopWhatsAppCredentials(shopId);
    const globalConfig = getWhatsAppConfig();

    const isConnected = shopCreds.connected;

    res.json({
      configured: isConnected,
      status: isConnected ? 'CONFIGURED' : 'NOT_CONFIGURED',
      shopConnected: isConnected,
      provider: isConnected ? 'whatsapp_cloud_api' : 'not_connected',
      phoneNumberId: isConnected && shopCreds.phoneNumberId ? `${shopCreds.phoneNumberId.substring(0, 4)}••••` : '',
      displayPhoneNumber: shopCreds.displayPhoneNumber || '',
      businessName: shopCreds.businessName || '',
      globalConfigured: globalConfig.configured,
      templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'quickr_offer_campaign',
      templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp provider status.' });
  }
});

// ----------------------------------------------------------------------
// 0B. GET /api/campaigns/templates — Available Approved WhatsApp Message Templates
// ----------------------------------------------------------------------
campaignRouter.get('/templates', requireAuth, async (req, res) => {
  try {
    const templates = await getAvailableTemplates(req.user.shopId);
    res.json({
      success: true,
      templates
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp templates' });
  }
});

// ----------------------------------------------------------------------
// 0C. GET /api/campaigns/dashboard-metrics — Overall Campaign Summary Dashboard
// ----------------------------------------------------------------------
campaignRouter.get('/dashboard-metrics', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const campaigns = await Campaign.find({ shopId }).lean();
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(c => ['SENDING', 'READY', 'SCHEDULED'].includes(c.status)).length;
    const completedCampaigns = campaigns.filter(c => ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(c.status)).length;

    // Delivery metrics aggregated across all shop campaign recipients
    const [deliveredCount, sentCount] = await Promise.all([
      CampaignRecipient.countDocuments({
        shopId,
        status: { $in: ['DELIVERED', 'READ'] }
      }),
      CampaignRecipient.countDocuments({
        shopId,
        status: { $in: ['SENT', 'DELIVERED', 'READ', 'MANUAL_SENT'] }
      })
    ]);

    res.json({
      success: true,
      metrics: {
        totalCampaigns,
        activeCampaigns,
        completedCampaigns,
        totalDeliveredMessages: deliveredCount,
        totalSentMessages: sentCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign dashboard metrics' });
  }
});

// Helper: Automatically cleanup temporary campaign media files 2 days after campaign End Date
export const cleanupExpiredCampaignMedia = async (shopId = null) => {
  try {
    const now = new Date();
    // Retention rule: Media Deletion Date = Campaign End Date + 2 days
    const query = {
      temporaryMediaReference: { $ne: null, $ne: '' }
    };
    if (shopId) query.shopId = shopId;

    const campaigns = await Campaign.find(query);
    let cleanedCount = 0;

    for (const c of campaigns) {
      if (!c.endDate) continue;
      // Handle string format "YYYY-MM-DD" or Date object cleanly
      const endDateStr = typeof c.endDate === 'string' ? `${c.endDate}T23:59:59.999Z` : c.endDate;
      const endDate = new Date(endDateStr);
      // End Date + 2 days threshold
      const cleanupThreshold = new Date(endDate.getTime() + 2 * 24 * 60 * 60 * 1000);

      if (now > cleanupThreshold) {
        if (c.temporaryMediaReference) {
          const filename = path.basename(c.temporaryMediaReference);
          const filePath = path.join(TEMP_UPLOADS_DIR, filename);

          // Safe file removal: delete if file exists, ignore if already removed
          if (fs.existsSync(filePath)) {
            try {
              await fs.promises.unlink(filePath);
            } catch (unlinkErr) {
              console.warn(`[MEDIA CLEANUP WARN] Could not unlink file ${filePath}: ${unlinkErr.message}`);
            }
          }

          // Clear media reference on campaign document while keeping all campaign metadata intact
          c.temporaryMediaReference = null;
          c.mediaType = 'none';
          await c.save();
          cleanedCount++;
        }
      }
    }
    if (cleanedCount > 0) {
      console.log(`🧹 [CAMPAIGN MEDIA CLEANUP]: Cleaned expired media for ${cleanedCount} campaign(s).`);
    }
  } catch (err) {
    console.error(`[CAMPAIGN MEDIA CLEANUP ERROR]: ${err.message}`);
  }
};

// ----------------------------------------------------------------------
// 1. GET /api/campaigns — List all campaigns for authenticated shop
// ----------------------------------------------------------------------
campaignRouter.get('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin dashboard operates in aggregate numbers-only mode.' });
    }
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }

    const campaigns = await Campaign.find({ shopId }).sort({ createdAt: -1 }).lean();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// ----------------------------------------------------------------------
// 1B. GET /api/campaigns/targeting-customers — Fetch Eligible Target Customers
// ----------------------------------------------------------------------
campaignRouter.get('/targeting-customers', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const { filterType = 'all_eligible', productId } = req.query;
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }

    // Fetch all customers for this shop
    const customers = await Customer.find({ shopId }).sort({ name: 1 }).lean();
    const consentSet = await getMarketingConsentMap(customers.map(c => c.id), shopId);

    // Identify buyers/enquirers/followups if requested
    const targetCustomerIds = new Set();

    if (filterType === 'product_buyers' && productId) {
      const sales = await Sale.find({ shopId, 'items.productId': String(productId) }).select('customerId').lean();
      sales.forEach(s => {
        if (s.customerId) targetCustomerIds.add(s.customerId);
      });
    } else if (filterType === 'enquiry_customers') {
      const enquiries = await Enquiry.find({ shopId }).select('customerId').lean();
      enquiries.forEach(e => { if (e.customerId) targetCustomerIds.add(e.customerId); });
    } else if (filterType === 'followup_customers') {
      const followups = await FollowUp.find({ shopId }).select('customerId').lean();
      followups.forEach(f => { if (f.customerId) targetCustomerIds.add(f.customerId); });
    }

    // Process customer eligibility, phone validation, deduplication & masking
    const seenPhones = new Set();
    const eligibleList = [];
    const ineligibleList = [];

    customers.forEach(c => {
      const cleanPhone = sanitizePhoneNumber(c.phone);
      const hasPhone = Boolean(cleanPhone && cleanPhone.length >= 10);
      const hasConsent = consentSet.has(c.id);
      const isDuplicate = hasPhone && seenPhones.has(cleanPhone);

      const maskedPhone = hasPhone
        ? `${cleanPhone.substring(0, Math.min(cleanPhone.length - 4, 6))}•••••`
        : 'No Phone';

      // Strict fail-closed targeting filter: empty target set yields 0 matching customers
      if (['product_buyers', 'enquiry_customers', 'followup_customers'].includes(String(filterType))) {
        if (!targetCustomerIds.has(c.id)) {
          return;
        }
      }

      if (!hasPhone) {
        ineligibleList.push({
          id: c.id,
          name: c.name,
          phone: c.phone || '',
          maskedPhone: 'No Phone',
          hasPhone: false,
          hasConsent,
          isEligible: false,
          reason: 'Invalid or missing mobile phone'
        });
      } else if (!hasConsent) {
        ineligibleList.push({
          id: c.id,
          name: c.name,
          phone: cleanPhone,
          maskedPhone,
          hasPhone: true,
          hasConsent: false,
          isEligible: false,
          reason: 'No WhatsApp marketing consent'
        });
      } else if (isDuplicate) {
        ineligibleList.push({
          id: c.id,
          name: c.name,
          phone: cleanPhone,
          maskedPhone,
          hasPhone: true,
          hasConsent: true,
          isEligible: false,
          reason: 'Duplicate phone number in customer list'
        });
      } else {
        seenPhones.add(cleanPhone);
        eligibleList.push({
          id: c.id,
          name: c.name,
          phone: cleanPhone,
          maskedPhone,
          hasPhone: true,
          hasConsent: true,
          isEligible: true,
          reason: 'Eligible'
        });
      }
    });

    res.json({
      success: true,
      eligibleCount: eligibleList.length,
      ineligibleCount: ineligibleList.length,
      eligibleCustomers: eligibleList,
      ineligibleCustomers: ineligibleList
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch targeting customers.' });
  }
});

// ----------------------------------------------------------------------
// 2. GET /api/campaigns/:id — Retrieve single campaign details
// ----------------------------------------------------------------------
campaignRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ id: req.params.id, shopId: req.user.shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
});

// ----------------------------------------------------------------------
// 6. POST /api/campaigns — Create / Save Offer Campaign (Supports DRAFT / READY)
// ----------------------------------------------------------------------
campaignRouter.post('/', requireAuth, requireNonStaff, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const {
      title,
      description,
      discountType,
      discountValue,
      productIds,
      startDate,
      endDate,
      mediaType,
      temporaryMediaReference,
      selectedCustomerIds,
      targetAudienceType,
      campaignCost,
      status,
      campaignType,
      templateName,
      templateLanguage,
      templateVariables,
      scheduledAt
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Offer title is required.' });
    }
    if (!discountType || !['Percentage', 'Fixed Amount'].includes(discountType)) {
      return res.status(400).json({ error: 'Valid discountType (Percentage or Fixed Amount) is required.' });
    }
    const val = Number(discountValue);
    if (isNaN(val) || val <= 0) {
      return res.status(400).json({ error: 'Discount value must be a positive number.' });
    }
    if (discountType === 'Percentage' && val > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required.' });
    }
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ error: 'Invalid start or end date.' });
    }
    if (eDate < sDate) {
      return res.status(400).json({ error: 'End date cannot be before start date.' });
    }

    // Verify selected products belong to shop
    let validProductIds = [];
    if (Array.isArray(productIds) && productIds.length > 0) {
      const prods = await Product.find({ id: { $in: productIds }, shopId: req.user.shopId });
      validProductIds = prods.map(p => p.id);
    }

    const campaignId = `CMP-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const initialStatus = status === 'DRAFT' ? 'DRAFT' : 'READY';

    const newCampaign = new Campaign({
      id: campaignId,
      title: title.trim(),
      description: description ? description.trim() : '',
      campaignType: campaignType || 'discount_offer',
      templateName: templateName || 'quickr_offer_campaign',
      templateLanguage: templateLanguage || 'en',
      templateVariables: templateVariables || {},
      discountType,
      discountValue: val,
      productIds: validProductIds,
      startDate: sDate,
      endDate: eDate,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      mediaType: mediaType || 'none',
      temporaryMediaReference: temporaryMediaReference || '',
      selectedCustomerIds: Array.isArray(selectedCustomerIds) ? selectedCustomerIds : [],
      targetAudienceType: targetAudienceType || 'all_eligible',
      eligibleCustomerCount: Array.isArray(selectedCustomerIds) ? selectedCustomerIds.length : 0,
      totalRecipients: Array.isArray(selectedCustomerIds) ? selectedCustomerIds.length : 0,
      campaignCost: Number(campaignCost) > 0 ? Number(campaignCost) : 0,
      status: initialStatus,
      createdBy: req.user.id,
      shopId: req.user.shopId
    });

    await newCampaign.save();

    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      shopId: req.user.shopId,
      type: 'campaign_created',
      description: `Created campaign "${newCampaign.title}" (Status: ${initialStatus})`,
      metadata: { campaignId: newCampaign.id }
    }).catch(() => {});

    res.status(201).json({ success: true, campaign: newCampaign });
  } catch (err) {
    res.status(500).json({ error: `Failed to create offer campaign: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 6B. PUT /api/campaigns/:id — Update Campaign (Only permitted in DRAFT or READY)
// ----------------------------------------------------------------------
campaignRouter.put('/:id', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const campaign = await Campaign.findOne({ id: req.params.id, shopId });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found for your shop.' });
    }

    if (!['DRAFT', 'READY'].includes(campaign.status)) {
      return res.status(400).json({ error: `Cannot edit campaign in ${campaign.status} status.` });
    }

    const {
      title,
      description,
      discountType,
      discountValue,
      productIds,
      startDate,
      endDate,
      selectedCustomerIds,
      targetAudienceType,
      campaignType,
      templateName,
      templateLanguage,
      templateVariables,
      scheduledAt,
      status
    } = req.body;

    if (title !== undefined) campaign.title = title.trim();
    if (description !== undefined) campaign.description = description ? description.trim() : '';
    if (discountType !== undefined) campaign.discountType = discountType;
    if (discountValue !== undefined) campaign.discountValue = Number(discountValue);
    if (startDate !== undefined) campaign.startDate = new Date(startDate);
    if (endDate !== undefined) campaign.endDate = new Date(endDate);
    if (campaignType !== undefined) campaign.campaignType = campaignType;
    if (templateName !== undefined) campaign.templateName = templateName;
    if (templateLanguage !== undefined) campaign.templateLanguage = templateLanguage;
    if (templateVariables !== undefined) campaign.templateVariables = templateVariables;
    if (scheduledAt !== undefined) campaign.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (status !== undefined && ['DRAFT', 'READY'].includes(status)) campaign.status = status;

    if (Array.isArray(productIds)) {
      const prods = await Product.find({ id: { $in: productIds }, shopId });
      campaign.productIds = prods.map(p => p.id);
    }

    if (Array.isArray(selectedCustomerIds)) {
      campaign.selectedCustomerIds = selectedCustomerIds;
      campaign.eligibleCustomerCount = selectedCustomerIds.length;
      campaign.totalRecipients = selectedCustomerIds.length;
    }

    if (targetAudienceType) campaign.targetAudienceType = targetAudienceType;

    await campaign.save();

    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: `Failed to update campaign: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 7. GET /api/campaigns/:id/recipients — Filterable Recipient Logs
// ----------------------------------------------------------------------
campaignRouter.get('/:id/recipients', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const { status, search, limit = 100 } = req.query;

    const campaign = await Campaign.findOne({ id: req.params.id, shopId }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const query = { campaignId: req.params.id, shopId };
    if (typeof status === 'string' && status !== 'ALL') {
      query.status = status.toUpperCase();
    }
    if (typeof search === 'string' && search.trim()) {
      const safeRegex = escapeRegex(search.trim());
      query.$or = [
        { customerName: { $regex: safeRegex, $options: 'i' } },
        { phone: { $regex: safeRegex, $options: 'i' } }
      ];
    }

    const parsedLimit = parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100;

    const recipients = await CampaignRecipient.find(query)
      .sort({ updatedAt: -1 })
      .limit(safeLimit)
      .lean();

    res.json(recipients);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign recipients.' });
  }
});

// ----------------------------------------------------------------------
// 7B. GET /api/campaigns/:id/export — Export Recipient Delivery Report to CSV
// ----------------------------------------------------------------------
campaignRouter.get('/:id/export', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const campaign = await Campaign.findOne({ id: req.params.id, shopId }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const recipients = await CampaignRecipient.find({ campaignId: req.params.id, shopId })
      .sort({ createdAt: 1 })
      .lean();

    const csvCell = (val) => `"${String(sanitizeSpreadsheetCell(val ?? '')).replace(/"/g, '""')}"`;

    // Generate CSV contents with spreadsheet formula neutralization
    const headers = ['Recipient ID', 'Customer Name', 'Phone', 'Status', 'Sending Method', 'Attempts', 'Sent At', 'Delivered At', 'Read At', 'Error Code', 'Error Message'];
    const rows = recipients.map(r => [
      csvCell(r.id),
      csvCell(r.customerName || 'Customer'),
      csvCell(r.phone || ''),
      csvCell(r.status),
      csvCell(r.sendingMethod),
      r.attempts || 0,
      csvCell(r.sentAt ? new Date(r.sentAt).toISOString() : ''),
      csvCell(r.deliveredAt ? new Date(r.deliveredAt).toISOString() : ''),
      csvCell(r.readAt ? new Date(r.readAt).toISOString() : ''),
      csvCell(r.errorCode || ''),
      csvCell(r.errorMessage || '')
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="campaign-${campaign.id}-report.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export campaign report' });
  }
});

// ----------------------------------------------------------------------
// 8. POST /api/campaigns/:id/send — Multi-Customer WhatsApp Cloud API Launch
// ----------------------------------------------------------------------
campaignRouter.post('/:id/send', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const campaign = await Campaign.findOne({ id: req.params.id, shopId });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found for your shop.' });
    }

    if (campaign.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Campaign has already been completed and sent.' });
    }

    if (campaign.status === 'SENDING') {
      return res.status(400).json({ error: 'Campaign is already currently being sent by the engine.' });
    }

    // Phase 4 requirement: Verify shop's own official WhatsApp connection
    const creds = await getShopWhatsAppCredentials(shopId);
    if (!creds.connected) {
      return res.status(400).json({
        error: 'Your shop WhatsApp Business account is not connected. Connect in Settings before launching campaigns.',
        code: 'WHATSAPP_NOT_CONNECTED',
        configured: false
      });
    }

    // Server-side Recalculation & Re-validation of Target Customers
    const targetCustomerIds = campaign.selectedCustomerIds || [];
    const targetCustomers = await Customer.find({ id: { $in: targetCustomerIds }, shopId }).lean();
    const consentSet = await getMarketingConsentMap(targetCustomers.map(c => c.id), shopId);

    const seenPhones = new Set();
    let queuedCount = 0;
    let skippedCount = 0;

    for (const cust of targetCustomers) {
      const cleanPhone = sanitizePhoneNumber(cust.phone);
      const hasPhone = Boolean(cleanPhone && cleanPhone.length >= 10);
      const hasConsent = consentSet.has(cust.id);
      const isDuplicate = hasPhone && seenPhones.has(cleanPhone);

      let recipientDoc = await CampaignRecipient.findOne({ campaignId: campaign.id, shopId, customerId: cust.id });
      if (!recipientDoc) {
        recipientDoc = new CampaignRecipient({
          id: `RCP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          campaignId: campaign.id,
          shopId,
          customerId: cust.id,
          customerName: cust.name || 'Customer',
          phone: cleanPhone || cust.phone || '',
          templateName: campaign.templateName || 'quickr_offer_campaign',
          sendingMethod: 'OFFICIAL_API'
        });
      }

      // Check idempotency: avoid resending to recipients already marked SENT/DELIVERED/READ
      if (['SENT', 'DELIVERED', 'READ'].includes(recipientDoc.status)) {
        continue;
      }

      if (!hasPhone) {
        recipientDoc.status = 'SKIPPED';
        recipientDoc.errorCode = 'INVALID_PHONE_NUMBER';
        recipientDoc.errorMessage = 'Missing or invalid phone number';
        await recipientDoc.save();
        skippedCount++;
        continue;
      }

      if (!hasConsent) {
        recipientDoc.status = 'SKIPPED';
        recipientDoc.errorCode = 'NO_MARKETING_CONSENT';
        recipientDoc.errorMessage = 'Customer has not provided active WhatsApp marketing consent';
        await recipientDoc.save();
        skippedCount++;
        continue;
      }

      if (isDuplicate) {
        recipientDoc.status = 'SKIPPED';
        recipientDoc.errorCode = 'DUPLICATE_PHONE_NUMBER';
        recipientDoc.errorMessage = 'Duplicate phone number in campaign';
        await recipientDoc.save();
        skippedCount++;
        continue;
      }

      // Valid eligible customer
      seenPhones.add(cleanPhone);
      recipientDoc.status = 'QUEUED';
      recipientDoc.phone = cleanPhone;
      recipientDoc.customerName = cust.name || 'Customer';
      recipientDoc.templateName = campaign.templateName || 'quickr_offer_campaign';
      recipientDoc.attempts = 0;
      recipientDoc.errorCode = '';
      recipientDoc.errorMessage = '';
      await recipientDoc.save();
      queuedCount++;
    }

    if (queuedCount === 0) {
      campaign.status = 'COMPLETED';
      campaign.skippedCount = skippedCount;
      await campaign.save();
      return res.json({
        success: true,
        campaignId: campaign.id,
        status: 'COMPLETED',
        queuedCount: 0,
        skippedCount,
        message: 'No eligible recipients found to send. All customers were skipped due to missing consent, invalid phone, or duplicates.'
      });
    }

    // Set campaign status to SENDING
    campaign.status = 'SENDING';
    campaign.startedAt = new Date();
    campaign.queuedCount = queuedCount;
    campaign.skippedCount = skippedCount;
    campaign.totalRecipients = targetCustomers.length;
    campaign.eligibleRecipients = queuedCount;
    await campaign.save();

    // Log Activity
    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      shopId,
      type: 'campaign_launched',
      description: `Launched WhatsApp campaign "${campaign.title}" (${queuedCount} queued, ${skippedCount} skipped)`,
      metadata: { campaignId: campaign.id, queuedCount, skippedCount }
    }).catch(() => {});

    // Asynchronously dispatch to queue worker engine
    enqueueCampaign(campaign.id, shopId);

    res.json({
      success: true,
      campaignId: campaign.id,
      status: 'SENDING',
      message: `Campaign sending started for ${queuedCount} eligible customer(s).`,
      summary: {
        total: targetCustomers.length,
        queued: queuedCount,
        skipped: skippedCount
      }
    });
  } catch (err) {
    console.error('Campaign launch error:', err);
    res.status(500).json({ error: 'Campaign send process failed' });
  }
});

// ----------------------------------------------------------------------
// 8B. POST /api/campaigns/:id/cancel — Cancel Active Campaign Sending
// ----------------------------------------------------------------------
campaignRouter.post('/:id/cancel', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const campaign = await cancelCampaignSending(req.params.id, shopId);
    res.json({
      success: true,
      message: 'Campaign sending cancelled successfully.',
      campaign
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to cancel campaign' });
  }
});

// ----------------------------------------------------------------------
// 8C. POST /api/campaigns/:id/retry-failed — Retry Failed Campaign Recipients
// ----------------------------------------------------------------------
campaignRouter.post('/:id/retry-failed', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const result = await retryFailedRecipients(req.params.id, shopId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to retry failed recipients' });
  }
});

// ----------------------------------------------------------------------
// 9. GET /api/campaigns/:id/manual-targets — Get target customers with generated deep-links
// ----------------------------------------------------------------------
campaignRouter.get('/:id/manual-targets', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const campaign = await Campaign.findOne({ id: req.params.id, shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    // Fetch shop info for {{ShopName}}
    const ShopModel = (await import('../models/Shop.js')).Shop;
    const shopDoc = await ShopModel.findOne({ customId: shopId });
    const shopName = shopDoc ? shopDoc.name : 'QuickR Shop';

    // Fetch product info
    let prodName = 'Special Offer Products';
    if (campaign.productIds && campaign.productIds.length > 0) {
      const prods = await Product.find({ id: { $in: campaign.productIds }, shopId }).lean();
      if (prods.length > 0) prodName = prods.map(p => p.name).join(', ');
    }

    const discountFormatted = campaign.discountType === 'Percentage' ? `${campaign.discountValue}%` : `₹${campaign.discountValue}`;
    const startDateFormatted = new Date(campaign.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const endDateFormatted = new Date(campaign.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    // Server-side customer re-validation & marketing consent check
    const targetCustomerIds = campaign.selectedCustomerIds || [];
    const targetCustomers = await Customer.find({ id: { $in: targetCustomerIds }, shopId }).sort({ name: 1 }).lean();
    const consentSet = await getMarketingConsentMap(targetCustomers.map(c => c.id), shopId);

    // Fetch existing recipient docs for status
    const recipientDocs = await CampaignRecipient.find({ campaignId: campaign.id, shopId }).lean();
    const recipientMap = new Map(recipientDocs.map(r => [r.customerId, r]));

    const manualTargets = [];

    for (const cust of targetCustomers) {
      const hasPhone = Boolean(cust.phone && cust.phone.trim().length >= 10);
      const hasConsent = consentSet.has(cust.id);

      if (!hasPhone || !hasConsent) continue; // Skip ineligible customers (no phone or consent withdrawn/missing)

      const cleanPhone = sanitizePhoneNumber(cust.phone);
      const rDoc = recipientMap.get(cust.id);
      const currentStatus = rDoc ? rDoc.status : 'PENDING';

      // Clean plain-text personalized message generation (Strictly 0 emojis / 0 malformed characters)
      const rawMessageText = `Hi ${cust.name}!\n\n${shopName} has a special offer for you.\n\nGet ${discountFormatted} OFF on ${campaign.title}.\n\nOffer valid from ${startDateFormatted} until ${endDateFormatted}.\n\nVisit us to claim the offer!`;
      
      // Sanitization: Strip any emoji / non-standard Unicode symbols
      const messageText = rawMessageText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\uFFFD]/gu, '').trim();

      const encodedText = encodeURIComponent(messageText);
      const waDeepLink = `https://wa.me/${cleanPhone}?text=${encodedText}`;

      manualTargets.push({
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        maskedPhone: `${cust.phone.substring(0, 5)}•••••`,
        status: currentStatus,
        personalizedMessage: messageText,
        waDeepLink
      });
    }

    res.json({
      success: true,
      campaignId: campaign.id,
      totalTargets: manualTargets.length,
      targets: manualTargets
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch manual targets: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 10. POST /api/campaigns/:id/mark-manual-sent — Mark recipient as MANUAL_SENT
// ----------------------------------------------------------------------
campaignRouter.post('/:id/mark-manual-sent', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { customerId } = req.body;

    if (!customerId) return res.status(400).json({ error: 'customerId is required.' });

    const campaign = await Campaign.findOne({ id: req.params.id, shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    const customer = await Customer.findOne({ id: customerId, shopId });
    if (!customer) return res.status(404).json({ error: 'Customer not found for your shop.' });

    let recipientDoc = await CampaignRecipient.findOne({ campaignId: campaign.id, shopId, customerId });
    if (!recipientDoc) {
      recipientDoc = new CampaignRecipient({
        id: `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        campaignId: campaign.id,
        shopId,
        customerId,
        phone: customer.phone || '',
        status: 'MANUAL_SENT',
        sendingMethod: 'MANUAL_WHATSAPP',
        sentAt: new Date()
      });
    } else {
      recipientDoc.status = 'MANUAL_SENT';
      recipientDoc.sendingMethod = 'MANUAL_WHATSAPP';
      recipientDoc.sentAt = new Date();
    }

    await recipientDoc.save();

    res.json({ success: true, recipient: recipientDoc });
  } catch (err) {
    res.status(500).json({ error: `Failed to mark manual recipient sent: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 10B. POST /api/campaigns/:id/skip-recipient — Mark recipient as SKIPPED
// ----------------------------------------------------------------------
campaignRouter.post('/:id/skip-recipient', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { customerId } = req.body;

    if (!customerId) return res.status(400).json({ error: 'customerId is required.' });

    const campaign = await Campaign.findOne({ id: req.params.id, shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    const customer = await Customer.findOne({ id: customerId, shopId });
    if (!customer) return res.status(404).json({ error: 'Customer not found for your shop.' });

    let recipientDoc = await CampaignRecipient.findOne({ campaignId: campaign.id, shopId, customerId });
    if (!recipientDoc) {
      recipientDoc = new CampaignRecipient({
        id: `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        campaignId: campaign.id,
        shopId,
        customerId,
        phone: customer.phone || '',
        status: 'SKIPPED',
        sendingMethod: 'MANUAL_WHATSAPP'
      });
    } else {
      recipientDoc.status = 'SKIPPED';
    }

    await recipientDoc.save();

    res.json({ success: true, recipient: recipientDoc });
  } catch (err) {
    res.status(500).json({ error: `Failed to skip recipient: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 11. POST /api/campaigns/:id/record-response — Record owner-confirmed customer campaign response
// Connects Campaign -> Customer Response -> Enquiry -> Follow-up / Billing
// ----------------------------------------------------------------------
campaignRouter.post('/:id/record-response', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const campaignId = req.params.id;
    const { customerId, responseType, notes, scheduledFollowUpDate, followUpNotes } = req.body;

    if (!customerId || !responseType) {
      return res.status(400).json({ error: 'customerId and responseType are required.' });
    }

    const validResponses = ['INTERESTED', 'MORE_INFORMATION', 'VISIT_SHOP', 'NOT_INTERESTED', 'PURCHASED', 'NO_RESPONSE'];
    if (!validResponses.includes(responseType)) {
      return res.status(400).json({ error: 'Invalid responseType.' });
    }

    // Verify campaign & customer belong to authenticated shop
    const campaign = await Campaign.findOne({ id: campaignId, shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    const customer = await Customer.findOne({ id: customerId, shopId });
    if (!customer) return res.status(404).json({ error: 'Customer not found for your shop.' });

    // Find recipient doc if exists
    const recipient = await CampaignRecipient.findOne({ campaignId, shopId, customerId });
    const recipientId = recipient ? recipient.id : '';

    let enquiryId = '';
    let followUpId = '';

    // Create or update Enquiry for INTERESTED, MORE_INFORMATION, VISIT_SHOP
    if (['INTERESTED', 'MORE_INFORMATION', 'VISIT_SHOP'].includes(responseType)) {
      let productId = campaign.productIds && campaign.productIds.length > 0 ? campaign.productIds[0] : '';
      let prodDoc = null;
      if (productId) {
        prodDoc = await Product.findOne({ id: productId, shopId });
      }

      // Check if enquiry already exists for this campaign + customer to prevent duplicates
      let enquiry = await Enquiry.findOne({ shopId, customerId, campaignId });
      if (!enquiry) {
        const count = await Enquiry.countDocuments({ shopId });
        enquiry = new Enquiry({
          id: `ENQ-${count + 101}`,
          customerId,
          productId: productId || 'GENERAL',
          productName: prodDoc ? prodDoc.name : campaign.title,
          productCategory: prodDoc ? prodDoc.category : 'Promotional Offer',
          priceAtEnquiry: prodDoc ? prodDoc.sellingPrice : campaign.discountValue,
          size: 'Standard',
          color: 'Standard',
          quantity: 1,
          interest: responseType === 'INTERESTED' ? 'Very Interested' : 'Interested',
          purchaseStatus: 'Pending',
          notes: notes || `Responded to campaign: ${campaign.title} (${responseType})`,
          campaignId,
          source: 'whatsapp_campaign',
          shopId
        });
        await enquiry.save();
      }
      enquiryId = enquiry.id;

      // Create FollowUp if requested or for MORE_INFORMATION / VISIT_SHOP
      if (scheduledFollowUpDate || ['MORE_INFORMATION', 'VISIT_SHOP'].includes(responseType)) {
        let existingFollowUp = await FollowUp.findOne({ shopId, customerId, enquiryId: enquiry.id });
        if (!existingFollowUp) {
          const fuCount = await FollowUp.countDocuments({ shopId });
          const dueDate = scheduledFollowUpDate ? new Date(scheduledFollowUpDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          existingFollowUp = new FollowUp({
            id: `FW-${fuCount + 101}`,
            customerId,
            enquiryId: enquiry.id,
            reason: followUpNotes || `Campaign follow-up: ${campaign.title} (${responseType})`,
            scheduledAt: dueDate,
            status: 'ready',
            message: `Hi ${customer.name}, following up on our offer: ${campaign.title}`,
            priority: responseType === 'VISIT_SHOP' ? 'High' : 'Medium',
            campaignId,
            shopId
          });
          await existingFollowUp.save();
        }
        followUpId = existingFollowUp.id;
      }
    }

    // Upsert CampaignResponse (Duplicate Protection)
    let campResponse = await CampaignResponse.findOne({ shopId, campaignId, customerId });
    if (!campResponse) {
      campResponse = new CampaignResponse({
        id: `CMP-RESP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        shopId,
        campaignId,
        customerId,
        campaignRecipientId: recipientId,
        responseType,
        notes: notes || '',
        enquiryId,
        followUpId,
        createdBy: req.user.id
      });
    } else {
      campResponse.responseType = responseType;
      campResponse.notes = notes || campResponse.notes;
      if (enquiryId) campResponse.enquiryId = enquiryId;
      if (followUpId) campResponse.followUpId = followUpId;
    }

    await campResponse.save();

    res.json({
      success: true,
      campaignResponse: campResponse,
      enquiryId,
      followUpId
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to record campaign response: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 12. GET /api/campaigns/:id/responses — Campaign Response Statistics & Summary
// ----------------------------------------------------------------------
campaignRouter.get('/:id/responses', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const campaign = await Campaign.findOne({ id: req.params.id, shopId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    const responses = await CampaignResponse.find({ campaignId: req.params.id, shopId }).lean();
    const summary = {
      INTERESTED: 0,
      MORE_INFORMATION: 0,
      VISIT_SHOP: 0,
      NOT_INTERESTED: 0,
      PURCHASED: 0,
      NO_RESPONSE: 0
    };

    responses.forEach(r => {
      if (summary[r.responseType] !== undefined) {
        summary[r.responseType]++;
      }
    });

    res.json({
      success: true,
      totalResponses: responses.length,
      summary,
      responses
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch campaign responses: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 13. GET /api/campaigns/customer/:customerId/history — Customer Campaign History Timeline
// ----------------------------------------------------------------------
campaignRouter.get('/customer/:customerId/history', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const customerId = req.params.customerId;

    const customer = await Customer.findOne({ id: customerId, shopId });
    if (!customer) return res.status(404).json({ error: 'Customer not found for your shop.' });

    const recipients = await CampaignRecipient.find({ customerId, shopId }).sort({ createdAt: -1 }).lean();
    const responses = await CampaignResponse.find({ customerId, shopId }).lean();
    const responseMap = new Map(responses.map(r => [r.campaignId, r]));

    const campaignIds = recipients.map(r => r.campaignId);
    const campaigns = await Campaign.find({ id: { $in: campaignIds }, shopId }).lean();
    const campaignMap = new Map(campaigns.map(c => [c.id, c]));

    const history = recipients.map(r => {
      const camp = campaignMap.get(r.campaignId);
      const resp = responseMap.get(r.campaignId);
      return {
        campaignId: r.campaignId,
        campaignTitle: camp ? camp.title : 'Campaign',
        discount: camp ? (camp.discountType === 'Percentage' ? `${camp.discountValue}% OFF` : `₹${camp.discountValue} OFF`) : '',
        sentStatus: r.status,
        sendingMethod: r.sendingMethod,
        sentAt: r.sentAt || r.createdAt,
        responseType: resp ? resp.responseType : 'NO_RESPONSE',
        responseNotes: resp ? resp.notes : '',
        respondedAt: resp ? resp.updatedAt : null
      };
    });

    res.json({
      success: true,
      customerId,
      history
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch customer campaign history: ${err.message}` });
  }
});

// ----------------------------------------------------------------------
// 14. GET /api/campaigns/:id/analytics — Comprehensive Campaign Analytics & ROI
// ----------------------------------------------------------------------
campaignRouter.get('/:id/analytics', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });
    const campaignId = req.params.id;

    const campaign = await Campaign.findOne({ id: campaignId, shopId }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found for your shop.' });

    // Fetch Recipient stats
    const recipients = await CampaignRecipient.find({ campaignId, shopId }).lean();

    let manualSentCustomers = 0;
    let apiSentCustomers = 0;
    let deliveredCustomers = 0;
    let readCustomers = 0;
    let skippedCustomers = 0;
    let failedCustomers = 0;

    recipients.forEach(r => {
      if (r.status === 'MANUAL_SENT') {
        manualSentCustomers++;
      } else if (['SENT', 'DELIVERED', 'READ'].includes(r.status)) {
        apiSentCustomers++;
        if (r.status === 'DELIVERED') deliveredCustomers++;
        if (r.status === 'READ') readCustomers++;
      } else if (r.status === 'SKIPPED') {
        skippedCustomers++;
      } else if (r.status === 'FAILED') {
        failedCustomers++;
      }
    });

    const sentCustomers = manualSentCustomers + apiSentCustomers;
    const targetedCustomers = campaign.selectedCustomerIds ? campaign.selectedCustomerIds.length : (recipients.length || campaign.eligibleCustomerCount || 0);

    // Fetch CampaignResponse stats
    const responses = await CampaignResponse.find({ campaignId, shopId }).lean();

    let interestedCount = 0;
    let moreInformationCount = 0;
    let visitShopCount = 0;
    let notInterestedCount = 0;
    let noResponseCount = 0;
    let purchasedResponseCount = 0;

    responses.forEach(r => {
      if (r.responseType === 'INTERESTED') interestedCount++;
      else if (r.responseType === 'MORE_INFORMATION') moreInformationCount++;
      else if (r.responseType === 'VISIT_SHOP') visitShopCount++;
      else if (r.responseType === 'NOT_INTERESTED') notInterestedCount++;
      else if (r.responseType === 'NO_RESPONSE') noResponseCount++;
      else if (r.responseType === 'PURCHASED') purchasedResponseCount++;
    });

    // Exclude NO_RESPONSE from positive/engaged response count
    const responseCount = interestedCount + moreInformationCount + visitShopCount + notInterestedCount + purchasedResponseCount;

    // Fetch Actual Campaign-Attributed Sales via aggregation
    const [salesStats] = await Sale.aggregate([
      { $match: { shopId, campaignId, saleSource: 'campaign' } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
    ]);
    const salesCount = salesStats?.count || 0;
    const revenue = Math.round((salesStats?.revenue || 0) * 100) / 100;

    // Rates calculation
    const responseRate = sentCustomers > 0 ? Number(((responseCount / sentCustomers) * 100).toFixed(1)) : 0;
    const purchaseRate = sentCustomers > 0 ? Number(((salesCount / sentCustomers) * 100).toFixed(1)) : 0;
    const averageSaleValue = salesCount > 0 ? Number((revenue / salesCount).toFixed(2)) : 0;

    // ROI calculation
    const campaignCost = campaign.campaignCost || 0;
    let roi = null;
    if (campaignCost > 0) {
      roi = Number((((revenue - campaignCost) / campaignCost) * 100).toFixed(1));
    }

    res.json({
      success: true,
      analytics: {
        campaignId,
        title: campaign.title,
        status: campaign.status,
        discount: campaign.discountType === 'Percentage' ? `${campaign.discountValue}% OFF` : `₹${campaign.discountValue} OFF`,
        targetedCustomers,
        sentCustomers,
        manualSentCustomers,
        apiSentCustomers,
        deliveredCustomers: deliveredCustomers + readCustomers,
        readCustomers,
        skippedCustomers,
        failedCustomers,
        responseCount,
        interestedCount,
        moreInformationCount,
        visitShopCount,
        notInterestedCount,
        noResponseCount,
        purchasedResponseCount,
        salesCount,
        revenue,
        responseRate,
        purchaseRate,
        averageSaleValue,
        campaignCost,
        roi
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign analytics' });
  }
});

// ----------------------------------------------------------------------
// 15. GET /api/campaigns/analytics/summary — Lightweight Aggregate Summaries for Campaign Cards
// ----------------------------------------------------------------------
campaignRouter.get('/analytics/summary', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop context required' });

    const campaigns = await Campaign.find({ shopId }).sort({ createdAt: -1 }).lean();
    if (campaigns.length === 0) {
      return res.json({ success: true, summaries: [] });
    }

    const campaignIds = campaigns.map(c => c.id);

    const [recipientsAgg, responsesAgg, salesAgg] = await Promise.all([
      CampaignRecipient.aggregate([
        { $match: { shopId, campaignId: { $in: campaignIds }, status: { $in: ['SENT', 'DELIVERED', 'READ', 'MANUAL_SENT'] } } },
        { $group: { _id: '$campaignId', count: { $sum: 1 } } }
      ]),
      CampaignResponse.aggregate([
        { $match: { shopId, campaignId: { $in: campaignIds }, responseType: { $ne: 'NO_RESPONSE' } } },
        { $group: { _id: '$campaignId', count: { $sum: 1 } } }
      ]),
      Sale.aggregate([
        { $match: { shopId, campaignId: { $in: campaignIds }, saleSource: 'campaign' } },
        { $group: { _id: '$campaignId', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ])
    ]);

    const sentMap = new Map(recipientsAgg.map(x => [x._id, x.count]));
    const responseMap = new Map(responsesAgg.map(x => [x._id, x.count]));
    const salesMap = new Map(salesAgg.map(x => [x._id, x.count]));
    const revenueMap = new Map(salesAgg.map(x => [x._id, Math.round(x.revenue * 100) / 100]));

    const summaries = campaigns.map(c => ({
      campaignId: c.id,
      title: c.title,
      status: c.status,
      discount: c.discountType === 'Percentage' ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`,
      sentCustomers: sentMap.get(c.id) || 0,
      responseCount: responseMap.get(c.id) || 0,
      salesCount: salesMap.get(c.id) || 0,
      revenue: revenueMap.get(c.id) || 0
    }));

    res.json({ success: true, summaries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign analytics summary' });
  }
});
