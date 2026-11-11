/**
 * WhatsApp Cloud API Service Module
 * Handles Meta Graph API communication, phone number sanitization, per-shop multi-tenant credentials,
 * template messaging, mock fallback mode, and security.
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
  // Strip leading 0 if 11 digits (e.g. 09876543210 -> 9876543210)
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  // Default to Indian country code +91 if 10 digits provided
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
};

export const normalizePhone = (phone) => {
  const digits = sanitizePhoneNumber(phone);
  if (!digits || digits.length < 10) return null;
  return `+${digits}`;
};

/**
 * Retrieves and decrypts the official WhatsApp credentials for a specific shop.
 * Strictly guarantees shop-level tenant isolation.
 */
export const getShopWhatsAppCredentials = async (shopId) => {
  if (!shopId) return { connected: false, error: 'Shop context missing.' };

  try {
    const conn = await WhatsAppConnection.findOne({
      shopId,
      connected: true,
      connectionStatus: 'CONNECTED'
    }).lean();

    if (!conn || !conn.encryptedAccessToken || !conn.phoneNumberId) {
      return {
        connected: false,
        error: 'WhatsApp Business account is not connected for this shop.'
      };
    }

    const decryptedToken = decryptToken(conn.encryptedAccessToken, conn.tokenIV, conn.tokenAuthTag);
    if (!decryptedToken) {
      return {
        connected: false,
        error: 'Failed to decrypt WhatsApp access token for this shop.'
      };
    }

    return {
      connected: true,
      accessToken: decryptedToken,
      phoneNumberId: conn.phoneNumberId,
      businessAccountId: conn.businessAccountId || '',
      displayPhoneNumber: conn.displayPhoneNumber || '',
      businessName: conn.businessName || 'WhatsApp Business'
    };
  } catch (err) {
    console.error(`[WHATSAPP CREDENTIALS ERROR] Shop ${shopId}:`, err.message);
    return { connected: false, error: err.message };
  }
};

/**
 * Standard Approved Meta WhatsApp Templates catalog.
 * Follows Meta's official WhatsApp Business Message Template guidelines for Marketing.
 */
export const STANDARD_WHATSAPP_TEMPLATES = [
  {
    name: 'quickr_offer_campaign',
    title: 'Standard Promotional Offer',
    category: 'MARKETING',
    language: 'en',
    description: 'Promotional discount message with shop name, customer name, discount, product, and dates.',
    variables: ['ShopName', 'CustomerName', 'DiscountValue', 'ProductName', 'StartDate', 'EndDate'],
    sampleText: '🎉 Special Offer from {{ShopName}}!\n\nHi {{CustomerName}},\n\nGet {{DiscountValue}} OFF on {{ProductName}}!\n\nOffer valid from {{StartDate}} until {{EndDate}}.\n\nVisit us to claim your offer!'
  },
  {
    name: 'quickr_festive_deal',
    title: 'Festive & Special Occasion Deal',
    category: 'MARKETING',
    language: 'en',
    description: 'Celebrate festive seasons and holidays with limited-time exclusive discounts.',
    variables: ['ShopName', 'CustomerName', 'Occasion', 'DiscountValue', 'EndDate'],
    sampleText: '✨ Festive Greetings from {{ShopName}}!\n\nDear {{CustomerName}},\n\nCelebrate {{Occasion}} with an exclusive {{DiscountValue}} OFF!\n\nOffer valid until {{EndDate}}. We look forward to welcoming you!'
  },
  {
    name: 'quickr_clearance_sale',
    title: 'Clearance & End of Season Sale',
    category: 'MARKETING',
    language: 'en',
    description: 'Urgent clearance announcement for end-of-season and surplus inventory.',
    variables: ['ShopName', 'CustomerName', 'DiscountValue', 'EndDate'],
    sampleText: '🔥 Mega Clearance Sale at {{ShopName}}!\n\nHi {{CustomerName}},\n\nHurry! Enjoy up to {{DiscountValue}} OFF on top collections before stock runs out!\n\nSale ends on {{EndDate}}. Visit our shop today!'
  },
  {
    name: 'quickr_new_arrival',
    title: 'New Collection & Arrival Announcement',
    category: 'MARKETING',
    language: 'en',
    description: 'Showcase newly arrived stock, textiles, and apparel with an introductory perk.',
    variables: ['ShopName', 'CustomerName', 'CollectionName', 'DiscountValue', 'EndDate'],
    sampleText: '👗 New Arrivals Alert at {{ShopName}}!\n\nHello {{CustomerName}},\n\nExplore our latest {{CollectionName}}! Enjoy {{DiscountValue}} OFF on your first purchase from this collection.\n\nOffer valid until {{EndDate}}.'
  }
];

