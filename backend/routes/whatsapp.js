import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { requireAuth, requireNonStaff } from '../middleware/auth.js';
import { Customer } from '../models/Customer.js';
import { Message } from '../models/Message.js';
import { FollowUp } from '../models/FollowUp.js';
import { Activity } from '../models/Activity.js';
import { WhatsAppConnection } from '../models/WhatsAppConnection.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { syncCampaignStats } from '../services/campaignWorker.js';
import { getWhatsAppConfig, sendWhatsAppCloudMessage, sanitizePhoneNumber } from '../services/whatsapp.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { escapeRegex } from '../utils/security.js';
import { getJwtSecret } from '../config/jwt.js';

export const whatsappRouter = express.Router();

/**
 * GET /api/whatsapp/status
 * Returns safe connection status for the authenticated shop.
 * NEVER returns access tokens, app secrets, or internal encryption keys.
 */
whatsappRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const metaAppId = process.env.META_APP_ID || '';
    const metaConfigId = process.env.META_CONFIG_ID || '';
    const isConfigured = Boolean(metaAppId && (process.env.META_APP_SECRET || metaConfigId));

    const conn = await WhatsAppConnection.findOne({ shopId }).lean();

    if (!conn || !conn.connected || conn.connectionStatus !== 'CONNECTED') {
      return res.json({
        connected: false,
        status: conn?.connectionStatus || 'NOT_CONNECTED',
        businessName: '',
        displayPhoneNumber: '',
        businessAccountId: '',
        phoneNumberId: '',
        metaAppConfigured: isConfigured,
        metaAppId: metaAppId,
        metaConfigId: metaConfigId
      });
    }

    return res.json({
      connected: true,
      status: 'CONNECTED',
      businessName: conn.businessName || 'WhatsApp Business Account',
      displayPhoneNumber: conn.displayPhoneNumber || 'Connected',
      businessAccountId: conn.businessAccountId ? `${conn.businessAccountId.substring(0, 4)}***` : '',
      phoneNumberId: conn.phoneNumberId ? `${conn.phoneNumberId.substring(0, 4)}***` : '',
      connectedAt: conn.connectedAt,
      metaAppConfigured: isConfigured
    });
  } catch (err) {
    console.error('Error fetching WhatsApp connection status:', err);
    res.status(500).json({ error: 'Failed to fetch WhatsApp connection status' });
  }
});

/**
 * POST /api/whatsapp/connect
 * Generates official Meta Embedded Signup / OAuth authorization URL with CSRF state token.
 */
whatsappRouter.post('/connect', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const metaAppId = process.env.META_APP_ID;
    const metaConfigId = process.env.META_CONFIG_ID;
    const apiVersion = process.env.META_API_VERSION || 'v19.0';
    const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/whatsapp/callback`;

    if (!metaAppId) {
      return res.status(400).json({
        error: 'Meta Developer App credentials not configured on server.',
        metaConfigRequired: true,
        details: 'META_APP_ID and META_APP_SECRET must be set in server environment variables.'
      });
    }

    // Generate signed CSRF state token tied to authenticated shopId
    const stateToken = jwt.sign(
      { shopId, type: 'meta_whatsapp_oauth', timestamp: Date.now() },
      getJwtSecret(),
      { expiresIn: '15m' }
    );

    // Update connection state to CONNECTING
    await WhatsAppConnection.findOneAndUpdate(
      { shopId },
      { 
        shopId, 
        connectionStatus: 'CONNECTING',
        lastError: ''
      },
      { upsert: true, new: true }
    );

    // Build official Meta OAuth authorization URL
    let authUrl = `https://www.facebook.com/${apiVersion}/dialog/oauth?` +
      `client_id=${encodeURIComponent(metaAppId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(stateToken)}` +
      `&scope=${encodeURIComponent('whatsapp_business_management,whatsapp_business_messaging')}`;

    if (metaConfigId) {
      authUrl += `&setup=${encodeURIComponent(metaConfigId)}`;
    }

    res.json({
      success: true,
      authUrl,
      metaAppId,
      metaConfigId,
      stateToken
    });

  } catch (err) {
    console.error('Error generating WhatsApp connection OAuth URL:', err);
    res.status(500).json({ error: 'Failed to initialize Meta WhatsApp authorization flow.' });
  }
});

