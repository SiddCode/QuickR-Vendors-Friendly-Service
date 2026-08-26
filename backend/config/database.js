import mongoose from 'mongoose';

export const connectDB = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI;

  if (isProduction && (!mongoUri || !mongoUri.trim())) {
    console.error('❌ CRITICAL ERROR: MONGODB_URI environment variable is missing in production mode.');
    throw new Error('FATAL: MONGODB_URI must be explicitly configured in production (NODE_ENV=production).');
  }

  const targetUri = mongoUri?.trim() || 'mongodb://127.0.0.1:27017/quickr';

  try {
    const conn = await mongoose.connect(targetUri);
    console.log(`🚀 Connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    if (isProduction) {
      process.exit(1);
    }
  }
};
