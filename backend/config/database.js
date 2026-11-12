import mongoose from 'mongoose';
import { sanitizeMongoErrorText } from '../utils/mongoSafety.js';

export const connectDB = async ({ mongooseLib = mongoose, logger = console } = {}) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI;

  if (isProduction && (!mongoUri || !mongoUri.trim())) {
    logger.error('❌ CRITICAL ERROR: MONGODB_URI environment variable is missing in production mode.');
    throw new Error('FATAL: MONGODB_URI must be explicitly configured in production (NODE_ENV=production).');
  }

  const targetUri = mongoUri?.trim() || 'mongodb://127.0.0.1:27017/quickr';

  try {
    const conn = await mongooseLib.connect(targetUri, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    logger.log(`🚀 Connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    const safeMessage = sanitizeMongoErrorText(error?.message || String(error), targetUri);
    logger.error(`❌ MongoDB connection error: ${safeMessage}`);
    if (isProduction) {
      process.exit(1);
    }
    return null;
  }
};