/**
 * GET /api/whatsapp/callback (OAuth Redirect Endpoint)
 * Processes redirect back from Meta, validates CSRF state token, exchanges code for access token,
 * verifies identifiers with Meta Graph API, and securely persists connection.
 */
whatsappRouter.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const redirectTarget = `${frontendUrl.replace(/\/+$/, '')}/settings?whatsapp_status=`;

  if (error || !code || !state) {
    console.error('[META OAUTH CALLBACK ERROR]:', error, error_description);
    return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent(error_description || 'Authorization was cancelled or failed')}`);
  }

  try {
    // 1. Verify CSRF State Token (pin HS256)
    const decoded = jwt.verify(String(state), getJwtSecret(), { algorithms: ['HS256'] });
    if (!decoded || !decoded.shopId || decoded.type !== 'meta_whatsapp_oauth') {
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('Invalid OAuth state parameter')}`);
    }

    const shopId = decoded.shopId;
    const metaAppId = process.env.META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    const apiVersion = process.env.META_API_VERSION || 'v19.0';
    const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/whatsapp/callback`;

    if (!metaAppId || !metaAppSecret) {
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: 'Meta App credentials missing' });
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('Server missing Meta App credentials')}`);
    }

    // 2. Exchange code for User Access Token
    const tokenUrl = `https://graph.facebook.com/${apiVersion}/oauth/access_token?` +
      `client_id=${encodeURIComponent(metaAppId)}` +
      `&client_secret=${encodeURIComponent(metaAppSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${encodeURIComponent(String(code))}`;

    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(15000) });
    const tokenData = await tokenRes.json().catch(() => null);

    if (!tokenRes.ok || !tokenData?.access_token) {
      console.error('[META TOKEN EXCHANGE ERROR]:', tokenData);
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: tokenData?.error?.message || 'Token exchange failed' });
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('Failed to exchange code for access token with Meta')}`);
    }

    const accessToken = tokenData.access_token;

    // 3. Verify Connection & Fetch Business / Phone Details from Meta Graph API
    const meRes = await fetch(`https://graph.facebook.com/${apiVersion}/me/whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(15000)
    });
    const meData = await meRes.json().catch(() => null);

    if (!meRes.ok) {
      console.error('[META WABA FETCH ERROR]:', meData);
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: meData?.error?.message || 'Failed to fetch WhatsApp Business Account' });
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('Failed to retrieve WhatsApp Business Account details from Meta')}`);
    }

    let businessAccountId = '';
    let businessName = 'WhatsApp Business Account';
    let phoneNumberId = '';
    let displayPhoneNumber = '';

    if (meData && meData.data && meData.data.length > 0) {
      const waba = meData.data[0];
      businessAccountId = waba.id;
      businessName = waba.name || businessName;

      // Fetch Phone Numbers linked to WABA
      const phoneRes = await fetch(`https://graph.facebook.com/${apiVersion}/${businessAccountId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`, {
        signal: AbortSignal.timeout(15000)
      });
      const phoneData = await phoneRes.json().catch(() => null);
      if (phoneRes.ok && phoneData && phoneData.data && phoneData.data.length > 0) {
        phoneNumberId = phoneData.data[0].id;
        displayPhoneNumber = phoneData.data[0].display_phone_number || phoneData.data[0].verified_name || '';
      }
    }

    if (!businessAccountId || !phoneNumberId) {
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: 'No WhatsApp Business Account or Phone Number found on this Meta account' });
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('No WhatsApp Business Account or phone number linked to your Meta account')}`);
    }

    // 4. Encrypt Access Token for Secure Storage at Rest
    const { encryptedData, iv, authTag } = encryptToken(accessToken);

    // 5. Persist Verified Connection in MongoDB tied strictly to shopId
    await WhatsAppConnection.findOneAndUpdate(
      { shopId },
      {
        shopId,
        connected: true,
        connectionStatus: 'CONNECTED',
        businessAccountId,
        businessName,
        phoneNumberId,
        displayPhoneNumber,
        encryptedAccessToken: encryptedData,
        tokenIV: iv,
        tokenAuthTag: authTag,
        connectedAt: new Date(),
        lastVerifiedAt: new Date(),
        lastError: ''
      },
      { upsert: true, new: true }
    );

    // Log Activity
    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      type: 'whatsapp_connected',
      description: `WhatsApp Business connected (${businessName} - ${displayPhoneNumber})`,
      shopId
    }).catch(() => {});

    return res.redirect(`${redirectTarget}connected`);

  } catch (err) {
    console.error('[META CALLBACK EXCEPTION]:', err);
    return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('WhatsApp verification failed')}`);
  }
});

