import dotenv from 'dotenv';
dotenv.config();

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret || !secret.trim()) {
    if (isProduction) {
      console.error('❌ CRITICAL ERROR: JWT_SECRET environment variable is missing in production mode.');
      throw new Error('FATAL: JWT_SECRET must be explicitly configured in production (NODE_ENV=production).');
    }
    // Safe default for non-production development environments
    return 'quickr_super_secret_jwt_key_987654321_production_grade_security';
  }

  return secret.trim();
}
