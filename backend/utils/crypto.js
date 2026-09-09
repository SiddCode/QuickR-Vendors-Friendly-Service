import crypto from 'crypto';

/**
 * Encryption service for securing Meta WhatsApp Access Tokens at rest in MongoDB.
 * Uses AES-256-GCM authenticated encryption.
 */
const getEncryptionKey = () => {
  const secret = process.env.META_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || 'quickr_meta_whatsapp_default_secure_encryption_key_32bytes!';
  return crypto.createHash('sha256').update(secret).digest();
};

export const encryptToken = (plainText) => {
  if (!plainText) return { encryptedData: '', iv: '', authTag: '' };
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag
  };
};

export const decryptToken = (encryptedData, ivHex, authTagHex) => {
  if (!encryptedData || !ivHex || !authTagHex) return '';
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[TOKEN DECRYPTION ERROR]: Failed to decrypt access token', err.message);
    return '';
  }
};