/**
 * POST /api/whatsapp/verify-embedded-signup
 * Verifies and saves credentials received via Meta Embedded Signup SDK flow (FB.login / System User Token).
 */
whatsappRouter.post('/verify-embedded-signup', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const { accessToken, businessAccountId, phoneNumberId } = req.body || {};

    if (!accessToken || !businessAccountId || !phoneNumberId) {
      return res.status(400).json({ error: 'accessToken, businessAccountId, and phoneNumberId are required' });
    }

    const apiVersion = process.env.META_API_VERSION || 'v19.0';

    // Verify Phone Number ID & Business Account with Meta API
    const verifyRes = await fetch(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}?access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(15000)
    });
    const verifyData = await verifyRes.json().catch(() => null);

    if (!verifyRes.ok) {
      console.error('[EMBEDDED SIGNUP VERIFICATION FAILED]:', verifyData);
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: verifyData?.error?.message || 'Meta verification failed' });
      return res.status(400).json({ error: verifyData?.error?.message || 'Meta phone number verification failed' });
    }

    const displayPhoneNumber = verifyData.display_phone_number || verifyData.verified_name || phoneNumberId;
    const businessName = verifyData.verified_name || 'WhatsApp Business';

    // Encrypt Token
    const { encryptedData, iv, authTag } = encryptToken(accessToken);

    await WhatsAppConnection.findOneAndUpdate(
      { shopId },
      {
        shopId,
        connected: true,
        connectionStatus: 'CONNECTED',
        businessAccountId,
        businessName,
        phoneNumberId,
        displayPhoneNumber,
        encryptedAccessToken: encryptedData,
        tokenIV: iv,
        tokenAuthTag: authTag,
        connectedAt: new Date(),
        lastVerifiedAt: new Date(),
        lastError: ''
      },
      { upsert: true, new: true }
    );

    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      type: 'whatsapp_connected',
      description: `WhatsApp Business connected (${businessName} - ${displayPhoneNumber})`,
      shopId
    }).catch(() => {});

    res.json({
      success: true,
      connected: true,
      status: 'CONNECTED',
      businessName,
      displayPhoneNumber
    });

  } catch (err) {
    console.error('Error verifying embedded signup:', err);
    res.status(500).json({ error: 'Failed to verify Meta embedded signup connection' });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Securely removes & deactivates WhatsApp connection for authenticated shop.
 */
whatsappRouter.post('/disconnect', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }

    await WhatsAppConnection.findOneAndUpdate(
      { shopId },
      {
        connected: false,
        connectionStatus: 'DISCONNECTED',
        encryptedAccessToken: '',
        tokenIV: '',
        tokenAuthTag: '',
        businessAccountId: '',
        phoneNumberId: '',
        displayPhoneNumber: '',
        businessName: '',
        lastError: ''
      }
    );

    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      type: 'whatsapp_disconnected',
      description: 'WhatsApp Business account disconnected',
      shopId
    }).catch(() => {});

    res.json({
      success: true,
      connected: false,
      status: 'DISCONNECTED'
    });
  } catch (err) {
    console.error('Error disconnecting WhatsApp:', err);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp Business account' });
  }
});

