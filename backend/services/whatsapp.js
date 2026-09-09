/**
 * WhatsApp Cloud API Service Module
 * Handles Meta Graph API communication, phone number sanitization, mock fallback mode, and security.
 */

import { WhatsAppConnection } from '../models/WhatsAppConnection.js';
import { decryptToken } from '../utils/crypto.js';

export const getWhatsAppConfig = () => {
  const version = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v19.0';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
  const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';

  const configured = Boolean(accessToken && phoneNumberId);

  return {
    configured,
    provider: configured ? 'whatsapp_cloud_api' : 'mock',
    mode: configured ? 'production' : 'development',
    version,
    phoneNumberId,
    businessAccountId,
    // Secret values stay inside this module and are NEVER exported to API responses
    _accessToken: accessToken,
    _verifyToken: verifyToken,
    _appSecret: appSecret
  };
};

export const sanitizePhoneNumber = (phone) => {
  if (!phone) return '';
  // Strip all non-digit characters
  let digits = String(phone).replace(/\D/g, '');
  // Default to Indian country code +91 if 10 digits provided
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
};

export const sendWhatsAppCloudMessage = async (recipientPhone, textMessage, shopId = null) => {
  let accessToken = '';
  let phoneNumberId = '';
  let apiVersion = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v19.0';

  // 1. Try shop-specific Meta WhatsApp connection if shopId provided
  if (shopId) {
    try {
      const conn = await WhatsAppConnection.findOne({ shopId, connected: true, connectionStatus: 'CONNECTED' });
      if (conn && conn.encryptedAccessToken && conn.phoneNumberId) {
        const decrypted = decryptToken(conn.encryptedAccessToken, conn.tokenIV, conn.tokenAuthTag);
        if (decrypted) {
          accessToken = decrypted;
          phoneNumberId = conn.phoneNumberId;
        }
      }
    } catch (e) {
      console.warn('[WHATSAPP SERVICE] Error fetching shop WhatsApp connection:', e.message);
    }
  }

  // 2. Fall back to global env variables if no shop-specific connection found
  if (!accessToken || !phoneNumberId) {
    const config = getWhatsAppConfig();
    accessToken = config._accessToken;
    phoneNumberId = config.phoneNumberId;
  }

  // Fallback to Mock Mode if no valid credentials found
  if (!accessToken || !phoneNumberId) {
    return {
      success: true,
      status: 'mock',
      provider: 'mock',
      providerMessageId: `MOCK-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    };
  }

  const cleanPhone = sanitizePhoneNumber(recipientPhone);
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Invalid recipient phone number format.');
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'text',
    text: { preview_url: false, body: textMessage }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config._accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || `WhatsApp API error (${response.status})`;
      console.error('[WHATSAPP SERVICE ERROR]:', errorMsg);
      return {
        success: false,
        status: 'failed',
        provider: 'whatsapp_cloud_api',
        error: errorMsg
      };
    }

    const providerMessageId = data?.messages?.[0]?.id || `WAMID-${Date.now()}`;
    return {
      success: true,
      status: 'sent',
      provider: 'whatsapp_cloud_api',
      providerMessageId
    };

  } catch (err) {
    console.error('[WHATSAPP SERVICE EXCEPTION]:', err.message);
    return {
      success: false,
      status: 'failed',
      provider: 'whatsapp_cloud_api',
      error: err.message || 'Network exception while connecting to Meta WhatsApp Cloud API'
    };
  }
};