/**
 * Returns available templates for a shop.
 * Combines Standard QuickR templates with any approved templates fetched live from Meta if shop is connected.
 */
export const getAvailableTemplates = async (shopId) => {
  const templates = [...STANDARD_WHATSAPP_TEMPLATES];

  if (shopId) {
    try {
      const creds = await getShopWhatsAppCredentials(shopId);
      if (creds.connected && creds.businessAccountId && creds.accessToken) {
        const apiVersion = process.env.META_API_VERSION || 'v19.0';
        const url = `https://graph.facebook.com/${apiVersion}/${creds.businessAccountId}/message_templates?fields=name,status,language,category,components&limit=50`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${creds.accessToken}` },
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.data)) {
            data.data.forEach(metaTpl => {
              if (metaTpl.status === 'APPROVED' && !templates.some(t => t.name === metaTpl.name)) {
                templates.push({
                  name: metaTpl.name,
                  title: metaTpl.name.replace(/_/g, ' ').toUpperCase(),
                  category: metaTpl.category || 'MARKETING',
                  language: metaTpl.language || 'en',
                  description: 'Official approved template synced from your Meta Business Account.',
                  variables: [],
                  sampleText: metaTpl.components?.find(c => c.type === 'BODY')?.text || 'Template Body'
                });
              }
            });
          }
        }
      }
    } catch (err) {
      // Graceful fallback to standard templates
      console.warn(`[TEMPLATES SYNC WARN] Could not query live Meta templates for shop ${shopId}:`, err.message);
    }
  }

  return templates;
};

/**
 * Builds Meta Template Components from Campaign and Customer details.
 */
export const buildTemplateComponents = (campaign, customer, shopName) => {
  const discountFormatted = campaign.discountType === 'Percentage'
    ? `${campaign.discountValue}%`
    : `₹${campaign.discountValue}`;

  const startDateFormatted = new Date(campaign.startDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const endDateFormatted = new Date(campaign.endDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const tName = campaign.templateName || 'quickr_offer_campaign';

  // Specific mapping depending on template structure
  let bodyParams = [];

  if (tName === 'quickr_offer_campaign') {
    // {{1}} ShopName, {{2}} CustomerName, {{3}} DiscountValue, {{4}} ProductName, {{5}} StartDate, {{6}} EndDate
    bodyParams = [
      { type: 'text', text: shopName || 'QuickR Shop' },
      { type: 'text', text: customer.name || 'Valued Customer' },
      { type: 'text', text: discountFormatted },
      { type: 'text', text: campaign.title || 'Store Items' },
      { type: 'text', text: startDateFormatted },
      { type: 'text', text: endDateFormatted }
    ];
  } else if (tName === 'quickr_festive_deal') {
    // {{1}} ShopName, {{2}} CustomerName, {{3}} Occasion, {{4}} DiscountValue, {{5}} EndDate
    bodyParams = [
      { type: 'text', text: shopName || 'QuickR Shop' },
      { type: 'text', text: customer.name || 'Valued Customer' },
      { type: 'text', text: campaign.title || 'Special Celebration' },
      { type: 'text', text: discountFormatted },
      { type: 'text', text: endDateFormatted }
    ];
  } else if (tName === 'quickr_clearance_sale') {
    // {{1}} ShopName, {{2}} CustomerName, {{3}} DiscountValue, {{4}} EndDate
    bodyParams = [
      { type: 'text', text: shopName || 'QuickR Shop' },
      { type: 'text', text: customer.name || 'Valued Customer' },
      { type: 'text', text: discountFormatted },
      { type: 'text', text: endDateFormatted }
    ];
  } else if (tName === 'quickr_new_arrival') {
    // {{1}} ShopName, {{2}} CustomerName, {{3}} CollectionName, {{4}} DiscountValue, {{5}} EndDate
    bodyParams = [
      { type: 'text', text: shopName || 'QuickR Shop' },
      { type: 'text', text: customer.name || 'Valued Customer' },
      { type: 'text', text: campaign.title || 'Latest Arrivals' },
      { type: 'text', text: discountFormatted },
      { type: 'text', text: endDateFormatted }
    ];
  } else {
    // Generic fallback: pass shop name, customer name, discount, end date
    bodyParams = [
      { type: 'text', text: shopName || 'QuickR Shop' },
      { type: 'text', text: customer.name || 'Valued Customer' },
      { type: 'text', text: discountFormatted },
      { type: 'text', text: endDateFormatted }
    ];
  }

  const components = [
    {
      type: 'body',
      parameters: bodyParams
    }
  ];

  return components;
};

/**
 * Generates an accurate preview of the rendered template message text
 */
export const renderTemplatePreviewText = (templateName, campaign, customerName, shopName) => {
  const discountFormatted = campaign.discountType === 'Percentage'
    ? `${campaign.discountValue}%`
    : `₹${campaign.discountValue}`;

  const startDateFormatted = new Date(campaign.startDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const endDateFormatted = new Date(campaign.endDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const tpl = STANDARD_WHATSAPP_TEMPLATES.find(t => t.name === templateName) || STANDARD_WHATSAPP_TEMPLATES[0];

  return tpl.sampleText
    .replace(/\{\{ShopName\}\}/g, shopName || 'QuickR Shop')
    .replace(/\{\{CustomerName\}\}/g, customerName || 'Customer')
    .replace(/\{\{DiscountValue\}\}/g, discountFormatted)
    .replace(/\{\{ProductName\}\}/g, campaign.title || 'Store Offer')
    .replace(/\{\{Occasion\}\}/g, campaign.title || 'Festive Deal')
    .replace(/\{\{CollectionName\}\}/g, campaign.title || 'New Arrivals')
    .replace(/\{\{StartDate\}\}/g, startDateFormatted)
    .replace(/\{\{EndDate\}\}/g, endDateFormatted);
};

/**
 * Sends an official Meta WhatsApp Cloud API Template Message.
 * Used for outbound campaigns and re-engagement messaging.
 */
export const sendWhatsAppTemplateMessage = async ({
  recipientPhone,
  templateName,
  languageCode = 'en',
  components = [],
  shopId = null,
  customCredentials = null,
  callbackData = null
}) => {
  let accessToken = '';
  let phoneNumberId = '';
  const apiVersion = process.env.META_API_VERSION || 'v19.0';

  if (customCredentials && customCredentials.accessToken && customCredentials.phoneNumberId) {
    accessToken = customCredentials.accessToken;
    phoneNumberId = customCredentials.phoneNumberId;
  } else if (shopId) {
    const creds = await getShopWhatsAppCredentials(shopId);
    if (!creds.connected) {
      return {
        success: false,
        status: 'failed',
        provider: 'whatsapp_cloud_api',
        errorCode: 'WHATSAPP_NOT_CONNECTED',
        errorMessage: creds.error || 'Shop WhatsApp Business account is not connected.',
        isRetryable: false
      };
    }
    accessToken = creds.accessToken;
    phoneNumberId = creds.phoneNumberId;
  } else {
    return {
      success: false,
      status: 'failed',
      provider: 'whatsapp_cloud_api',
      errorCode: 'SHOP_ID_REQUIRED',
      errorMessage: 'Campaign sending requires a valid shopId context.',
      isRetryable: false
    };
  }

  const cleanPhone = sanitizePhoneNumber(recipientPhone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return {
      success: false,
      status: 'failed',
      provider: 'whatsapp_cloud_api',
      errorCode: 'INVALID_PHONE_NUMBER',
      errorMessage: 'Invalid or incomplete phone number format.',
      isRetryable: false
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || 'en' },
      components: Array.isArray(components) && components.length > 0 ? components : undefined
    }
  };

  if (callbackData) {
    payload.biz_opaque_callback_data = String(callbackData);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000) // 20s network timeout guard
    });

    const data = await response.json();

    if (!response.ok) {
      const errObj = data?.error || {};
      const errorMsg = errObj.message || `WhatsApp API error (${response.status})`;
      const errorCode = String(errObj.code || response.status);

      // Check if temporary/retryable (rate limits or 5xx)
      const isRateLimit = response.status === 429 || errObj.code === 130429 || errObj.code === 131056;
      const isServerDown = response.status >= 500 && response.status <= 504;
      const isRetryable = isRateLimit || isServerDown;

      // Extract Retry-After if provided by Meta headers or error_data
      let retryAfterMs = null;
      const retryHeader = response.headers.get('retry-after');
      if (retryHeader) {
        const sec = parseInt(retryHeader, 10);
        if (!isNaN(sec) && sec > 0) retryAfterMs = sec * 1000;
      }
      if (!retryAfterMs && errObj?.error_data?.retry_after) {
        const sec = parseInt(errObj.error_data.retry_after, 10);
        if (!isNaN(sec) && sec > 0) retryAfterMs = sec * 1000;
      }

      console.error(`[WHATSAPP TEMPLATE API ERROR]: ${errorCode} - ${errorMsg}`);

      return {
        success: false,
        status: 'failed',
        provider: 'whatsapp_cloud_api',
        errorCode,
        errorMessage: errorMsg,
        isRetryable,
        retryAfterMs
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
    console.error('[WHATSAPP TEMPLATE API EXCEPTION]:', err.message);
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      success: false,
      status: 'failed',
      provider: 'whatsapp_cloud_api',
      errorCode: isTimeout ? 'NETWORK_TIMEOUT' : 'NETWORK_EXCEPTION',
      errorMessage: isTimeout ? 'Network timeout after 20s waiting for Meta WhatsApp Cloud API response.' : (err.message || 'Network exception connecting to Meta WhatsApp Cloud API'),
      isRetryable: true // Network errors are retryable with exponential backoff
    };
  }
};

/**
 * Standard 1-to-1 Cloud message (Text format).
 * Preserved for backwards compatibility with direct customer follow-ups.
 */
export const sendWhatsAppCloudMessage = async (recipientPhone, textMessage, shopId = null) => {
  let accessToken = '';
  let phoneNumberId = '';
  const apiVersion = process.env.META_API_VERSION || 'v19.0';

  if (shopId) {
    const creds = await getShopWhatsAppCredentials(shopId);
    if (creds.connected) {
      accessToken = creds.accessToken;
      phoneNumberId = creds.phoneNumberId;
    }
  }

  // Fall back to global env variables if no shop-specific connection found
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
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
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

export const whatsappService = {
  getWhatsAppConfig,
  sanitizePhoneNumber,
  normalizePhone,
  getShopWhatsAppCredentials,
  STANDARD_WHATSAPP_TEMPLATES,
  getAvailableTemplates,
  buildTemplateComponents,
  renderTemplatePreviewText,
  sendWhatsAppCloudMessage,
  sendWhatsAppTemplateMessage
};

export default whatsappService;