// POST /api/whatsapp/send - Direct WhatsApp message dispatch endpoint with shop isolation & mock fallback
whatsappRouter.post('/send', requireAuth, async (req, res) => {
  try {
    const { customerId, message, followUpId } = req.body || {};
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }

    if (!customerId || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'customerId and non-empty message content are required' });
    }

    // Verify customer belongs strictly to authenticated user's shop
    const customer = await Customer.findOne({ id: customerId, shopId }).lean();
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found or does not belong to your shop account' });
    }

    // Attempt WhatsApp Cloud API dispatch (falls back to mock if credentials missing)
    const result = await sendWhatsAppCloudMessage(customer.phone, message.trim(), shopId);

    // Record Message entry in MongoDB with shop isolation
    const msgId = `MSG-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const newMsg = new Message({
      id: msgId,
      customerId: customer.id,
      followUpId: followUpId || '',
      channel: 'whatsapp',
      content: message.trim(),
      status: result.status,
      provider: result.provider,
      providerMessageId: result.providerMessageId || '',
      error: result.error || '',
      sentAt: new Date(),
      shopId
    });
    await newMsg.save();

    // Log Activity
    await Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: customer.id,
      type: 'message_sent',
      description: `WhatsApp message (${result.provider}): "${message.substring(0, 30)}..."`,
      metadata: { channel: 'whatsapp', messageId: msgId, provider: result.provider, status: result.status },
      shopId
    });

    // If linked to a FollowUp, update follow-up status
    if (followUpId) {
      await FollowUp.findOneAndUpdate(
        { id: followUpId, shopId },
        { status: 'sent', message: message.trim(), messageId: msgId }
      );
    }

    res.json({
      success: result.success,
      status: result.status,
      provider: result.provider,
      messageId: msgId,
      providerMessageId: result.providerMessageId,
      message: newMsg,
      error: result.error
    });

  } catch (err) {
    console.error('WhatsApp send endpoint error:', err);
    res.status(500).json({ error: `Failed to send WhatsApp message: ${err.message}` });
  }
});

// GET /api/whatsapp/webhook - Meta Graph API Webhook Challenge Verification
whatsappRouter.get('/webhook', (req, res) => {
  const config = getWhatsAppConfig();
  const mode = req.query['hub.mode'];
  const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : '';
  const challenge = req.query['hub.challenge'];

  if (mode && challenge) {
    if (!config._verifyToken) {
      console.warn('⚠️ WhatsApp Webhook verify rejected: WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured');
      return res.status(403).json({ error: 'Webhook verify token is not configured on server' });
    }
    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(String(config._verifyToken), 'utf8');
    const tokenMatches = tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);

    if (mode === 'subscribe' && tokenMatches) {
      console.log('✅ WhatsApp Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      console.warn('⚠️ WhatsApp Webhook verification failed: Invalid verify token');
      return res.status(403).json({ error: 'Webhook verification failed: Invalid verify token' });
    }
  }
  res.status(400).json({ error: 'Invalid webhook request parameters' });
});

// POST /api/whatsapp/webhook - Incoming Meta Status Updates (sent, delivered, read, failed)
whatsappRouter.post('/webhook', async (req, res) => {
  try {
    const config = getWhatsAppConfig();

    // Fail-closed webhook signature validation
    if (!config._appSecret && process.env.NODE_ENV === 'production') {
      console.error('⚠️ WhatsApp Webhook rejected: META_APP_SECRET is not configured in production');
      return res.status(503).json({ error: 'Webhook secret not configured on server' });
    }

    if (config._appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      if (typeof signature !== 'string' || !signature) {
        console.warn('⚠️ WhatsApp Webhook missing signature header');
        return res.status(401).json({ error: 'Missing webhook signature header (x-hub-signature-256 required)' });
      }

      const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const expectedSignature = 'sha256=' + crypto.createHmac('sha256', config._appSecret).update(rawPayload).digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.warn('⚠️ WhatsApp Webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const entries = body.entry || [];

      // Monotonic progression rank: higher rank never downgrades to lower rank
      const STATUS_RANK = {
        'PENDING': 10,
        'QUEUED': 20,
        'SENDING': 25,
        'SENT': 30,
        'DELIVERED': 40,
        'READ': 50,
        'FAILED': 60,
        'SKIPPED': 60,
        'CANCELLED': 60
      };

      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value || {};
          const statuses = value.statuses || [];
          const messages = value.messages || [];
          
          // -----------------------------------------------------------
          // A. DELIVERY STATUS WEBHOOKS (sent, delivered, read, failed)
          // -----------------------------------------------------------
          for (const statusObj of statuses) {
            const providerMessageId = statusObj.id;
            const newStatus = statusObj.status; // 'sent', 'delivered', 'read', 'failed'
            const callbackRecipientId = statusObj.biz_opaque_callback_data;

            if (providerMessageId && ['sent', 'delivered', 'read', 'failed'].includes(newStatus)) {
              // 1. Update 1-to-1 message record if exists
              const matchingMsg = await Message.findOne({ providerMessageId });
              if (matchingMsg) {
                matchingMsg.status = newStatus;
                if (statusObj.errors && statusObj.errors.length > 0) {
                  matchingMsg.error = statusObj.errors[0].title || 'Delivery failed';
                }
                await matchingMsg.save();
                console.log(`[WHATSAPP WEBHOOK] 1-to-1 Message ${matchingMsg.id} (${providerMessageId}) status updated to: ${newStatus}`);
              }

              // 2. Update multi-recipient campaign recipient if exists (lookup by providerMessageId or callbackData)
              let matchingRecipient = await CampaignRecipient.findOne({ providerMessageId });
              if (!matchingRecipient && callbackRecipientId) {
                matchingRecipient = await CampaignRecipient.findOne({ id: callbackRecipientId });
                if (matchingRecipient && !matchingRecipient.providerMessageId) {
                  matchingRecipient.providerMessageId = providerMessageId;
                }
              }

              if (matchingRecipient) {
                const upperStatus = newStatus.toUpperCase(); // 'SENT', 'DELIVERED', 'READ', 'FAILED'
                const currentRank = STATUS_RANK[matchingRecipient.status] || 0;
                const incomingRank = STATUS_RANK[upperStatus] || 0;
                const timestampDate = statusObj.timestamp ? new Date(Number(statusObj.timestamp) * 1000) : new Date();

                // Preserve delivery timestamps monotonically
                if (upperStatus === 'DELIVERED' && !matchingRecipient.deliveredAt) {
                  matchingRecipient.deliveredAt = timestampDate;
                }
                if (upperStatus === 'READ') {
                  if (!matchingRecipient.deliveredAt) matchingRecipient.deliveredAt = timestampDate;
                  if (!matchingRecipient.readAt) matchingRecipient.readAt = timestampDate;
                }

                // Monotonic status progression & idempotency check:
                // An already DELIVERED or READ message cannot be downgraded back to SENT or FAILED.
                const isAlreadyDeliveredOrRead = ['DELIVERED', 'READ'].includes(matchingRecipient.status);
                const isAttemptingFailureAfterDelivery = isAlreadyDeliveredOrRead && upperStatus === 'FAILED';
                const isDuplicateOrRegression = currentRank >= incomingRank;

                if (!isAttemptingFailureAfterDelivery && !isDuplicateOrRegression) {
                  matchingRecipient.status = upperStatus;
                }

                if (upperStatus === 'FAILED' && !isAlreadyDeliveredOrRead) {
                  if (statusObj.errors && statusObj.errors.length > 0) {
                    matchingRecipient.errorCode = String(statusObj.errors[0].code || 'DELIVERY_FAILED');
                    matchingRecipient.errorMessage = statusObj.errors[0].title || 'Delivery failed';
                  }
                }

                await matchingRecipient.save();
                console.log(`[WHATSAPP WEBHOOK] Campaign Recipient ${matchingRecipient.id} (${providerMessageId || matchingRecipient.providerMessageId}) status: ${matchingRecipient.status}`);

                // Synchronize parent campaign aggregated counts
                await syncCampaignStats(matchingRecipient.campaignId, matchingRecipient.shopId);
              }
            }
          }

          // -----------------------------------------------------------
          // B. INCOMING CUSTOMER MESSAGES (e.g. Opt-Out via STOP / UNSUBSCRIBE)
          // -----------------------------------------------------------
          const webhookPhoneNumberId = value.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : '';
          let scopedShopIds = null;
          if (webhookPhoneNumberId && messages.length > 0) {
            const conns = await WhatsAppConnection.find({ phoneNumberId: webhookPhoneNumberId, connected: true }).select('shopId').lean();
            scopedShopIds = conns.map(c => c.shopId).filter(Boolean);
          }

          for (const msg of messages) {
            const senderPhone = sanitizePhoneNumber(msg.from);
            const digitsOnly = senderPhone.replace(/\D/g, '');
            const last10Digits = digitsOnly.slice(-10);
            const msgText = msg.text?.body ? msg.text.body.trim().toUpperCase() : '';

            // Meta standard marketing opt-out keywords: STOP, UNSUBSCRIBE, CANCEL, QUIT, STOPPROMO
            const isOptOut = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'STOPPROMO'].includes(msgText);
            if (isOptOut && last10Digits.length >= 10) {
              console.log(`🛑 [WHATSAPP WEBHOOK OPT-OUT] Received opt-out command "${msgText}"`);

              const custFilter = {
                phone: { $regex: `${escapeRegex(last10Digits)}$` }
              };
              if (Array.isArray(scopedShopIds)) {
                if (scopedShopIds.length === 0) continue;
                custFilter.shopId = { $in: scopedShopIds };
              }

              const customers = await Customer.find(custFilter).lean();
              const affectedCampaigns = new Set();

              for (const cust of customers) {
                // 1. Mark consent as withdrawn in ConsentRecord (scoped by shopId)
                await ConsentRecord.updateMany(
                  { shopId: cust.shopId, userId: cust.id, purpose: 'marketing' },
                  {
                    $set: {
                      status: 'withdrawn',
                      withdrawnAt: new Date()
                    }
                  }
                );

                // 2. Immediately cancel any QUEUED, SENDING, or PENDING campaign recipients for this customer in this shop
                const activeRecs = await CampaignRecipient.find({
                  shopId: cust.shopId,
                  customerId: cust.id,
                  status: { $in: ['QUEUED', 'SENDING', 'PENDING'] }
                }).select('campaignId').lean();

                if (activeRecs.length > 0) {
                  await CampaignRecipient.updateMany(
                    { shopId: cust.shopId, customerId: cust.id, status: { $in: ['QUEUED', 'SENDING', 'PENDING'] } },
                    {
                      $set: {
                        status: 'SKIPPED',
                        errorCode: 'CUSTOMER_OPTED_OUT',
                        errorMessage: 'Customer opted out via WhatsApp message.'
                      }
                    }
                  );
                  for (const rec of activeRecs) {
                    if (rec.campaignId) affectedCampaigns.add(`${cust.shopId}::${rec.campaignId}`);
                  }
                }
              }

              for (const key of affectedCampaigns) {
                const [sId, cId] = key.split('::');
                await syncCampaignStats(cId, sId);
              }
            }
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }

    res.status(404).send('Not a WhatsApp event');
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
    // Always return 200 to Meta webhooks to avoid server retry floods
    res.status(200).send('EVENT_PROCESSED_WITH_ERRORS');
  }
});

