import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { Customer } from '../models/Customer.js';
import { Message } from '../models/Message.js';
import { FollowUp } from '../models/FollowUp.js';
import { Activity } from '../models/Activity.js';
import { WhatsAppConnection } from '../models/WhatsAppConnection.js';
import { getWhatsAppConfig, sendWhatsAppCloudMessage } from '../services/whatsapp.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
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
whatsappRouter.post('/connect', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
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
    // 1. Verify CSRF State Token
    const decoded = jwt.verify(state, getJwtSecret());
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
      `&code=${encodeURIComponent(code)}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[META TOKEN EXCHANGE ERROR]:', tokenData);
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: tokenData?.error?.message || 'Token exchange failed' });
      return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent('Failed to exchange code for access token with Meta')}`);
    }

    const accessToken = tokenData.access_token;

    // 3. Verify Connection & Fetch Business / Phone Details from Meta Graph API
    const meRes = await fetch(`https://graph.facebook.com/${apiVersion}/me/whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}`);
    const meData = await meRes.json();

    let businessAccountId = '';
    let businessName = 'WhatsApp Business Account';
    let phoneNumberId = '';
    let displayPhoneNumber = '';

    if (meData && meData.data && meData.data.length > 0) {
      const waba = meData.data[0];
      businessAccountId = waba.id;
      businessName = waba.name || businessName;

      // Fetch Phone Numbers linked to WABA
      const phoneRes = await fetch(`https://graph.facebook.com/${apiVersion}/${businessAccountId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`);
      const phoneData = await phoneRes.json();
      if (phoneData && phoneData.data && phoneData.data.length > 0) {
        phoneNumberId = phoneData.data[0].id;
        displayPhoneNumber = phoneData.data[0].display_phone_number || phoneData.data[0].verified_name || '';
      }
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
      id: `ACT-${Date.now()}`,
      type: 'whatsapp_connected',
      description: `WhatsApp Business connected (${businessName} - ${displayPhoneNumber})`,
      shopId
    }).catch(() => {});

    return res.redirect(`${redirectTarget}connected`);

  } catch (err) {
    console.error('[META CALLBACK EXCEPTION]:', err);
    return res.redirect(`${redirectTarget}failed&msg=${encodeURIComponent(err.message || 'Verification failed')}`);
  }
});

/**
 * POST /api/whatsapp/verify-embedded-signup
 * Verifies and saves credentials received via Meta Embedded Signup SDK flow (FB.login / System User Token).
 */
whatsappRouter.post('/verify-embedded-signup', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { accessToken, businessAccountId, phoneNumberId } = req.body;

    if (!accessToken || !businessAccountId || !phoneNumberId) {
      return res.status(400).json({ error: 'accessToken, businessAccountId, and phoneNumberId are required' });
    }

    const apiVersion = process.env.META_API_VERSION || 'v19.0';

    // Verify Phone Number ID & Business Account with Meta API
    const verifyRes = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}?access_token=${encodeURIComponent(accessToken)}`);
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      console.error('[EMBEDDED SIGNUP VERIFICATION FAILED]:', verifyData);
      await WhatsAppConnection.findOneAndUpdate({ shopId }, { connectionStatus: 'FAILED', lastError: verifyData?.error?.message || 'Meta verification failed' });
      return res.status(400).json({ error: verifyData?.error?.message || 'Meta phone number verification failed' });
    }

    const displayPhoneNumber = verifyData.display_phone_number || verifyData.verified_name || phoneNumberId;
    const businessName = verifyData.verified_name || 'WhatsApp Business';

    // Encrypt Token
    const { encryptedData, iv, authTag } = encryptToken(accessToken);

    const connection = await WhatsAppConnection.findOneAndUpdate(
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
      id: `ACT-${Date.now()}`,
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
    res.status(500).json({ error: err.message || 'Failed to verify Meta embedded signup connection' });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Securely removes & deactivates WhatsApp connection for authenticated shop.
 */
whatsappRouter.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;

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
      id: `ACT-${Date.now()}`,
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
    const { customerId, message, followUpId } = req.body;
    const shopId = req.user.shopId;

    if (!customerId || !message || !message.trim()) {
      return res.status(400).json({ error: 'customerId and non-empty message content are required' });
    }

    // Verify customer belongs strictly to authenticated user's shop
    const customer = await Customer.findOne({ id: customerId, shopId });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found or does not belong to your shop account' });
    }

    // Attempt WhatsApp Cloud API dispatch (falls back to mock if credentials missing)
    const result = await sendWhatsAppCloudMessage(customer.phone, message.trim(), shopId);

    // Record Message entry in MongoDB with shop isolation
    const msgId = `MSG-${Date.now()}`;
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
      id: `ACT-${Date.now()}`,
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
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && challenge) {
    if (mode === 'subscribe' && (token === config._verifyToken || (!config._verifyToken && !token))) {
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

    // Validate Signature if APP_SECRET is set
    if (config._appSecret && req.headers['x-hub-signature-256']) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = JSON.stringify(req.body);
      const expectedSignature = 'sha256=' + crypto.createHmac('sha256', config._appSecret).update(rawBody).digest('hex');
      
      if (signature !== expectedSignature) {
        console.warn('⚠️ WhatsApp Webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value || {};
          const statuses = value.statuses || [];
          
          for (const statusObj of statuses) {
            const providerMessageId = statusObj.id;
            const newStatus = statusObj.status; // 'sent', 'delivered', 'read', 'failed'

            if (providerMessageId && ['sent', 'delivered', 'read', 'failed'].includes(newStatus)) {
              const matchingMsg = await Message.findOne({ providerMessageId });
              if (matchingMsg) {
                matchingMsg.status = newStatus;
                if (statusObj.errors && statusObj.errors.length > 0) {
                  matchingMsg.error = statusObj.errors[0].title || 'Delivery failed';
                }
                await matchingMsg.save();
                console.log(`[WHATSAPP WEBHOOK] Message ${matchingMsg.id} (${providerMessageId}) status updated to: ${newStatus}`);
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

