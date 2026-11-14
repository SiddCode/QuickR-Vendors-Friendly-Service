import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { connectDB } from './config/database.js';
import { requireAuth, requireNonStaff } from './middleware/auth.js';
import { calculatePriorityAndReason } from './services/priorityService.js';
import { sendWhatsAppCloudMessage } from './services/whatsapp.js';
import { normalizeIndianMobileNumber } from './utils/phone.js';
import { generateUniqueBarcode } from './utils/barcode.js';
import { getISTDayBounds, calculateScheduledDateIST } from './utils/date.js';
import {
  allocateNextInvoiceNumber,
  ensureInvoiceCounterInitialized
} from './services/invoiceCounterService.js';
import {
  securityHeadersMiddleware,
  compressionMiddleware,
  createRateLimiter,
  sanitizeSpreadsheetCell,
  asSafeString
} from './utils/security.js';
import { adminRouter } from './routes/admin.js';

import { aiRouter } from './routes/ai.js';
import { whatsappRouter } from './routes/whatsapp.js';
import { privacyRouter } from './routes/privacy.js';
import { campaignRouter } from './routes/campaigns.js';
import { reengagementRouter } from './routes/reengagement.js';
import { storageRouter } from './routes/storage.js';
import { seedAdmin } from './scripts/seedAdmin.js';

import { User } from './models/User.js';
import { Shop } from './models/Shop.js';
import { Customer } from './models/Customer.js';
import { Product } from './models/Product.js';
import { Enquiry } from './models/Enquiry.js';
import { FollowUp } from './models/FollowUp.js';
import { Message } from './models/Message.js';
import { Sale } from './models/Sale.js';
import { Activity } from './models/Activity.js';
import { SubscriptionRequest } from './models/SubscriptionRequest.js';
import { OtpVerification } from './models/OtpVerification.js';
import { PrivacyAuditLog } from './models/PrivacyAuditLog.js';
import { ConsentRecord } from './models/ConsentRecord.js';

import { getJwtSecret } from './config/jwt.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 53211;
const JWT_SECRET = getJwtSecret();

// Helper to normalize origins (remove trailing slashes)
const normalizeOrigin = (o) => (o ? String(o).trim().replace(/\/+$/, '') : '');

const rawFrontendUrl = process.env.FRONTEND_URL || '';
const customFrontendOrigins = rawFrontendUrl
  .split(',')
  .map(o => normalizeOrigin(o))
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://quickr-vendors-friendly-mac.onrender.com',
  'https://quickr-vendors-friendly-service.onrender.com',
  ...customFrontendOrigins
].map(o => normalizeOrigin(o)).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = normalizeOrigin(origin);

    // Check exact match in allowedOrigins
    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    // Check if origin ends with .vercel.app (for preview/production Vercel deployments unless CORS_STRICT=true)
    if (process.env.CORS_STRICT !== 'true' && cleanOrigin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    console.warn(`[CORS Policy Warning] Rejected origin: ${origin} (Normalized: ${cleanOrigin})`);
    return callback(new Error('Not allowed by CORS origin policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-media-type', 'x-file-name'],
  optionsSuccessStatus: 204
}));

app.use(securityHeadersMiddleware);
app.use(compressionMiddleware);

app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cookieParser());

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  message: 'Too many authentication attempts. Please wait a few minutes and try again.'
});

const IS_TEST_IMPORT = process.env.QUICKR_TEST_IMPORT === 'true';
const dbReadyPromise = IS_TEST_IMPORT ? Promise.resolve(null) : connectDB();

// Dev seed helper for testing & Phase 4 realistic clothing shop data (non-production only)
const seedDatabaseIfNeeded = async () => {
  if (process.env.NODE_ENV === 'production') return;
  try {
    await dbReadyPromise;
    if (mongoose.connection.readyState !== 1) return;
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('🌱 Seeding Phase 4 realistic clothing-shop demo dataset...');
      
      await Shop.create({ 
        customId: 'demo-shop', 
        name: 'QuickR Fashion Hub', 
        phone: '+91 98765 43210', 
        address: 'T. Nagar, Chennai, Tamil Nadu' 
      });

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('admin123', salt);

      await User.create({
        id: 'USER-100',
        name: 'Admin User',
        email: 'admin@quickr.com',
        passwordHash,
        shopId: 'demo-shop',
        role: 'owner'
      });

      // 10+ Diverse Clothing Customers
      const seedCustomers = [
        { id: 'CUST-000124', name: 'Rahul', phone: '+91 98765 43210', email: 'rahul@gmail.com', location: 'Chennai, Tamil Nadu', preferences: { interestedIn: 'Shirts', preferredSize: 'XL', preferredColors: ['Black', 'Navy'], lastPurchase: '12 days ago' }, status: 'Active', totalPurchases: 1, totalSpending: 1399, conversionRate: 33, shopId: 'demo-shop' },
        { id: 'CUST-000125', name: 'Priya R.', phone: '+91 91234 56780', email: 'priya.r@gmail.com', location: 'Mumbai, Maharashtra', preferences: { interestedIn: 'Sarees & Kurtis', preferredSize: 'L', preferredColors: ['Pink', 'Gold'], lastPurchase: '30 days ago' }, status: 'Active', totalPurchases: 2, totalSpending: 4500, conversionRate: 66, shopId: 'demo-shop' },
        { id: 'CUST-000126', name: 'Karthik A.', phone: '+91 99887 76655', email: 'karthik.a@gmail.com', location: 'Bangalore, Karnataka', preferences: { interestedIn: 'Jeans & T-Shirts', preferredSize: 'M', preferredColors: ['Blue', 'Grey'], lastPurchase: '5 days ago' }, status: 'Active', totalPurchases: 1, totalSpending: 2199, conversionRate: 50, shopId: 'demo-shop' },
        { id: 'CUST-000127', name: 'Suresh V.', phone: '+91 90123 45678', email: 'suresh.v@gmail.com', location: 'Hyderabad, Telangana', preferences: { interestedIn: 'Formal Trousers', preferredSize: '34', preferredColors: ['Black', 'Dark Grey'], lastPurchase: '20 days ago' }, status: 'Active', totalPurchases: 0, totalSpending: 0, conversionRate: 0, shopId: 'demo-shop' },
        { id: 'CUST-000128', name: 'Meena K.', phone: '+91 90909 09090', email: 'meena.k@gmail.com', location: 'Delhi, NCR', preferences: { interestedIn: 'Dresses', preferredSize: 'M', preferredColors: ['Red', 'Black'], lastPurchase: '45 days ago' }, status: 'Active', totalPurchases: 0, totalSpending: 0, conversionRate: 0, shopId: 'demo-shop' },
        { id: 'CUST-000129', name: 'Ramesh A.', phone: '+91 98765 11111', email: 'ramesh.a@gmail.com', location: 'Kolkata, West Bengal', preferences: { interestedIn: 'Shirts', preferredSize: 'XL', preferredColors: ['Blue'], lastPurchase: '18 days ago' }, status: 'Active', totalPurchases: 0, totalSpending: 0, conversionRate: 0, shopId: 'demo-shop' },
        { id: 'CUST-000130', name: 'Anitha S.', phone: '+91 98400 22334', email: 'anitha.s@gmail.com', location: 'Coimbatore, Tamil Nadu', preferences: { interestedIn: 'Kids Wear', preferredSize: '4-5Y', preferredColors: ['Yellow', 'Bright Blue'], lastPurchase: '8 days ago' }, status: 'Active', totalPurchases: 1, totalSpending: 1299, conversionRate: 50, shopId: 'demo-shop' },
        { id: 'CUST-000131', name: 'Vikram Seth', phone: '+91 97111 88990', email: 'vikram@gmail.com', location: 'Jaipur, Rajasthan', preferences: { interestedIn: 'Ethnic Jackets', preferredSize: 'L', preferredColors: ['Maroon', 'Beige'], lastPurchase: '2 days ago' }, status: 'Active', totalPurchases: 3, totalSpending: 8900, conversionRate: 75, shopId: 'demo-shop' },
        { id: 'CUST-000132', name: 'Deepika M.', phone: '+91 96500 44556', email: 'deepika.m@gmail.com', location: 'Pune, Maharashtra', preferences: { interestedIn: 'Designer Sarees', preferredSize: 'Free Size', preferredColors: ['Green', 'Gold'], lastPurchase: '60 days ago' }, status: 'Active', totalPurchases: 0, totalSpending: 0, conversionRate: 0, shopId: 'demo-shop' },
        { id: 'CUST-000133', name: 'Arun Kumar', phone: '+91 99444 55667', email: 'arun.k@gmail.com', location: 'Chennai, Tamil Nadu', preferences: { interestedIn: 'Denim Jeans', preferredSize: '32', preferredColors: ['Dark Blue'], lastPurchase: '14 days ago' }, status: 'Active', totalPurchases: 1, totalSpending: 1999, conversionRate: 50, shopId: 'demo-shop' }
      ];
      await Customer.insertMany(seedCustomers);

      // 15+ Products across categories (Shirts, Jeans, T-Shirts, Dresses, Sarees, Kids Wear)
      const seedProducts = [
        { id: 'PROD-1', name: 'Black Casual Shirt', category: 'Shirts', sellingPrice: 1499, sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: ['Black'], availability: 12, shopId: 'demo-shop' },
        { id: 'PROD-2', name: 'White Linen Shirt', category: 'Shirts', sellingPrice: 1299, sizes: ['S', 'M', 'L', 'XL'], colors: ['White'], availability: 20, shopId: 'demo-shop' },
        { id: 'PROD-3', name: 'Slim Fit Denim Jeans', category: 'Jeans', sellingPrice: 1999, sizes: ['30', '32', '34', '36'], colors: ['Dark Blue', 'Black'], availability: 15, shopId: 'demo-shop' },
        { id: 'PROD-4', name: 'Cotton Graphic T-Shirt', category: 'T-Shirts', sellingPrice: 799, sizes: ['S', 'M', 'L', 'XL'], colors: ['Black', 'White', 'Olive'], availability: 30, shopId: 'demo-shop' },
        { id: 'PROD-5', name: 'Silk Cotton Saree', category: 'Sarees', sellingPrice: 3499, sizes: ['Free Size'], colors: ['Red', 'Royal Blue', 'Gold'], availability: 8, shopId: 'demo-shop' },
        { id: 'PROD-6', name: 'Printed Anarkali Kurti', category: 'Kurtis', sellingPrice: 1899, sizes: ['S', 'M', 'L', 'XL'], colors: ['Yellow', 'Pink'], availability: 10, shopId: 'demo-shop' },
        { id: 'PROD-7', name: 'Kids Party Wear Set', category: 'Kids Wear', sellingPrice: 1299, sizes: ['2-3Y', '4-5Y', '6-7Y'], colors: ['Bright Blue', 'Red'], availability: 14, shopId: 'demo-shop' },
        { id: 'PROD-8', name: 'Floral Summer Dress', category: 'Dresses', sellingPrice: 2299, sizes: ['S', 'M', 'L'], colors: ['Yellow', 'Mint Green'], availability: 6, shopId: 'demo-shop' },
        { id: 'PROD-9', name: 'Nehru Bandhgala Jacket', category: 'Jackets', sellingPrice: 2999, sizes: ['M', 'L', 'XL'], colors: ['Maroon', 'Black', 'Beige'], availability: 7, shopId: 'demo-shop' },
        { id: 'PROD-10', name: 'Formal Chino Trousers', category: 'Trousers', sellingPrice: 1599, sizes: ['30', '32', '34', '36'], colors: ['Navy', 'Khaki', 'Grey'], availability: 18, shopId: 'demo-shop' }
      ];
      await Product.insertMany(seedProducts);

      // 15+ Enquiries
      const seedEnquiries = [
        { id: 'ENQ-101', customerId: 'CUST-000124', productId: 'PROD-1', size: 'XL', color: 'Black', quantity: 1, interest: 'Very Interested', purchaseStatus: "Didn't Purchase", notes: 'Customer asked about XL availability.', shopId: 'demo-shop' },
        { id: 'ENQ-102', customerId: 'CUST-000125', productId: 'PROD-5', size: 'Free Size', color: 'Gold', quantity: 1, interest: 'Very Interested', purchaseStatus: "Didn't Purchase", notes: 'Looking for festival saree.', shopId: 'demo-shop' },
        { id: 'ENQ-103', customerId: 'CUST-000126', productId: 'PROD-3', size: '32', color: 'Dark Blue', quantity: 1, interest: 'Interested', purchaseStatus: "Didn't Purchase", notes: 'Checking stretch comfort.', shopId: 'demo-shop' },
        { id: 'ENQ-104', customerId: 'CUST-000127', productId: 'PROD-10', size: '34', color: 'Navy', quantity: 1, interest: 'Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-105', customerId: 'CUST-000128', productId: 'PROD-8', size: 'M', color: 'Yellow', quantity: 1, interest: 'Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-106', customerId: 'CUST-000129', productId: 'PROD-1', size: 'XL', color: 'Black', quantity: 1, interest: 'Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-107', customerId: 'CUST-000130', productId: 'PROD-7', size: '4-5Y', color: 'Bright Blue', quantity: 1, interest: 'Very Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-108', customerId: 'CUST-000131', productId: 'PROD-9', size: 'L', color: 'Maroon', quantity: 1, interest: 'Very Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-109', customerId: 'CUST-000132', productId: 'PROD-5', size: 'Free Size', color: 'Red', quantity: 1, interest: 'Just Enquiring', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' },
        { id: 'ENQ-110', customerId: 'CUST-000133', productId: 'PROD-3', size: '32', color: 'Dark Blue', quantity: 1, interest: 'Interested', purchaseStatus: "Didn't Purchase", shopId: 'demo-shop' }
      ];
      await Enquiry.insertMany(seedEnquiries);

      // Follow-ups with Overdue, Due Today, and Scheduled states
      const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const today = new Date();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const seedFollowUps = [
        { id: 'FW-101', customerId: 'CUST-000124', enquiryId: 'ENQ-101', reason: 'Rahul showed interest in Black Casual Shirt (XL) 2 days ago.', scheduledAt: yesterday, status: 'ready', message: 'Hi Rahul,\n\nYour size XL Black Casual Shirt is available! Shall we reserve it for you?\n\n— QuickR Fashion Hub', priority: 'High', shopId: 'demo-shop' },
        { id: 'FW-102', customerId: 'CUST-000125', enquiryId: 'ENQ-102', reason: 'Priya requested Gold Silk Saree follow-up 3 days ago.', scheduledAt: threeDaysAgo, status: 'ready', message: 'Hi Priya,\n\nThe Gold Silk Saree you liked is in high demand! Would you like us to hold it?\n\n— QuickR Fashion Hub', priority: 'High', shopId: 'demo-shop' },
        { id: 'FW-103', customerId: 'CUST-000126', enquiryId: 'ENQ-103', reason: 'Karthik enquired about Slim Fit Jeans (size 32).', scheduledAt: today, status: 'ready', message: 'Hi Karthik,\n\nWe have your size 32 Slim Fit Denim Jeans ready.\n\n— QuickR Fashion Hub', priority: 'High', shopId: 'demo-shop' },
        { id: 'FW-104', customerId: 'CUST-000127', enquiryId: 'ENQ-104', reason: 'Formal Chino Trousers enquiry follow-up.', scheduledAt: today, status: 'ready', message: 'Hi Suresh,\n\nRegarding the Navy Formal Chinos you asked about...\n\n— QuickR Fashion Hub', priority: 'Medium', shopId: 'demo-shop' },
        { id: 'FW-105', customerId: 'CUST-000128', enquiryId: 'ENQ-105', reason: 'Floral Summer Dress enquiry.', scheduledAt: today, status: 'ready', message: 'Hi Meena,\n\nYellow Summer Dress is fast selling out!\n\n— QuickR Fashion Hub', priority: 'Medium', shopId: 'demo-shop' },
        { id: 'FW-106', customerId: 'CUST-000130', enquiryId: 'ENQ-107', reason: 'Anitha enquired for Kids Party Wear Set.', scheduledAt: today, status: 'ready', message: 'Hi Anitha,\n\nKids Party Wear Set (4-5Y) is ready for pickup.\n\n— QuickR Fashion Hub', priority: 'High', shopId: 'demo-shop' },
        { id: 'FW-107', customerId: 'CUST-000131', enquiryId: 'ENQ-108', reason: 'Vikram requested Nehru Bandhgala Jacket.', scheduledAt: today, status: 'ready', message: 'Hi Vikram,\n\nMaroon Bandhgala Jacket in L is available for you.\n\n— QuickR Fashion Hub', priority: 'High', shopId: 'demo-shop' },
        { id: 'FW-108', customerId: 'CUST-000133', enquiryId: 'ENQ-110', reason: 'Scheduled follow-up for tomorrow.', scheduledAt: tomorrow, status: 'scheduled', message: 'Hi Arun,\n\nFollow-up regarding Denim Jeans.\n\n— QuickR Fashion Hub', priority: 'Low', shopId: 'demo-shop' }
      ];
      await FollowUp.insertMany(seedFollowUps);

      const seedSales = [
        { id: 'SALE-1', invoiceNumber: 'INV-000001', customerId: 'CUST-000124', customerName: 'Rahul', enquiryId: 'ENQ-101', items: [{ productId: 'PROD-1', productName: 'Black Casual Shirt', quantity: 1, rate: 1499, total: 1499 }], subtotal: 1499, totalAmount: 1399, paymentMethod: 'Cash', source: 'quickr_followup', shopId: 'demo-shop' },
        { id: 'SALE-2', invoiceNumber: 'INV-000002', customerId: 'CUST-000125', customerName: 'Priya R.', enquiryId: 'ENQ-102', items: [{ productId: 'PROD-5', productName: 'Silk Cotton Saree', quantity: 1, rate: 3499, total: 3499 }], subtotal: 3499, totalAmount: 3499, paymentMethod: 'UPI', source: 'quickr_followup', shopId: 'demo-shop' },
        { id: 'SALE-3', invoiceNumber: 'INV-000003', customerId: 'CUST-000131', customerName: 'Vikram Seth', enquiryId: 'ENQ-108', items: [{ productId: 'PROD-9', productName: 'Nehru Bandhgala Jacket', quantity: 1, rate: 2999, total: 2999 }], subtotal: 2999, totalAmount: 2999, paymentMethod: 'Card', source: 'quickr_followup', shopId: 'demo-shop' }
      ];
      await Sale.insertMany(seedSales);

      await Activity.create({ id: 'ACT-1', customerId: 'CUST-000124', type: 'enquiry_created', description: 'Enquiry added for Black Casual Shirt (XL)', shopId: 'demo-shop' });

      console.log('✅ Phase 4 realistic dataset seeded successfully!');
    }
  } catch (err) {
    console.error('Seed error:', err.message);
  }
};

if (!IS_TEST_IMPORT) {
  dbReadyPromise.then(async () => {
    if (mongoose.connection.readyState === 1) {
      await seedDatabaseIfNeeded();
      await seedAdmin();
    }
  }).catch(() => {});
}

// ===================================
// LIGHTWEIGHT HEALTH CHECK & COLD-START MITIGATION
// ===================================
app.get('/api/health', (req, res) => {
  const startTime = Date.now();
  const dbStateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbState = dbStateMap[mongoose.connection.readyState] || 'unknown';

  const duration = Date.now() - startTime;
  if (duration > 50) {
    console.log(`[PERF] GET /api/health: ${duration}ms (DB: ${dbState})`);
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbState,
    mongoConnected: mongoose.connection.readyState === 1
  });
});


const setAuthCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

app.post('/api/subscription-requests', authRateLimiter, async (req, res) => {
  try {
    const { name, shopName, phone, email, requestedPlan, message, password, otpVerificationToken } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Your name is required.' });
    }
    if (typeof shopName !== 'string' || !shopName.trim()) {
      return res.status(400).json({ success: false, error: 'Shop name is required.' });
    }

    const normalizedPhone = normalizeIndianMobileNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Enter a valid 10-digit Indian mobile number.' });
    }

    const cleanEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must contain at least 6 characters.' });
    }

    // Input length protection
    if (name.length > 100 || shopName.length > 100 || cleanEmail.length > 100) {
      return res.status(400).json({ success: false, error: 'Input fields exceed maximum allowed character length.' });
    }

    // Check for duplicate pending requests
    const existingPending = await SubscriptionRequest.findOne({
      $or: [{ phone: normalizedPhone }, { email: cleanEmail }],
      status: 'pending'
    }).select('_id').lean();

    if (existingPending) {
      return res.status(400).json({
        success: false,
        error: 'A subscription request for this mobile number or email is already pending review. Our team will contact you shortly.'
      });
    }

    // Check whether OTP verification token was actually presented and verified
    let isOtpVerified = false;
    if (typeof otpVerificationToken === 'string' && otpVerificationToken.trim()) {
      try {
        const verifiedPayload = jwt.verify(otpVerificationToken.trim(), JWT_SECRET, { algorithms: ['HS256'] });
        if (verifiedPayload?.verified && verifiedPayload.phone === normalizedPhone) {
          isOtpVerified = true;
        }
      } catch {
        isOtpVerified = false;
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newRequest = new SubscriptionRequest({
      id: `SUBREQ-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      name: name.trim(),
      shopName: shopName.trim(),
      phone: normalizedPhone,
      email: cleanEmail,
      requestedPlan: requestedPlan ? String(requestedPlan).trim() : 'Standard',
      message: message ? String(message).trim().substring(0, 500) : '',
      otpVerified: isOtpVerified,
      passwordHash,
      status: 'pending'
    });

    await newRequest.save();

    res.status(201).json({
      success: true,
      message: 'Your QuickR access request has been submitted. Our team will review your request. Once approved, you can sign in using the email and password you created.'
    });
  } catch (err) {
    console.error('Subscription request submission error:', err);
    res.status(500).json({ success: false, error: 'Unable to submit request. Please try again.' });
  }
});

// ===================================
// OTP VERIFICATION ENDPOINTS (FIRST-TIME CREATION)
// ===================================

app.post('/api/auth/send-otp', authRateLimiter, async (req, res) => {
  try {
    const { phone, purpose = 'shop_creation' } = req.body || {};
    const validPurposes = ['shop_creation', 'password_reset'];
    if (typeof purpose !== 'string' || !validPurposes.includes(purpose)) {
      return res.status(400).json({ success: false, error: 'Invalid OTP purpose.' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Mobile number is required.' });
    }

    const normalizedPhone = normalizeIndianMobileNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Enter a valid 10-digit Indian mobile number.' });
    }

    // Check SMS provider BEFORE writing/consuming rate-limit slots
    const smsProvider = process.env.OTP_PROVIDER;
    if (!smsProvider || smsProvider.toLowerCase() === 'mock') {
      return res.status(503).json({
        success: false,
        error: 'OTP service is currently unavailable. Please try again later.'
      });
    }

    // Rate Limiting: Max 3 OTP requests within 10 minutes for a phone number
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentOtpCount = await OtpVerification.countDocuments({
      phone: normalizedPhone,
      createdAt: { $gte: tenMinsAgo }
    });

    if (recentOtpCount >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many OTP requests for this phone number. Please wait 10 minutes before requesting again.'
      });
    }

    // Invalidate old active unverified OTPs for the same phone & purpose
    await OtpVerification.updateMany(
      { phone: normalizedPhone, purpose, verified: false },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    // Generate cryptographically secure 6-digit OTP
    const rawOtp = String(crypto.randomInt(100000, 1000000));
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(rawOtp, salt);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    const otpDoc = new OtpVerification({
      id: `OTP-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      phone: normalizedPhone,
      otpHash,
      purpose,
      verified: false,
      attempts: 0,
      lastRequestedAt: new Date(),
      expiresAt
    });

    await otpDoc.save();

    // Real SMS Delivery logic goes here when provider is configured...
    const responsePayload = {
      success: true,
      message: `OTP sent successfully to ${normalizedPhone}.`,
      expiresInSeconds: 600
    };

    res.json(responsePayload);
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to send OTP. Please try again.' });
  }
});

app.post('/api/auth/verify-otp', authRateLimiter, async (req, res) => {
  try {
    const { phone, otp, purpose = 'shop_creation' } = req.body || {};
    const validPurposes = ['shop_creation', 'password_reset'];
    if (typeof purpose !== 'string' || !validPurposes.includes(purpose)) {
      return res.status(400).json({ success: false, error: 'Invalid OTP purpose.' });
    }
    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: 'Mobile number and 6-digit OTP are required.' });
    }

    const normalizedPhone = normalizeIndianMobileNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Enter a valid 10-digit Indian mobile number.' });
    }

    const cleanOtp = String(otp).trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ success: false, error: 'OTP must be a 6-digit numeric code.' });
    }

    // Find latest active OTP record for phone & purpose and atomically increment attempt counter first
    const otpRecord = await OtpVerification.findOneAndUpdate(
      {
        phone: normalizedPhone,
        purpose,
        verified: false,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: 3 }
      },
      { $inc: { attempts: 1 } },
      { sort: { createdAt: -1 }, new: true }
    );

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired, exceeded attempts, or is invalid. Please request a new OTP.'
      });
    }

    const isMatch = await bcrypt.compare(cleanOtp, otpRecord.otpHash);
    if (!isMatch) {
      const remaining = Math.max(0, 3 - otpRecord.attempts);
      return res.status(400).json({
        success: false,
        error: `Incorrect OTP. ${remaining} attempt(s) remaining.`
      });
    }

    // Mark verified & burn OTP atomically
    await OtpVerification.updateOne({ _id: otpRecord._id, verified: false }, { $set: { verified: true } });

    // Issue short-lived verification token for shop creation
    const otpVerificationToken = jwt.sign(
      { phone: normalizedPhone, verified: true, purpose },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      message: 'Mobile number verified successfully.',
      otpVerificationToken
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify OTP. Please try again.' });
  }
});

app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  // Public direct registration is disabled; require admin approval via subscription requests
  const allowReg = process.env.ALLOW_PUBLIC_REGISTRATION;
  if (!allowReg || allowReg === 'false') {
    return res.status(403).json({ error: 'Direct public shop registration is disabled. Please request QuickR access for admin approval.' });
  }

  let createdShop = null;
  let createdUser = null;

  try {
    const { ownerName, shopName, email, password } = req.body || {};

    if (typeof ownerName !== 'string' || typeof shopName !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !ownerName.trim() || !shopName.trim() || !email.trim()) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail }).select('_id').lean();
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    const suffix = crypto.randomBytes(2).toString('hex');
    const shopCustomId = `SHOP-${Date.now()}-${suffix}`;
    const userCustomId = `USER-${Date.now()}-${suffix}`;

    createdShop = new Shop({
      customId: shopCustomId,
      name: shopName.trim(),
      phone: '',
      address: ''
    });
    await createdShop.save();

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    createdUser = new User({
      id: userCustomId,
      name: ownerName.trim(),
      email: normalizedEmail,
      passwordHash,
      shopId: shopCustomId,
      role: 'owner'
    });
    await createdUser.save();

    const token = jwt.sign(
      { id: createdUser.id, shopId: createdShop.customId, role: 'owner' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    return res.status(201).json({
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        shopId: createdShop.customId,
        role: createdUser.role,
        shopName: createdShop.name
      },
      token
    });
  } catch (err) {
    if (createdUser && createdUser._id) await User.deleteOne({ _id: createdUser._id }).catch(() => {});
    if (createdShop && createdShop._id) await Shop.deleteOne({ _id: createdShop._id }).catch(() => {});
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash').lean();
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if user account is disabled
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact the QuickR administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      // Non-blocking audit log of failed login
      const ipAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();
      const userAgent = req.headers['user-agent'] || 'QuickR-Client';
      PrivacyAuditLog.create({
        id: `PAL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        userId: user.id,
        shopId: user.shopId || (user.role === 'admin' ? 'ADMIN' : 'SYSTEM'),
        action: 'LOGIN_FAILED',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress,
        userAgent,
        metadata: { email: user.email, reason: 'Invalid password' }
      }).catch(() => {});

      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // For non-admin users, check if their shop is disabled or suspended
    let shop = null;
    if (user.shopId) {
      shop = await Shop.findOne({ customId: user.shopId }).select('name status subscriptionStatus').lean();
      if (user.role !== 'admin' && shop && (shop.status === 'disabled' || shop.subscriptionStatus === 'suspended')) {
        return res.status(403).json({ error: 'Your shop account is currently disabled. Please contact the QuickR administrator.' });
      }
    }

    const token = jwt.sign(
      { id: user.id, shopId: user.shopId || null, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    // Non-blocking audit log of successful login
    const ipAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'QuickR-Client';
    PrivacyAuditLog.create({
      id: `PAL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: user.id,
      shopId: user.shopId || (user.role === 'admin' ? 'ADMIN' : 'SYSTEM'),
      action: 'LOGIN',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { role: user.role }
    }).catch(() => {});

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        shopId: user.shopId || null,
        role: user.role,
        shopName: shop?.name || (user.role === 'admin' ? 'QuickR Admin' : 'Shop Name')
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    let shopName = 'Shop Name';
    if (req.user.role === 'admin') {
      shopName = 'QuickR Admin';
    } else if (req.user.shopId) {
      const shop = await Shop.findOne({ customId: req.user.shopId }).select('name').lean();
      shopName = shop?.name || 'Shop Name';
    }
    return res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        shopId: req.user.shopId || null,
        role: req.user.role,
        shopName
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user session' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction
  });
  return res.json({ success: true, message: 'Logged out successfully' });
});

// Router mounts
app.use('/api/storage', storageRouter);

// ===================================
// SHOP PROFILE ENDPOINTS (AUTHENTICATED)
// ===================================

// ===================================
// GST CALCULATION UTILITY & ENDPOINTS
// ===================================

const INDIAN_STATES = [
  { code: '33', name: 'Tamil Nadu' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '19', name: 'West Bengal' },
  { code: '24', name: 'Gujarat' },
  { code: '08', name: 'Rajasthan' },
  { code: '03', name: 'Punjab' },
  { code: '06', name: 'Haryana' },
  { code: '10', name: 'Bihar' },
  { code: '23', name: 'Madhya Pradesh' }
];

function getStateCodeFromName(stateName) {
  if (!stateName) return '33'; // Default to Tamil Nadu
  const clean = String(stateName).trim().toLowerCase();
  const match = INDIAN_STATES.find(s => s.name.toLowerCase() === clean);
  return match ? match.code : '33';
}

function calculateGST({
  amount = 0,
  gstRate = 0,
  priceIncludesGst = false,
  isInterState = false,
  enabled = true
}) {
  const numAmount = Math.max(0, Number(amount) || 0);
  const numRate = Math.max(0, Number(gstRate) || 0);

  if (!enabled || numRate <= 0 || numAmount <= 0) {
    return {
      taxableAmount: Math.round(numAmount * 100) / 100,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      taxType: 'NONE'
    };
  }

  let taxableAmount = 0;
  let totalTax = 0;

  if (priceIncludesGst) {
    taxableAmount = numAmount / (1 + numRate / 100);
    totalTax = numAmount - taxableAmount;
  } else {
    taxableAmount = numAmount;
    totalTax = (taxableAmount * numRate) / 100;
  }

  taxableAmount = Math.round(taxableAmount * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;

  if (isInterState) {
    return {
      taxableAmount,
      cgst: 0,
      sgst: 0,
      igst: totalTax,
      totalTax,
      taxType: 'IGST'
    };
  } else {
    const cgst = Math.round((totalTax / 2) * 100) / 100;
    const sgst = Math.round((totalTax - cgst) * 100) / 100;
    return {
      taxableAmount,
      cgst,
      sgst,
      igst: 0,
      totalTax,
      taxType: 'CGST_SGST'
    };
  }
}

// GET /api/shop/gst
app.get('/api/shop/gst', requireAuth, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'User does not belong to a shop account.' });
    }
    const shop = await Shop.findOne({ customId: req.user.shopId }).lean();
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }
    
    const isRegistered = !!(shop.gst?.registered ?? shop.isGstRegistered);
    const gstinVal = shop.gst?.gstin || shop.gstin || '';
    const legalNameVal = shop.gst?.legalName || shop.name || '';
    const addressVal = shop.gst?.address || shop.address || '';
    const stateVal = shop.gst?.state || 'Tamil Nadu';
    const stateCodeVal = shop.gst?.stateCode || getStateCodeFromName(stateVal);
    const defaultRateVal = shop.gst?.defaultRate || 0;

    res.json({
      registered: isRegistered,
      gstin: gstinVal,
      legalName: legalNameVal,
      address: addressVal,
      state: stateVal,
      stateCode: stateCodeVal,
      defaultRate: defaultRateVal
    });
  } catch (err) {
    console.error('Fetch shop GST error:', err);
    res.status(500).json({ error: 'Failed to fetch shop GST settings.' });
  }
});

// PUT /api/shop/gst
app.put('/api/shop/gst', requireAuth, requireNonStaff, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'User does not belong to a shop account.' });
    }

    const { registered, gstin, legalName, address, state, stateCode, defaultRate } = req.body || {};
    const isRegistered = registered === true || registered === 'true';

    let cleanGstin = '';
    if (isRegistered) {
      const rawGstin = gstin ? String(gstin).trim().toUpperCase() : '';
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
      if (!rawGstin || !gstinRegex.test(rawGstin)) {
        return res.status(400).json({ error: 'Valid 15-character GSTIN is required when GST is enabled (e.g. 33AAAAA0000A1Z5).' });
      }
      cleanGstin = rawGstin;
    }

    const cleanState = state ? String(state).trim() : 'Tamil Nadu';
    const cleanStateCode = stateCode ? String(stateCode).trim() : (cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : getStateCodeFromName(cleanState));
    const validRates = [0, 5, 12, 18, 28];
    const cleanDefaultRate = validRates.includes(Number(defaultRate)) ? Number(defaultRate) : 0;

    const shop = await Shop.findOne({ customId: req.user.shopId });
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }

    shop.isGstRegistered = isRegistered;
    shop.gstin = cleanGstin;
    shop.gst = {
      registered: isRegistered,
      gstin: cleanGstin,
      legalName: legalName ? String(legalName).trim() : shop.name,
      address: address ? String(address).trim() : shop.address,
      state: cleanState,
      stateCode: cleanStateCode,
      defaultRate: cleanDefaultRate
    };

    await shop.save();

    res.json({
      success: true,
      message: 'GST settings updated successfully.',
      gst: shop.gst
    });
  } catch (err) {
    console.error('Update shop GST error:', err);
    res.status(500).json({ error: 'Failed to update shop GST settings.' });
  }
});

app.get('/api/shop/profile', requireAuth, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'User does not belong to a shop account.' });
    }
    const shop = await Shop.findOne({ customId: req.user.shopId }).lean();
    if (!shop) {
      return res.status(404).json({ error: 'Shop profile not found.' });
    }
    res.json({
      customId: shop.customId,
      name: shop.name,
      phone: shop.phone || '',
      address: shop.address || '',
      status: shop.status || 'active',
      subscriptionStatus: shop.subscriptionStatus || 'active',
      lengthBasedBillingEnabled: !!shop.lengthBasedBillingEnabled,
      isGstRegistered: !!(shop.gst?.registered ?? shop.isGstRegistered),
      gstin: shop.gst?.gstin || shop.gstin || '',
      gst: shop.gst || {
        registered: !!shop.isGstRegistered,
        gstin: shop.gstin || '',
        legalName: shop.name,
        address: shop.address,
        state: 'Tamil Nadu',
        stateCode: '33',
        defaultRate: 0
      },
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt
    });
  } catch (err) {
    console.error('Fetch shop profile error:', err);
    res.status(500).json({ error: 'Failed to fetch shop profile.' });
  }
});

app.patch('/api/shop/profile', requireAuth, requireNonStaff, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(400).json({ error: 'User does not belong to a shop account.' });
    }

    const { name, phone, isGstRegistered, gstin, legalName, address, state, stateCode, defaultRate, lengthBasedBillingEnabled } = req.body || {};

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'Shop name cannot be empty.' });
      }
      if (cleanName.length > 100) {
        return res.status(400).json({ error: 'Shop name exceeds maximum character limit of 100.' });
      }
    }

    let normalizedPhone = undefined;
    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();
      if (!cleanPhone) {
        return res.status(400).json({ error: 'Contact phone number is required.' });
      }
      normalizedPhone = normalizeIndianMobileNumber(cleanPhone);
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.' });
      }
    }

    const shop = await Shop.findOne({ customId: req.user.shopId });
    if (!shop) {
      return res.status(404).json({ error: 'Shop profile not found.' });
    }

    let cleanGstin = undefined;
    const targetIsGst = isGstRegistered !== undefined ? (isGstRegistered === true || isGstRegistered === 'true') : !!(shop.gst?.registered ?? shop.isGstRegistered);

    if (targetIsGst) {
      const rawGstin = gstin !== undefined ? String(gstin).trim().toUpperCase() : (shop.gst?.gstin || shop.gstin);
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
      if (!rawGstin || !gstinRegex.test(rawGstin)) {
        return res.status(400).json({ error: 'Valid 15-character GSTIN format is required when GST Registered is enabled (e.g. 33AAAAA0000A1Z5).' });
      }
      cleanGstin = rawGstin;
    } else if (isGstRegistered !== undefined) {
      cleanGstin = '';
    }

    const updateDoc = {};
    if (name !== undefined) updateDoc.name = String(name).trim();
    if (normalizedPhone !== undefined) updateDoc.phone = normalizedPhone;
    if (address !== undefined) updateDoc.address = String(address).trim();
    if (isGstRegistered !== undefined) updateDoc.isGstRegistered = targetIsGst;
    if (cleanGstin !== undefined) updateDoc.gstin = cleanGstin;
    if (lengthBasedBillingEnabled !== undefined) {
      updateDoc.lengthBasedBillingEnabled = (lengthBasedBillingEnabled === true || lengthBasedBillingEnabled === 'true');
    }

    // Update nested gst object cleanly without defaulting missing state to Tamil Nadu
    const currentGst = shop.gst || {};
    const resolvedState = state !== undefined ? String(state).trim() : (currentGst.state || 'Tamil Nadu');
    const resolvedStateCode = stateCode !== undefined
      ? String(stateCode).trim()
      : (state !== undefined ? getStateCodeFromName(resolvedState) : (currentGst.stateCode || getStateCodeFromName(resolvedState)));
    const newGst = {
      registered: targetIsGst,
      gstin: cleanGstin !== undefined ? cleanGstin : (currentGst.gstin || shop.gstin || ''),
      legalName: legalName !== undefined ? String(legalName).trim() : (currentGst.legalName || (name !== undefined ? String(name).trim() : shop.name)),
      address: address !== undefined ? String(address).trim() : (currentGst.address || shop.address || ''),
      state: resolvedState,
      stateCode: resolvedStateCode,
      defaultRate: defaultRate !== undefined ? Number(defaultRate) : (currentGst.defaultRate || 0)
    };
    updateDoc.gst = newGst;

    const updatedShop = await Shop.findOneAndUpdate(
      { customId: req.user.shopId },
      { $set: updateDoc },
      { new: true }
    ).lean();

    if (!updatedShop) {
      return res.status(404).json({ error: 'Shop profile not found.' });
    }

    console.log(`[GST DEBUG] PATCH /api/shop/profile saved for ${updatedShop.customId}: isGstRegistered=${updatedShop.isGstRegistered}, gstin=${updatedShop.gstin}`);

    res.json({
      success: true,
      message: 'Shop profile updated successfully.',
      shop: {
        customId: updatedShop.customId,
        name: updatedShop.name,
        phone: updatedShop.phone,
        address: updatedShop.address,
        status: updatedShop.status,
        subscriptionStatus: updatedShop.subscriptionStatus,
        lengthBasedBillingEnabled: !!updatedShop.lengthBasedBillingEnabled,
        isGstRegistered: !!updatedShop.isGstRegistered,
        gstin: updatedShop.gstin || '',
        gst: updatedShop.gst,
        updatedAt: updatedShop.updatedAt
      }
    });
  } catch (err) {
    console.error('Update shop profile error:', err);
    res.status(500).json({ error: 'Failed to update shop profile.' });
  }
});

// ===================================
// PHASE 4: TODAY'S WORK QUEUE ENDPOINT (IST Date Scoped & High Performance)
// ===================================

app.get('/api/work/today', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { startOfToday, endOfToday, istDateStr } = getISTDayBounds();

    const rawFollowUps = await FollowUp.find({
      shopId,
      status: { $in: ['ready', 'sent', 'scheduled'] }
    }).sort({ createdAt: -1 }).lean();

    const custIds = [...new Set(rawFollowUps.map(f => f.customerId))].filter(Boolean);
    const enqIds = [...new Set(rawFollowUps.map(f => f.enquiryId))].filter(Boolean);

    const [customers, enquiries] = await Promise.all([
      Customer.find({ id: { $in: custIds }, shopId }).lean(),
      Enquiry.find({ id: { $in: enqIds }, shopId }).lean()
    ]);

    const prodIds = [...new Set(enquiries.map(e => e.productId))].filter(Boolean);
    const products = await Product.find({ id: { $in: prodIds }, shopId }).lean();

    const custMap = new Map(customers.map(c => [c.id, c]));
    const enqMap = new Map(enquiries.map(e => [e.id, e]));
    const prodMap = new Map(products.map(p => [p.id, p]));

    const enrichedTasks = rawFollowUps.map(fw => {
      const customer = custMap.get(fw.customerId) || null;
      const enquiry = enqMap.get(fw.enquiryId) || null;
      const product = enquiry ? prodMap.get(enquiry.productId) || null : null;

      const priorityInfo = calculatePriorityAndReason(fw, enquiry, customer, product);

      const scheduledDate = new Date(fw.scheduledAt);
      const isOverdue = scheduledDate < startOfToday && (fw.status === 'ready' || fw.status === 'scheduled');
      const isDueToday = scheduledDate >= startOfToday && scheduledDate <= endOfToday && (fw.status === 'ready' || fw.status === 'sent' || fw.status === 'scheduled');
      const isUpcoming = scheduledDate > endOfToday || (fw.status === 'scheduled' && !isDueToday && !isOverdue);

      return {
        ...fw,
        priority: priorityInfo.priority,
        priorityScore: priorityInfo.score,
        daysOverdue: priorityInfo.daysOverdue,
        reason: priorityInfo.reason,
        isOverdue,
        isDueToday,
        isUpcoming,
        customer,
        enquiry,
        product
      };
    });

    // Categorize cleanly without duplicating overdue items into dueToday
    const overdue = enrichedTasks.filter(t => t.isOverdue);
    const dueToday = enrichedTasks.filter(t => t.isDueToday);
    const upcoming = enrichedTasks.filter(t => t.isUpcoming && !t.isOverdue);
    const highPriority = enrichedTasks.filter(t => t.priority === 'High' || t.priority === 'HIGH');

    // Summary statistics fetched via parallel aggregation (no full Sales docs loaded; staff privacy enforced)
    const isStaff = req.user.role === 'staff';
    const [recoveredAgg, enquiriesCount] = await Promise.all([
      isStaff
        ? Promise.resolve([])
        : Sale.aggregate([
            { $match: { shopId, source: 'quickr_followup' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
          ]),
      Enquiry.countDocuments({ shopId })
    ]);

    const recoveredSalesAmount = isStaff ? undefined : (recoveredAgg[0]?.total || 0);
    const convertedCount = isStaff ? undefined : (recoveredAgg[0]?.count || 0);
    const uniqueCustomerCountToday = new Set(dueToday.map(t => t.customerId)).size;

    res.json({
      totalTasks: dueToday.length,
      dueToday,
      overdue,
      upcoming,
      highPriority,
      summary: {
        todayWorkCount: uniqueCustomerCountToday,
        overdueCount: overdue.length,
        enquiriesCount,
        ...(isStaff ? {} : { recoveredSalesAmount, convertedCount })
      }
    });
  } catch (err) {
    console.error('Work Today error:', err);
    res.status(500).json({ error: 'Failed to fetch today work queue' });
  }
});

app.get('/api/followups/today', requireAuth, async (req, res) => {
  try {
    const list = await FollowUp.find({ 
      shopId: req.user.shopId, 
      status: { $in: ['ready', 'sent'] } 
    }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch today follow-ups' });
  }
});

// ===================================
// PROTECTED BUSINESS APIs
// ===================================

app.get('/api/customers', requireAuth, async (req, res) => {
  try {
    if (!req.user.shopId) return res.status(403).json({ error: 'Shop authorization required' });
    const list = await Customer.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

app.get('/api/customers/:id', requireAuth, async (req, res) => {
  try {
    if (!req.user.shopId) return res.status(403).json({ error: 'Shop authorization required' });
    const cust = await Customer.findOne({ id: req.params.id, shopId: req.user.shopId }).lean();
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    res.json(cust);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

app.post('/api/customers', requireAuth, async (req, res) => {
  try {
    const { name, phone, email, location, preferences } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Customer name and mobile number are required' });
    }

    const normalizedPhone = normalizeIndianMobileNumber(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Enter a valid 10-digit mobile number.' });
    }

    // Check if customer already exists for this shop
    const existing = await Customer.findOne({ shopId: req.user.shopId, phone: normalizedPhone });
    if (existing) {
      if (req.body.allowWhatsAppOffers !== undefined) {
        const consentStatus = req.body.allowWhatsAppOffers === true || req.body.allowWhatsAppOffers === 'true' ? 'active' : 'withdrawn';
        await ConsentRecord.findOneAndUpdate(
          { userId: existing.id, shopId: req.user.shopId, purpose: 'marketing' },
          {
            $set: { status: consentStatus, consentedAt: consentStatus === 'active' ? new Date() : null, withdrawnAt: consentStatus === 'withdrawn' ? new Date() : null },
            $setOnInsert: { id: `CNS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, userId: existing.id, shopId: req.user.shopId, purpose: 'marketing', noticeVersion: '1.0' }
          },
          { upsert: true, new: true }
        );
      }
      return res.status(200).json(existing);
    }

    const id = `CUST-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;

    const newCustomer = new Customer({
      id,
      name: String(name).trim(),
      phone: normalizedPhone,
      email: typeof email === 'string' ? email.trim() : '',
      location: typeof location === 'string' ? location.trim() : '',
      preferences: preferences && typeof preferences === 'object' ? {
        interestedIn: typeof preferences.interestedIn === 'string' ? preferences.interestedIn.trim() : '',
        preferredSize: typeof preferences.preferredSize === 'string' ? preferences.preferredSize.trim() : '',
        preferredColors: Array.isArray(preferences.preferredColors) ? preferences.preferredColors.map(c => String(c).trim()).filter(Boolean) : [],
        lastPurchase: typeof preferences.lastPurchase === 'string' ? preferences.lastPurchase.trim() : ''
      } : {
        interestedIn: '',
        preferredSize: '',
        preferredColors: [],
        lastPurchase: ''
      },
      status: 'Active',
      shopId: req.user.shopId
    });

    await newCustomer.save();

    // Store marketing consent record if allowWhatsAppOffers is passed
    const { allowWhatsAppOffers } = req.body;
    const consentStatus = allowWhatsAppOffers === true || allowWhatsAppOffers === 'true' ? 'active' : 'withdrawn';
    await ConsentRecord.findOneAndUpdate(
      { userId: id, shopId: req.user.shopId, purpose: 'marketing' },
      {
        $set: { status: consentStatus, consentedAt: consentStatus === 'active' ? new Date() : null, withdrawnAt: consentStatus === 'withdrawn' ? new Date() : null },
        $setOnInsert: { id: `CNS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, userId: id, shopId: req.user.shopId, purpose: 'marketing', noticeVersion: '1.0' }
      },
      { upsert: true, new: true }
    );

    Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: id,
      type: 'customer_added',
      description: `Added new customer: ${String(name).trim()}`,
      shopId: req.user.shopId
    }).catch(() => {});

    res.status(201).json(newCustomer);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Unable to save customer' });
  }
});

app.put('/api/customers/:id', requireAuth, async (req, res) => {
  try {
    const allowedUpdates = {};
    const { name, phone, email, location, preferences, status } = req.body || {};

    if (typeof name === 'string' && name.trim()) allowedUpdates.name = name.trim();
    if (typeof email === 'string') allowedUpdates.email = email.trim();
    if (typeof location === 'string') allowedUpdates.location = location.trim();
    if (typeof status === 'string' && ['Active', 'Inactive', 'Lead'].includes(status)) {
      allowedUpdates.status = status;
    }
    if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
      allowedUpdates.preferences = {
        interestedIn: typeof preferences.interestedIn === 'string' ? preferences.interestedIn : '',
        preferredSize: typeof preferences.preferredSize === 'string' ? preferences.preferredSize : '',
        preferredColors: Array.isArray(preferences.preferredColors) ? preferences.preferredColors.map(c => String(c)) : [],
        lastPurchase: typeof preferences.lastPurchase === 'string' ? preferences.lastPurchase : ''
      };
    }

    if (phone !== undefined) {
      const normalized = normalizeIndianMobileNumber(phone);
      if (!normalized) {
        return res.status(400).json({ success: false, error: 'Enter a valid 10-digit mobile number.' });
      }
      allowedUpdates.phone = normalized;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid updatable customer fields provided.' });
    }

    const updated = await Customer.findOneAndUpdate(
      { id: req.params.id, shopId: req.user.shopId },
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update customer' });
  }
});

app.delete('/api/customers/:id', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop authorization required' });
    }

    // Verify customer exists under authenticated shop
    const customer = await Customer.findOne({ id, shopId }).select('_id').lean();
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    // Remove operational CRM & consent records
    await Promise.all([
      Enquiry.deleteMany({ customerId: id, shopId }),
      FollowUp.deleteMany({ customerId: id, shopId }),
      Message.deleteMany({ customerId: id, shopId }),
      Activity.deleteMany({ customerId: id, shopId }),
      ConsentRecord.deleteMany({ userId: id, shopId }),
      Customer.deleteOne({ id, shopId })
    ]);

    res.json({
      success: true,
      message: 'Customer deleted successfully.'
    });
  } catch (err) {
    console.error('Delete customer error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete customer' });
  }
});

app.get('/api/products', requireAuth, async (req, res) => {
  try {
    const list = await Product.find({ shopId: req.user.shopId }).lean();
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const prod = await Product.findOne({ id: req.params.id, shopId: req.user.shopId }).lean();
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    res.json(prod);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.get('/api/products/barcode/:barcode', requireAuth, async (req, res) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(403).json({ error: 'Shop authorization required' });

    const rawBarcode = req.params.barcode ? String(req.params.barcode).trim() : '';
    if (!rawBarcode) return res.status(400).json({ error: 'Barcode parameter required' });

    // Exact barcode matching strictly scoped to the authenticated user's shopId
    const targetBarcodes = [rawBarcode];
    const upper = rawBarcode.toUpperCase();
    if (upper !== rawBarcode) {
      targetBarcodes.push(upper);
    }

    const prod = await Product.findOne({
      shopId,
      barcode: targetBarcodes.length === 1 ? targetBarcodes[0] : { $in: targetBarcodes }
    }).lean();

    if (!prod) {
      return res.status(404).json({
        error: 'Product not found for this barcode.',
        barcode: rawBarcode,
        found: false
      });
    }

    if (!prod.isActive) {
      return res.status(400).json({
        error: 'This product is inactive. Activate it before billing.',
        barcode: rawBarcode,
        found: true,
        inactive: true,
        productId: prod.id,
        productName: prod.name
      });
    }

    res.json(prod);
  } catch (err) {
    res.status(500).json({ error: 'Failed to lookup product by barcode' });
  }
});

// Slide window cache to prevent duplicate product creations from rapid double clicks or repeated requests
const recentProductCreations = new Map();

app.post('/api/products', requireAuth, async (req, res) => {
  try {
    const { name, category, subcategory, sellingPrice, originalPrice, sizes, colors, availability, description, isActive, gstRate, hsnCode, priceIncludesGst, measurementType } = req.body;
    if (!name || sellingPrice === undefined) {
      return res.status(400).json({ error: 'Product name and selling price are required' });
    }

    const numSellingPrice = Number(sellingPrice);
    const numAvailability = availability !== undefined ? Number(availability) : 10;
    if (isNaN(numSellingPrice) || numSellingPrice < 0) {
      return res.status(400).json({ error: 'Selling price must be a non-negative number' });
    }
    if (isNaN(numAvailability) || numAvailability < 0) {
      return res.status(400).json({ error: 'Stock availability cannot be negative' });
    }

    const numGstRate = gstRate !== undefined ? Number(gstRate) : 0;
    const validRates = [0, 5, 12, 18, 28];
    if (isNaN(numGstRate) || numGstRate < 0 || !validRates.includes(numGstRate)) {
      return res.status(400).json({ error: 'GST rate must be one of [0, 5, 12, 18, 28]' });
    }

    const cleanMeasurementType = measurementType === 'length' ? 'length' : 'piece';
    const shopId = req.user.shopId;
    const cleanName = String(name).trim();
    const cleanCategory = String(category || 'Shirts').trim();
    const cleanSizes = Array.isArray(sizes) 
      ? sizes.map(s => String(s).trim()).filter(Boolean) 
      : (typeof sizes === 'string' && sizes.trim() ? sizes.split(',').map(s => s.trim()).filter(Boolean) : []);
    const cleanColors = Array.isArray(colors) 
      ? colors.map(c => String(c).trim()).filter(Boolean) 
      : (typeof colors === 'string' && colors.trim() ? colors.split(',').map(c => c.trim()).filter(Boolean) : []);

    // Deduplication check: if identical create payload arrives within 3000ms for this shop, return existing product
    const dedupKey = `${shopId}:${cleanName.toLowerCase()}:${numSellingPrice}:${cleanCategory}:${JSON.stringify(cleanSizes)}:${JSON.stringify(cleanColors)}`;
    const recent = recentProductCreations.get(dedupKey);
    if (recent && (Date.now() - recent.timestamp < 3000)) {
      return res.status(200).json(recent.product);
    }

    // Auto-generate authoritative QuickR barcode
    const barcode = await generateUniqueBarcode(shopId);

    const id = `PROD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const newProd = new Product({
      id,
      name: cleanName,
      category: cleanCategory,
      subcategory: subcategory || '',
      sellingPrice: numSellingPrice,
      originalPrice,
      sizes: cleanSizes,
      colors: cleanColors,
      availability: numAvailability,
      description: description || '',
      gstRate: numGstRate,
      hsnCode: hsnCode ? String(hsnCode).trim() : '',
      priceIncludesGst: priceIncludesGst !== undefined ? (priceIncludesGst === true || priceIncludesGst === 'true') : true,
      measurementType: cleanMeasurementType,
      isActive: isActive !== undefined ? isActive : true,
      barcode,
      shopId
    });

    await newProd.save();
    recentProductCreations.set(dedupKey, { timestamp: Date.now(), product: newProd });
    if (recentProductCreations.size > 200) {
      const cutoff = Date.now() - 10000;
      for (const [k, v] of recentProductCreations.entries()) {
        if (v.timestamp < cutoff) recentProductCreations.delete(k);
      }
    }
    res.status(201).json(newProd);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.post('/api/products/:id/generate-barcode', requireAuth, async (req, res) => {
  try {
    const prod = await Product.findOne({ id: req.params.id, shopId: req.user.shopId });
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    if (!prod.barcode) {
      prod.barcode = await generateUniqueBarcode(req.user.shopId);
      await prod.save();
    }

    res.json(prod);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate barcode' });
  }
});

app.put('/api/products/:id', requireAuth, async (req, res) => {

  try {
    const { name, category, subcategory, sellingPrice, originalPrice, sizes, colors, availability, description, isActive, gstRate, hsnCode, priceIncludesGst, measurementType } = req.body;
    const prod = await Product.findOne({ id: req.params.id, shopId: req.user.shopId });
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    
    if (name) prod.name = String(name).trim();
    if (category) prod.category = category;
    if (subcategory !== undefined) prod.subcategory = subcategory;
    if (sellingPrice !== undefined) prod.sellingPrice = sellingPrice;
    if (originalPrice !== undefined) prod.originalPrice = originalPrice;
    if (sizes !== undefined) {
      prod.sizes = Array.isArray(sizes) 
        ? sizes.map(s => String(s).trim()).filter(Boolean) 
        : (typeof sizes === 'string' && sizes.trim() ? sizes.split(',').map(s => s.trim()).filter(Boolean) : []);
    }
    if (colors !== undefined) {
      prod.colors = Array.isArray(colors) 
        ? colors.map(c => String(c).trim()).filter(Boolean) 
        : (typeof colors === 'string' && colors.trim() ? colors.split(',').map(c => c.trim()).filter(Boolean) : []);
    }
    if (availability !== undefined) prod.availability = availability;
    if (description !== undefined) prod.description = description;
    if (isActive !== undefined) {
      const boolActive = (isActive === true || isActive === 'true');
      if (req.user.role === 'staff' && boolActive !== prod.isActive) {
        return res.status(403).json({ error: 'Staff accounts are not authorized to change product activation status.' });
      }
      prod.isActive = boolActive;
    }
    if (measurementType !== undefined) {
      prod.measurementType = measurementType === 'length' ? 'length' : 'piece';
    }
    if (hsnCode !== undefined) prod.hsnCode = String(hsnCode).trim();
    if (priceIncludesGst !== undefined) prod.priceIncludesGst = (priceIncludesGst === true || priceIncludesGst === 'true');
    if (gstRate !== undefined) {
      const numGstRate = Number(gstRate);
      const validRates = [0, 5, 12, 18, 28];
      if (isNaN(numGstRate) || numGstRate < 0 || !validRates.includes(numGstRate)) {
        return res.status(400).json({ error: 'GST rate must be one of [0, 5, 12, 18, 28]' });
      }
      prod.gstRate = numGstRate;
    }
    
    await prod.save();
    res.json(prod);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const prod = await Product.findOne({ id: req.params.id, shopId: req.user.shopId });
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    
    // Safety check: Check if product is referenced in sales
    const salesWithProduct = await Sale.exists({
      shopId: req.user.shopId,
      'items.productId': req.params.id
    });

    if (salesWithProduct) {
      // Soft delete / archive to preserve historical sales
      prod.isActive = false;
      await prod.save();
      return res.json({ success: true, isArchived: true, message: 'Product deactivated to preserve historical bill records.' });
    }

    // Hard delete if never sold
    await Product.deleteOne({ id: req.params.id, shopId: req.user.shopId });
    res.json({ success: true, isDeleted: true, message: 'Product deleted permanently.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Bulk Delete Products Endpoint
app.post('/api/products/bulk-delete', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const { ids } = req.body;
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop authorization required' });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No product IDs provided' });
    }

    // Verify all products belong to authenticated shop
    const products = await Product.find({ id: { $in: ids }, shopId }).select('id').lean();
    const validIds = products.map(p => p.id);

    if (validIds.length === 0) {
      return res.json({
        success: true,
        deletedCount: 0,
        archivedCount: 0,
        totalRequested: ids.length,
        message: 'No matching products found for deletion.'
      });
    }

    // Find which products are referenced in completed sales for this shop
    const salesWithProducts = await Sale.find({
      shopId,
      'items.productId': { $in: validIds }
    }).distinct('items.productId');

    const referencedSet = new Set(salesWithProducts.map(id => String(id)));

    const idsToArchive = validIds.filter(id => referencedSet.has(id));
    const idsToDelete = validIds.filter(id => !referencedSet.has(id));

    // Perform bulk operations
    let archivedCount = 0;
    let deletedCount = 0;

    if (idsToArchive.length > 0) {
      const archiveResult = await Product.updateMany(
        { id: { $in: idsToArchive }, shopId },
        { $set: { isActive: false } }
      );
      archivedCount = archiveResult.modifiedCount || idsToArchive.length;
    }

    if (idsToDelete.length > 0) {
      const deleteResult = await Product.deleteMany({ id: { $in: idsToDelete }, shopId });
      deletedCount = deleteResult.deletedCount || idsToDelete.length;
    }

    let message = `${deletedCount + archivedCount} products processed successfully.`;
    if (deletedCount > 0 && archivedCount > 0) {
      message = `${deletedCount} product(s) deleted permanently. ${archivedCount} product(s) were deactivated because they are used in completed bills.`;
    } else if (archivedCount > 0 && deletedCount === 0) {
      message = `${archivedCount} product(s) deactivated because they are referenced by completed bills.`;
    } else if (deletedCount > 0) {
      message = `${deletedCount} product(s) deleted permanently.`;
    }

    res.json({
      success: true,
      deletedCount,
      archivedCount,
      totalProcessed: deletedCount + archivedCount,
      message
    });
  } catch (err) {
    console.error('Bulk delete products error:', err);
    res.status(500).json({ success: false, error: 'Failed to perform bulk product deletion' });
  }
});

// Bulk Import Products Endpoint
app.post('/api/products/import', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop authorization required' });
    }

    const { products: rawProducts, gstSettings } = req.body;
    if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
      return res.status(400).json({ success: false, error: 'No product records provided for import.' });
    }

    // Maximum safety limit per request payload
    if (rawProducts.length > 15000) {
      return res.status(400).json({ success: false, error: 'Maximum 15,000 products allowed per import batch.' });
    }

    // Step 0: Fetch Shop to verify GST registration and defaults
    const shop = await Shop.findOne({ customId: shopId }).lean();
    const isGstRegistered = shop?.isGstRegistered || shop?.gst?.registered || false;
    const defaultShopGstRate = Number(gstSettings?.defaultRate ?? shop?.gst?.defaultRate ?? 0);
    const rateSource = gstSettings?.rateSource || 'excel_or_default';
    const priceIncludesGstSetting = gstSettings?.priceIncludesGst !== undefined ? Boolean(gstSettings.priceIncludesGst) : true;
    const VALID_GST_RATES = [0, 5, 12, 18, 28];

    // Step 1: Fetch existing barcodes for this shop only
    const existingShopProducts = await Product.find({ shopId }).select('barcode name').lean();
    const existingBarcodeSet = new Set(
      existingShopProducts
        .filter(p => p.barcode)
        .map(p => String(p.barcode).trim())
    );

    let importedCount = 0;
    let skippedCount = 0;
    let duplicateBarcodeCount = 0;
    let generatedBarcodeCount = 0;
    let validationErrorCount = 0;

    const issueDetails = [];
    const validDocsToInsert = [];
    const inMemoryBarcodesInBatch = new Set();

    const timestampBase = Date.now();

    for (let index = 0; index < rawProducts.length; index++) {
      const row = rawProducts[index];
      const excelRowNumber = row.excelRow || (index + 2);

      // Sanitize fields - NEVER trust frontend shopId
      const name = row.name ? String(row.name).trim() : '';
      if (!name) {
        validationErrorCount++;
        skippedCount++;
        issueDetails.push({
          row: excelRowNumber,
          productName: '[Missing Name]',
          barcode: row.barcode || '',
          issue: 'Missing Product Name',
          suggestedFix: 'Provide a valid non-empty product name'
        });
        continue;
      }

      // Selling Price validation
      let sellingPrice = Number(row.sellingPrice);
      if (isNaN(sellingPrice) || sellingPrice < 0) {
        // Fallback default or issue
        if (row.sellingPrice === undefined || row.sellingPrice === '' || row.sellingPrice === null) {
          sellingPrice = 0;
        } else {
          validationErrorCount++;
          skippedCount++;
          issueDetails.push({
            row: excelRowNumber,
            productName: name,
            barcode: row.barcode || '',
            issue: `Invalid Selling Price: "${row.sellingPrice}"`,
            suggestedFix: 'Selling price must be a valid non-negative number'
          });
          continue;
        }
      }

      // GST Rate Calculation & Validation for GST registered shops
      let finalGstRate = 0;
      let finalPriceIncludesGst = true;

      if (isGstRegistered) {
        finalPriceIncludesGst = priceIncludesGstSetting;
        if (rateSource === 'all_default') {
          finalGstRate = VALID_GST_RATES.includes(defaultShopGstRate) ? defaultShopGstRate : 0;
        } else {
          // excel_or_default
          const rawRowGst = row.gstRate;
          if (rawRowGst !== undefined && rawRowGst !== null && rawRowGst !== '') {
            const parsedGst = Number(rawRowGst);
            if (!isNaN(parsedGst) && VALID_GST_RATES.includes(parsedGst)) {
              finalGstRate = parsedGst;
            } else {
              validationErrorCount++;
              skippedCount++;
              issueDetails.push({
                row: excelRowNumber,
                productName: name,
                barcode: row.barcode || '',
                issue: `Invalid GST Rate: "${rawRowGst}%"`,
                suggestedFix: 'GST rate must be one of 0%, 5%, 12%, 18%, or 28%'
              });
              continue;
            }
          } else {
            // Fallback to default GST rate
            finalGstRate = VALID_GST_RATES.includes(defaultShopGstRate) ? defaultShopGstRate : 0;
          }
        }
      }

      // MRP validation
      let originalPrice = undefined;
      if (row.originalPrice !== undefined && row.originalPrice !== null && row.originalPrice !== '') {
        const parsedMrp = Number(row.originalPrice);
        if (!isNaN(parsedMrp) && parsedMrp >= 0) {
          originalPrice = parsedMrp;
        }
      }

      // Stock validation
      let availability = 0;
      if (row.availability !== undefined && row.availability !== null && row.availability !== '') {
        const parsedStock = parseInt(String(row.availability), 10);
        if (!isNaN(parsedStock) && parsedStock >= 0) {
          availability = parsedStock;
        }
      }

      // Sizes and colors normalization
      let sizes = [];
      if (Array.isArray(row.sizes)) {
        sizes = row.sizes.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof row.sizes === 'string' && row.sizes.trim()) {
        sizes = row.sizes.split(',').map(s => s.trim()).filter(Boolean);
      }

      let colors = [];
      if (Array.isArray(row.colors)) {
        colors = row.colors.map(c => String(c).trim()).filter(Boolean);
      } else if (typeof row.colors === 'string' && row.colors.trim()) {
        colors = row.colors.split(',').map(c => c.trim()).filter(Boolean);
      }

      // Barcode handling - PRESERVE EXACT STRING & LEADING ZEROES
      let rawBarcode = row.barcode !== undefined && row.barcode !== null ? String(row.barcode).trim() : '';
      let barcodeType = 'CODE128';
      let barcodeSource = 'imported';

      if (rawBarcode) {
        // Check 1: Duplicate inside file batch
        if (inMemoryBarcodesInBatch.has(rawBarcode)) {
          duplicateBarcodeCount++;
          skippedCount++;
          issueDetails.push({
            row: excelRowNumber,
            productName: name,
            barcode: rawBarcode,
            issue: 'Duplicate Barcode inside uploaded file',
            suggestedFix: 'Ensure every product in file has a unique barcode or leave blank to auto-generate'
          });
          continue;
        }

        // Check 2: Barcode already exists in shop DB
        if (existingBarcodeSet.has(rawBarcode)) {
          duplicateBarcodeCount++;
          skippedCount++;
          issueDetails.push({
            row: excelRowNumber,
            productName: name,
            barcode: rawBarcode,
            issue: 'Barcode already exists in QuickR for your shop',
            suggestedFix: 'Use a unique barcode or skip to preserve existing product record'
          });
          continue;
        }

        // Determine Barcode Type heuristic
        if (/^\d{13}$/.test(rawBarcode)) barcodeType = 'EAN13';
        else if (/^\d{12}$/.test(rawBarcode)) barcodeType = 'UPC';
        else if (/^[A-Z0-9\-\.\ \$\/\+\%]+$/i.test(rawBarcode)) barcodeType = 'CODE128';
        else barcodeType = 'CUSTOM';

        inMemoryBarcodesInBatch.add(rawBarcode);
      } else {
        // Auto-generate collision-free QuickR barcode verified against existing & batch sets
        let candidate = '';
        do {
          const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
          candidate = `QKR-${randomHex}`;
        } while (existingBarcodeSet.has(candidate) || inMemoryBarcodesInBatch.has(candidate));
        rawBarcode = candidate;
        barcodeType = 'CODE128';
        barcodeSource = 'quickr_generated';
        generatedBarcodeCount++;
        inMemoryBarcodesInBatch.add(rawBarcode);
      }

      const category = row.category ? String(row.category).trim() : 'General';
      const productId = `PROD-IMP-${timestampBase}-${index}-${crypto.randomBytes(2).toString('hex')}`;

      validDocsToInsert.push({
        id: productId,
        name,
        category,
        subcategory: row.subcategory ? String(row.subcategory).trim() : '',
        sellingPrice,
        originalPrice,
        sizes,
        colors,
        availability,
        description: row.description ? String(row.description).trim() : '',
        measurementType: row.measurementType === 'length' ? 'length' : 'piece',
        gstRate: finalGstRate,
        hsnCode: row.hsnCode ? String(row.hsnCode).trim() : '',
        priceIncludesGst: finalPriceIncludesGst,
        isActive: true,
        barcode: rawBarcode,
        barcodeType,
        barcodeSource,
        shopId // Authenticated shopId strictly enforced
      });
    }

    // Step 2: Batch Insert in chunks of 500 documents (gracefully handles partial duplicates)
    const BATCH_SIZE = 500;
    for (let i = 0; i < validDocsToInsert.length; i += BATCH_SIZE) {
      const chunk = validDocsToInsert.slice(i, i + BATCH_SIZE);
      try {
        const inserted = await Product.insertMany(chunk, { ordered: false });
        importedCount += inserted.length;
      } catch (bulkErr) {
        const insertedCount = bulkErr.insertedDocs?.length ?? bulkErr.result?.insertedCount ?? 0;
        const failedCount = chunk.length - insertedCount;
        importedCount += insertedCount;
        skippedCount += failedCount;
        duplicateBarcodeCount += failedCount;
      }
    }

    // Step 3: Record Audit Activity
    Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: 'system',
      shopId,
      type: 'product_imported',
      description: `Imported ${importedCount} products in bulk (${skippedCount} skipped).`
    }).catch(() => {});

    res.json({
      success: true,
      summary: {
        totalRows: rawProducts.length,
        imported: importedCount,
        skipped: skippedCount,
        duplicates: duplicateBarcodeCount,
        validationErrors: validationErrorCount,
        generatedBarcodes: generatedBarcodeCount
      },
      issues: issueDetails.slice(0, 500) // Return top 500 issues for UI preview/report
    });
  } catch (err) {
    console.error('Bulk import products error:', err);
    res.status(500).json({ success: false, error: 'Failed to complete product import batch.' });
  }
});

// Bulk Delete Customers Endpoint
app.post('/api/customers/bulk-delete', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const { ids } = req.body;
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop authorization required' });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No customer IDs provided' });
    }

    // Verify customers belong to shop
    const customers = await Customer.find({ id: { $in: ids }, shopId }).select('id').lean();
    const validIds = customers.map(c => c.id);

    if (validIds.length === 0) {
      return res.json({
        success: true,
        deletedCount: 0,
        message: 'No matching customers found for deletion.'
      });
    }

    // Remove operational CRM & consent records cascade
    await Promise.all([
      Enquiry.deleteMany({ customerId: { $in: validIds }, shopId }),
      FollowUp.deleteMany({ customerId: { $in: validIds }, shopId }),
      Message.deleteMany({ customerId: { $in: validIds }, shopId }),
      Activity.deleteMany({ customerId: { $in: validIds }, shopId }),
      ConsentRecord.deleteMany({ userId: { $in: validIds }, shopId })
    ]);

    // Note: Historical Sales records retain customer information (customerName, customerPhone) while customer document is deleted
    const deleteResult = await Customer.deleteMany({ id: { $in: validIds }, shopId });
    const deletedCount = deleteResult.deletedCount || validIds.length;

    res.json({
      success: true,
      deletedCount,
      message: `${deletedCount} customer(s) deleted successfully.`
    });
  } catch (err) {
    console.error('Bulk delete customers error:', err);
    res.status(500).json({ success: false, error: 'Failed to perform bulk customer deletion' });
  }
});

// Bulk Delete Enquiries Endpoint
app.post('/api/enquiries/bulk-delete', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const { ids } = req.body;
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop authorization required' });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No enquiry IDs provided' });
    }

    // Delete enquiries belonging to shop
    const deleteResult = await Enquiry.deleteMany({ id: { $in: ids }, shopId });
    const deletedCount = deleteResult.deletedCount || 0;

    // Delete associated active follow-ups for these enquiries
    await FollowUp.deleteMany({
      enquiryId: { $in: ids },
      shopId,
      status: { $in: ['ready', 'sent', 'scheduled'] }
    });

    res.json({
      success: true,
      deletedCount,
      message: `${deletedCount} enquiry(ies) deleted successfully.`
    });
  } catch (err) {
    console.error('Bulk delete enquiries error:', err);
    res.status(500).json({ success: false, error: 'Failed to perform bulk enquiry deletion' });
  }
});

app.get('/api/enquiries', requireAuth, async (req, res) => {
  try {
    const list = await Enquiry.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch enquiries' });
  }
});

app.post('/api/enquiries', requireAuth, async (req, res) => {
  try {
    const { customerId, productId, size, color, quantity, interest, purchaseStatus, notes, scheduledAt, followUpDate } = req.body;
    if (!customerId || !productId) {
      return res.status(400).json({ error: 'customerId and productId are required' });
    }

    // Strictly isolate both Customer and Product to authenticated shopId (no cross-tenant fallback)
    const [customer, product] = await Promise.all([
      Customer.findOne({ id: customerId, shopId: req.user.shopId }).lean(),
      Product.findOne({ id: productId, shopId: req.user.shopId }).lean()
    ]);

    if (!customer || !product) {
      return res.status(404).json({ error: 'Referenced customer or product not found for your shop' });
    }

    if (product.sizes && product.sizes.length > 0 && (!size || !String(size).trim())) {
      return res.status(400).json({ error: 'Please choose a size for this product' });
    }

    const suffix = crypto.randomBytes(2).toString('hex');
    const enqId = `ENQ-${Date.now()}-${suffix}`;
    const newEnquiry = new Enquiry({
      id: enqId,
      customerId,
      productId,
      productName: product.name,
      productCategory: product.category,
      priceAtEnquiry: product.sellingPrice,
      size: typeof size === 'string' && size.trim() ? size.trim() : 'Free Size',
      color: typeof color === 'string' && color.trim() ? color.trim() : 'Standard',
      quantity: Math.max(1, Number(quantity) || 1),
      interest: interest || 'Interested',
      purchaseStatus: purchaseStatus || 'Pending',
      notes: notes || '',
      shopId: req.user.shopId
    });

    await newEnquiry.save();

    let createdFollowUp = null;
    const sizeText = size && size !== 'N/A' ? ` (${size})` : '';

    Activity.create({
      id: `ACT-${Date.now()}-${suffix}`,
      customerId,
      type: 'enquiry_created',
      description: `Enquiry added for ${product.name}${sizeText}`,
      shopId: req.user.shopId
    }).catch(() => {});

    if (purchaseStatus === "Didn't Purchase") {
      const fwId = `FW-${Date.now()}-${suffix}`;
      const prodLabel = product.name && product.name !== 'N/A' ? product.name : 'item';
      const sizeLabel = size && size !== 'N/A' && size !== 'Free Size' ? ` (${size})` : '';
      const msgText = `Good to see your interest in our ${prodLabel}${sizeLabel}. It is currently available and ready for you. Would you like to place an order or need help with anything?`;

      let targetScheduledAt = new Date();
      if (scheduledAt) {
        const parsed = new Date(scheduledAt);
        if (!isNaN(parsed.getTime())) {
          targetScheduledAt = parsed;
        }
      } else if (followUpDate) {
        targetScheduledAt = calculateScheduledDateIST(followUpDate);
      }

      // Check if targetScheduledAt is past end of today in IST
      const { endOfToday } = getISTDayBounds();
      const initialStatus = targetScheduledAt > endOfToday ? 'scheduled' : 'ready';
      const priorityResult = calculatePriorityAndReason({ scheduledAt: targetScheduledAt }, newEnquiry, customer, product);

      createdFollowUp = new FollowUp({
        id: fwId,
        customerId,
        enquiryId: enqId,
        reason: priorityResult.reason,
        scheduledAt: targetScheduledAt,
        status: initialStatus,
        message: msgText,
        priority: priorityResult.priority,
        shopId: req.user.shopId
      });

      await createdFollowUp.save();

      Activity.create({
        id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId,
        type: 'followup_created',
        description: `Follow-up automatically recommended for ${product.name}`,
        shopId: req.user.shopId
      }).catch(() => {});
    }

    res.status(201).json({ enquiry: newEnquiry, followUp: createdFollowUp });
  } catch (err) {
    console.error('Create enquiry error:', err);
    res.status(500).json({ error: 'Failed to create enquiry' });
  }
});

app.get('/api/followups', requireAuth, async (req, res) => {
  try {
    const list = await FollowUp.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

app.get('/api/followups/:id', requireAuth, async (req, res) => {
  try {
    const fw = await FollowUp.findOne({ id: req.params.id, shopId: req.user.shopId }).lean();
    if (!fw) return res.status(404).json({ error: 'Follow-up not found' });
    res.json(fw);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch follow-up' });
  }
});

app.post('/api/followups/:id/send', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body || {};

    const fw = await FollowUp.findOne({ id, shopId: req.user.shopId });
    if (!fw) return res.status(404).json({ error: 'Follow-up not found' });

    const customer = await Customer.findOne({ id: fw.customerId, shopId: req.user.shopId }).select('phone name').lean();
    if (!customer || !customer.phone) {
      return res.status(400).json({ error: 'Customer does not have a valid phone number.' });
    }
    const targetMessage = content || fw.message;

    // Pass authenticated shopId so connected shop Meta credentials are used
    const result = await sendWhatsAppCloudMessage(customer.phone, targetMessage, req.user.shopId);

    const msgId = `MSG-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const newMsg = new Message({
      id: msgId,
      customerId: fw.customerId,
      enquiryId: fw.enquiryId,
      followUpId: fw.id,
      channel: 'whatsapp',
      content: targetMessage,
      status: result.status,
      provider: result.provider,
      providerMessageId: result.providerMessageId || '',
      error: result.error || '',
      sentAt: new Date(),
      shopId: req.user.shopId
    });
    await newMsg.save();

    fw.status = 'sent';
    fw.message = targetMessage;
    fw.messageId = msgId;
    await fw.save();

    Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: fw.customerId,
      type: 'message_sent',
      description: `WhatsApp message (${result.provider}): "${targetMessage.substring(0, 30)}..."`,
      metadata: { channel: 'whatsapp', messageId: msgId, provider: result.provider, status: result.status },
      shopId: req.user.shopId
    }).catch(() => {});

    res.json({ success: true, followUp: fw, message: newMsg, provider: result.provider, status: result.status });
  } catch (err) {
    console.error('Send followUp error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/api/followups/:id/outcome', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, nextDateStr, scheduleNext } = req.body || {};

    const validOutcomes = ['Purchased', 'Still Interested', 'Not Interested', 'No Response'];
    if (!outcome || !validOutcomes.includes(outcome)) {
      return res.status(400).json({ error: 'Invalid follow-up outcome.' });
    }

    const fw = await FollowUp.findOne({ id, shopId: req.user.shopId });
    if (!fw) return res.status(404).json({ error: 'Follow-up not found' });

    fw.outcome = outcome;
    fw.status = 'closed';
    fw.completedAt = new Date();
    await fw.save();

    const { endOfToday } = getISTDayBounds();

    if (outcome === 'Still Interested' && nextDateStr) {
      const targetDate = calculateScheduledDateIST(nextDateStr);
      const nextStatus = targetDate > endOfToday ? 'scheduled' : 'ready';
      const newFw = new FollowUp({
        id: `FW-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: fw.customerId,
        enquiryId: fw.enquiryId,
        reason: 'Customer is still interested but has not purchased.',
        scheduledAt: targetDate,
        status: nextStatus,
        message: fw.message,
        priority: 'Medium',
        shopId: req.user.shopId
      });
      await newFw.save();

      Activity.create({
        id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: fw.customerId,
        type: 'followup_created',
        description: `Follow-up rescheduled for ${nextDateStr}`,
        shopId: req.user.shopId
      }).catch(() => {});
    } else if (outcome === 'Purchased' && fw.enquiryId) {
      await Enquiry.findOneAndUpdate({ id: fw.enquiryId, shopId: req.user.shopId }, { purchaseStatus: 'Purchased' });
    } else if (outcome === 'Not Interested') {
      await Enquiry.findOneAndUpdate({ id: fw.enquiryId, shopId: req.user.shopId }, { purchaseStatus: "Didn't Purchase" });
      Activity.create({
        id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: fw.customerId,
        type: 'customer_marked_not_interested',
        description: `Customer marked as not interested`,
        shopId: req.user.shopId
      }).catch(() => {});
    } else if (outcome === 'No Response' && scheduleNext) {
      const threeDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const newFw = new FollowUp({
        id: `FW-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: fw.customerId,
        enquiryId: fw.enquiryId,
        reason: 'Follow up again after no response.',
        scheduledAt: threeDaysLater,
        status: threeDaysLater > endOfToday ? 'scheduled' : 'ready',
        message: fw.message,
        priority: 'Low',
        shopId: req.user.shopId
      });
      await newFw.save();

      Activity.create({
        id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        customerId: fw.customerId,
        type: 'followup_created',
        description: `Follow-up automatically scheduled in 3 days (No Response)`,
        shopId: req.user.shopId
      }).catch(() => {});
    }

    res.json({ success: true, followUp: fw });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record outcome' });
  }
});

app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const list = await Message.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/messages/:customerId', requireAuth, async (req, res) => {
  try {
    const list = await Message.find({ customerId: req.params.customerId, shopId: req.user.shopId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer messages' });
  }
});

// GET /api/sales/export (Phase 3B: Dynamic Excel Sales Report Generation in IST)
app.get('/api/sales/export', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { period = 'month', startDate, endDate } = req.query;

    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required for sales export' });
    }

    const shop = await Shop.findOne({ customId: shopId }).lean();
    const shopName = shop ? shop.name : shopId;

    // Helper: IST date bounds calculation (Asia/Kolkata = UTC + 5:30)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + istOffsetMs);
    const istYear = istNow.getUTCFullYear();
    const istMonth = istNow.getUTCMonth();
    const istDate = istNow.getUTCDate();

    let queryStart, queryEnd, periodLabel, filenamePeriod;

    if (period === 'today') {
      queryStart = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59, 999) - istOffsetMs);
      const dateStr = `${istYear}-${String(istMonth + 1).padStart(2, '0')}-${String(istDate).padStart(2, '0')}`;
      periodLabel = `Today (${dateStr})`;
      filenamePeriod = `Today_${dateStr}`;

    } else if (period === 'week') {
      // Monday -> Sunday IST
      const dayOfWeek = istNow.getUTCDay(); // 0 is Sun, 1 is Mon...
      const diffToMon = (dayOfWeek + 6) % 7;
      const mondayDate = istDate - diffToMon;

      queryStart = new Date(Date.UTC(istYear, istMonth, mondayDate, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth, mondayDate + 6, 23, 59, 59, 999) - istOffsetMs);

      const monIst = new Date(queryStart.getTime() + istOffsetMs);
      const sunIst = new Date(queryEnd.getTime() + istOffsetMs);
      const monStr = `${monIst.getUTCFullYear()}-${String(monIst.getUTCMonth() + 1).padStart(2, '0')}-${String(monIst.getUTCDate()).padStart(2, '0')}`;
      const sunStr = `${sunIst.getUTCFullYear()}-${String(sunIst.getUTCMonth() + 1).padStart(2, '0')}-${String(sunIst.getUTCDate()).padStart(2, '0')}`;
      periodLabel = `This Week (${monStr} to ${sunStr})`;
      filenamePeriod = `Week_${monStr}_to_${sunStr}`;

    } else if (period === 'month') {
      queryStart = new Date(Date.UTC(istYear, istMonth, 1, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth + 1, 0, 23, 59, 59, 999) - istOffsetMs);
      const monthStr = `${istYear}-${String(istMonth + 1).padStart(2, '0')}`;
      periodLabel = `This Month (${monthStr})`;
      filenamePeriod = `Month_${monthStr}`;

    } else if (period === 'custom') {
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate parameters are required for custom range' });
      }

      const sParts = startDate.split('-').map(Number);
      const eParts = endDate.split('-').map(Number);

      if (sParts.length !== 3 || eParts.length !== 3 || sParts.some(isNaN) || eParts.some(isNaN)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      queryStart = new Date(Date.UTC(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999) - istOffsetMs);

      if (isNaN(queryStart.getTime()) || isNaN(queryEnd.getTime())) {
        return res.status(400).json({ error: 'Invalid date values provided.' });
      }

      if (queryStart > queryEnd) {
        return res.status(400).json({ error: 'startDate cannot be after endDate.' });
      }

      periodLabel = `Custom (${startDate} to ${endDate})`;
      filenamePeriod = `Custom_${startDate}_to_${endDate}`;

    } else {
      return res.status(400).json({ error: 'Invalid period parameter. Supported: today, week, month, custom.' });
    }

    // Fetch sales records within IST date range
    const salesDocs = await Sale.find({
      shopId,
      createdAt: { $gte: queryStart, $lte: queryEnd }
    }).sort({ createdAt: -1 }).lean();

    // Dynamically build Excel workbook using ExcelJS
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuickR System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Sales Report');

    // Title & Metadata Header Rows
    worksheet.addRow(['QuickR Sales Report']);
    worksheet.addRow(['Shop Name:', shopName]);
    worksheet.addRow(['Report Period:', periodLabel]);
    worksheet.addRow(['Generated At:', new Date(now.getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19) + ' IST']);
    worksheet.addRow([]);

    // Calculate Summary Totals
    const totalSalesCount = salesDocs.length;
    let totalItemsSold = 0;
    let totalRevenue = 0;

    salesDocs.forEach(s => {
      totalRevenue += (s.totalAmount || 0);
      if (Array.isArray(s.items)) {
        s.items.forEach(item => {
          totalItemsSold += (item.quantity || 0);
        });
      }
    });

    worksheet.addRow(['Summary Totals']);
    worksheet.addRow(['Total Orders / Bills:', totalSalesCount]);
    worksheet.addRow(['Total Items Sold:', totalItemsSold]);
    worksheet.addRow(['Total Revenue:', totalRevenue]);
    worksheet.addRow([]);

    // Format Title & Header styling
    worksheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1E293B' } };
    worksheet.getCell('A6').font = { size: 13, bold: true, color: { argb: 'FF475569' } };

    // Currency formatting for total revenue summary
    worksheet.getCell('B8').numberFormat = '₹#,##0.00';

    // Pre-fetch Product documents in batch for size/category lookup fallback
    const allProdIds = new Set();
    salesDocs.forEach(s => {
      if (Array.isArray(s.items)) {
        s.items.forEach(i => { if (i.productId) allProdIds.add(i.productId); });
      }
    });
    const dbProductDocs = allProdIds.size > 0
      ? await Product.find({ shopId, id: { $in: Array.from(allProdIds) } }).select('id category sizes').lean()
      : [];
    const prodDocMap = new Map(dbProductDocs.map(p => [p.id, p]));

    // Sales Data Table Header
    const tableHeaderRow = worksheet.addRow([
      'Invoice #',
      'Sale Date (IST)',
      'Customer Name',
      'Customer Phone',
      'Product Name',
      'Category',
      'Size',
      'Quantity',
      'Unit',
      'Unit Price',
      'Line Total',
      'Bill Subtotal',
      'Discount',
      'Bill Total',
      'Payment Method',
      'Source'
    ]);

    tableHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' } // Indigo header fill
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Populate Product Line Rows
    salesDocs.forEach(sale => {
      const saleDateIST = new Date(new Date(sale.createdAt).getTime() + istOffsetMs)
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);

      const items = Array.isArray(sale.items) && sale.items.length > 0 ? sale.items : [{
        productName: 'N/A',
        category: '',
        size: '',
        quantity: 1,
        rate: sale.totalAmount || 0,
        total: sale.totalAmount || 0
      }];

      items.forEach(item => {
        const prodDoc = item.productId ? prodDocMap.get(item.productId) : null;
        
        // Category resolution: item snapshot -> product catalog -> blank
        let catVal = item.category || (prodDoc ? prodDoc.category : '') || '';
        if (catVal === 'General' || catVal === 'Category' || catVal === null || catVal === undefined) catVal = '';
        
        // Size resolution: item snapshot -> product catalog sizes array -> blank
        let sizeVal = item.size || '';
        if (!sizeVal && prodDoc && Array.isArray(prodDoc.sizes) && prodDoc.sizes.length > 0) {
          sizeVal = prodDoc.sizes.join(', ');
        }
        if (sizeVal === null || sizeVal === undefined) sizeVal = '';

        const unitDisplay = item.sellingUnit || (item.measurementType === 'length' ? 'm' : 'pcs');

        const row = worksheet.addRow([
          sanitizeSpreadsheetCell(sale.invoiceNumber || sale.id),
          saleDateIST,
          sanitizeSpreadsheetCell(sale.customerName || 'Walk-in Customer'),
          sanitizeSpreadsheetCell(sale.customerPhone || 'N/A'),
          sanitizeSpreadsheetCell(item.productName || 'General Item'),
          sanitizeSpreadsheetCell(catVal),
          sanitizeSpreadsheetCell(sizeVal),
          item.quantity || 1,
          unitDisplay,
          item.rate || 0,
          item.total || 0,
          sale.subtotal || sale.totalAmount,
          sale.discount || 0,
          sale.totalAmount || 0,
          sale.paymentMethod || 'Cash',
          sale.source === 'quickr_followup' ? 'Follow-Up Recovery' : 'Direct Sale'
        ]);

        // Currency formatting (updated column indices after adding Unit column)
        row.getCell(10).numberFormat = '₹#,##0.00';
        row.getCell(11).numberFormat = '₹#,##0.00';
        row.getCell(12).numberFormat = '₹#,##0.00';
        row.getCell(13).numberFormat = '₹#,##0.00';
        row.getCell(14).numberFormat = '₹#,##0.00';
      });
    });

    // Auto-fit Column Widths
    worksheet.columns.forEach(column => {
      let maxLen = 12;
      column.eachCell({ includeEmpty: false }, cell => {
        const valStr = cell.value ? String(cell.value) : '';
        if (valStr.length > maxLen && valStr.length < 50) {
          maxLen = valStr.length;
        }
      });
      column.width = maxLen + 3;
    });

    // Set Response Headers for binary .xlsx download
    const filename = `QuickR_Sales_${filenamePeriod}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export sales error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to generate sales report.' });
    }
  }
});

// GET /api/reports/export (Phase 3C: Dynamic Excel Business Reports Generation in IST)
app.get('/api/reports/export', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const { type = 'summary', period = 'month', startDate, endDate } = req.query;

    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required for reports export' });
    }

    const validTypes = ['customers', 'enquiries', 'followups', 'products', 'summary', 'sales'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid report type. Supported: ${validTypes.join(', ')}` });
    }

    const shop = await Shop.findOne({ customId: shopId }).lean();
    const shopName = shop ? shop.name : shopId;

    // Helper: IST date bounds calculation (Asia/Kolkata = UTC + 5:30)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + istOffsetMs);
    const istYear = istNow.getUTCFullYear();
    const istMonth = istNow.getUTCMonth();
    const istDate = istNow.getUTCDate();

    let queryStart, queryEnd, periodLabel, filenamePeriod;

    if (period === 'today') {
      queryStart = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59, 999) - istOffsetMs);
      const dateStr = `${istYear}-${String(istMonth + 1).padStart(2, '0')}-${String(istDate).padStart(2, '0')}`;
      periodLabel = `Today (${dateStr})`;
      filenamePeriod = `Today_${dateStr}`;

    } else if (period === 'week') {
      const dayOfWeek = istNow.getUTCDay(); // 0 is Sun, 1 is Mon...
      const diffToMon = (dayOfWeek + 6) % 7;
      const mondayDate = istDate - diffToMon;

      queryStart = new Date(Date.UTC(istYear, istMonth, mondayDate, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth, mondayDate + 6, 23, 59, 59, 999) - istOffsetMs);

      const monIst = new Date(queryStart.getTime() + istOffsetMs);
      const sunIst = new Date(queryEnd.getTime() + istOffsetMs);
      const monStr = `${monIst.getUTCFullYear()}-${String(monIst.getUTCMonth() + 1).padStart(2, '0')}-${String(monIst.getUTCDate()).padStart(2, '0')}`;
      const sunStr = `${sunIst.getUTCFullYear()}-${String(sunIst.getUTCMonth() + 1).padStart(2, '0')}-${String(sunIst.getUTCDate()).padStart(2, '0')}`;
      periodLabel = `This Week (${monStr} to ${sunStr})`;
      filenamePeriod = `Week_${monStr}_to_${sunStr}`;

    } else if (period === 'month') {
      queryStart = new Date(Date.UTC(istYear, istMonth, 1, 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(istYear, istMonth + 1, 0, 23, 59, 59, 999) - istOffsetMs);
      const monthStr = `${istYear}-${String(istMonth + 1).padStart(2, '0')}`;
      periodLabel = `This Month (${monthStr})`;
      filenamePeriod = `Month_${monthStr}`;

    } else if (period === 'custom') {
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate parameters are required for custom range' });
      }

      const sParts = startDate.split('-').map(Number);
      const eParts = endDate.split('-').map(Number);

      if (sParts.length !== 3 || eParts.length !== 3 || sParts.some(isNaN) || eParts.some(isNaN)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      queryStart = new Date(Date.UTC(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0) - istOffsetMs);
      queryEnd = new Date(Date.UTC(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999) - istOffsetMs);

      if (isNaN(queryStart.getTime()) || isNaN(queryEnd.getTime())) {
        return res.status(400).json({ error: 'Invalid date values provided.' });
      }

      if (queryStart > queryEnd) {
        return res.status(400).json({ error: 'startDate cannot be after endDate.' });
      }

      periodLabel = `Custom (${startDate} to ${endDate})`;
      filenamePeriod = `Custom_${startDate}_to_${endDate}`;

    } else {
      return res.status(400).json({ error: 'Invalid period parameter. Supported: today, week, month, custom.' });
    }

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuickR System';
    workbook.created = new Date();

    const reportTitles = {
      customers: 'Customer Performance Report',
      enquiries: 'Enquiry & Lead Tracking Report',
      followups: 'Follow-Up Status & Priority Report',
      products: 'Product Performance & Conversion Report',
      summary: 'Executive Business Summary Report',
      sales: 'QuickR Sales Report'
    };

    const sheetTitle = reportTitles[type] || 'Business Report';
    const worksheet = workbook.addWorksheet(type.toUpperCase());

    // Title & Metadata Header Rows
    worksheet.addRow(['QuickR Business Intelligence']);
    worksheet.addRow(['Report Name:', sheetTitle]);
    worksheet.addRow(['Shop Name:', shopName]);
    worksheet.addRow(['Report Period:', periodLabel]);
    worksheet.addRow(['Generated At:', new Date(now.getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19) + ' IST']);
    worksheet.addRow([]);

    worksheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1E293B' } };
    worksheet.getCell('A2').font = { size: 13, bold: true, color: { argb: 'FF4F46E5' } };

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE A: CUSTOMER REPORT
    // Date semantics: Scoped by customer creation / activity date
    // ──────────────────────────────────────────────────────────────────────────
    if (type === 'customers') {
      const customers = await Customer.find({
        shopId,
        createdAt: { $gte: queryStart, $lte: queryEnd }
      }).sort({ createdAt: -1 }).lean();

      const custIds = customers.map(c => c.id);
      const [allEnquiries, allSales, allActivities] = await Promise.all([
        Enquiry.find({ shopId, customerId: { $in: custIds } }).lean(),
        Sale.find({ shopId, customerId: { $in: custIds } }).lean(),
        Activity.find({ shopId, customerId: { $in: custIds } }).sort({ createdAt: -1 }).lean()
      ]);

      const totalSpentAll = allSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

      worksheet.addRow(['Summary Totals']);
      worksheet.addRow(['Total Customers:', customers.length]);
      worksheet.addRow(['Total Purchases:', allSales.length]);
      worksheet.addRow(['Total Amount Spent:', totalSpentAll]);
      worksheet.addRow([]);

      worksheet.getCell('B8').numberFormat = '₹#,##0.00';

      const headerRow = worksheet.addRow([
        'Customer ID', 'Customer Name', 'Phone', 'Email',
        'Total Enquiries', 'Purchased Enquiries', 'Not Purchased Enquiries',
        'Total Purchases', 'Total Amount Spent',
        'Last Enquiry Date (IST)', 'Last Purchase Date (IST)', 'Last Activity Date (IST)'
      ]);

      headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });

      const enqByCust = new Map();
      allEnquiries.forEach(e => {
        const list = enqByCust.get(e.customerId) || [];
        list.push(e);
        enqByCust.set(e.customerId, list);
      });
      const salesByCust = new Map();
      allSales.forEach(s => {
        const list = salesByCust.get(s.customerId) || [];
        list.push(s);
        salesByCust.set(s.customerId, list);
      });
      const actByCust = new Map();
      allActivities.forEach(a => {
        if (!actByCust.has(a.customerId)) actByCust.set(a.customerId, a);
      });

      const fmtDate = (d) => d ? new Date(new Date(d).getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';

      customers.forEach(c => {
        const cEnquiries = enqByCust.get(c.id) || [];
        const cSales = salesByCust.get(c.id) || [];
        const lastAct = actByCust.get(c.id);

        const purchasedCount = cEnquiries.filter(e => e.purchaseStatus === 'Purchased').length;
        const notPurchasedCount = cEnquiries.length - purchasedCount;
        const totalSpent = cSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

        const lastEnquiry = cEnquiries.reduce((latest, e) => (!latest || new Date(e.createdAt) > new Date(latest.createdAt)) ? e : latest, null);
        const lastSale = cSales.reduce((latest, s) => (!latest || new Date(s.createdAt) > new Date(latest.createdAt)) ? s : latest, null);

        const r = worksheet.addRow([
          sanitizeSpreadsheetCell(c.id), sanitizeSpreadsheetCell(c.name), sanitizeSpreadsheetCell(c.phone || 'N/A'), sanitizeSpreadsheetCell(c.email || 'N/A'),
          cEnquiries.length, purchasedCount, notPurchasedCount,
          cSales.length, totalSpent,
          fmtDate(lastEnquiry?.createdAt), fmtDate(lastSale?.createdAt), fmtDate(lastAct?.createdAt || c.updatedAt)
        ]);

        r.getCell(9).numberFormat = '₹#,##0.00';
      });

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE B: ENQUIRY REPORT
    // Date semantics: Scoped by enquiry creation date (createdAt)
    // ──────────────────────────────────────────────────────────────────────────
    } else if (type === 'enquiries') {
      const enquiries = await Enquiry.find({
        shopId,
        createdAt: { $gte: queryStart, $lte: queryEnd }
      }).sort({ createdAt: -1 }).lean();

      const custIds = [...new Set(enquiries.map(e => e.customerId))];
      const prodIds = [...new Set(enquiries.map(e => e.productId))];
      const enqIds = enquiries.map(e => e.id);

      const [customers, products, followUps] = await Promise.all([
        Customer.find({ shopId, id: { $in: custIds } }).lean(),
        Product.find({ shopId, id: { $in: prodIds } }).lean(),
        FollowUp.find({ shopId, enquiryId: { $in: enqIds } }).lean()
      ]);

      const custMap = new Map(customers.map(c => [c.id, c]));
      const prodMap = new Map(products.map(p => [p.id, p]));
      const fwMap = new Map(followUps.map(f => [f.enquiryId, f]));

      const purchasedCount = enquiries.filter(e => e.purchaseStatus === 'Purchased').length;

      worksheet.addRow(['Summary Totals']);
      worksheet.addRow(['Total Enquiries:', enquiries.length]);
      worksheet.addRow(['Purchased Enquiries:', purchasedCount]);
      worksheet.addRow(['Not Purchased Enquiries:', enquiries.length - purchasedCount]);
      worksheet.addRow([]);

      const headerRow = worksheet.addRow([
        'Enquiry ID', 'Enquiry Date (IST)', 'Customer Name', 'Customer Phone',
        'Product Name', 'Interest Level', 'Purchase Status',
        'Follow-up Date (IST)', 'Follow-up Status', 'Notes'
      ]);

      headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });

      enquiries.forEach(e => {
        const cust = custMap.get(e.customerId);
        const prod = prodMap.get(e.productId);
        const fw = fwMap.get(e.id);

        const enqDateIST = new Date(new Date(e.createdAt).getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19);
        const fwDateIST = fw && fw.scheduledAt ? new Date(new Date(fw.scheduledAt).getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';

        worksheet.addRow([
          e.id, enqDateIST, cust ? cust.name : 'Walk-in', cust ? cust.phone : 'N/A',
          prod ? prod.name : 'General Enquiry', e.interest || 'Interested', e.purchaseStatus || 'Not Purchased',
          fwDateIST, fw ? fw.status : 'No Follow-up', e.notes || ''
        ]);
      });

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE C: FOLLOW-UP REPORT
    // Date semantics: Scoped by follow-up scheduled date (scheduledAt)
    // ──────────────────────────────────────────────────────────────────────────
    } else if (type === 'followups') {
      const followUps = await FollowUp.find({
        shopId,
        scheduledAt: { $gte: queryStart, $lte: queryEnd }
      }).sort({ scheduledAt: 1 }).lean();

      const custIds = [...new Set(followUps.map(f => f.customerId))];
      const enqIds = [...new Set(followUps.map(f => f.enquiryId).filter(Boolean))];

      const [customers, enquiries] = await Promise.all([
        Customer.find({ shopId, id: { $in: custIds } }).lean(),
        Enquiry.find({ shopId, id: { $in: enqIds } }).lean()
      ]);

      const custMap = new Map(customers.map(c => [c.id, c]));
      const enqMap = new Map(enquiries.map(e => [e.id, e]));

      const startOfToday = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0, 0) - istOffsetMs);
      const endOfToday = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59, 999) - istOffsetMs);

      let overdueCount = 0, dueTodayCount = 0, upcomingCount = 0;

      followUps.forEach(f => {
        const sTime = new Date(f.scheduledAt).getTime();
        if (f.status !== 'completed' && f.status !== 'closed') {
          if (sTime < startOfToday.getTime()) overdueCount++;
          else if (sTime >= startOfToday.getTime() && sTime <= endOfToday.getTime()) dueTodayCount++;
          else if (sTime > endOfToday.getTime()) upcomingCount++;
        }
      });

      worksheet.addRow(['Summary Totals']);
      worksheet.addRow(['Total Follow-ups:', followUps.length]);
      worksheet.addRow(['Overdue:', overdueCount]);
      worksheet.addRow(['Due Today:', dueTodayCount]);
      worksheet.addRow(['Upcoming:', upcomingCount]);
      worksheet.addRow([]);

      const headerRow = worksheet.addRow([
        'Follow-up ID', 'Customer Name', 'Customer Phone', 'Product Name',
        'Follow-up Reason', 'Scheduled Date (IST)', 'Status', 'Classification',
        'Created Date (IST)', 'Completed Date (IST)'
      ]);

      headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });

      followUps.forEach(f => {
        const cust = custMap.get(f.customerId);
        const enq = enqMap.get(f.enquiryId);

        const sTime = new Date(f.scheduledAt).getTime();
        let classification = 'OTHER';
        if (f.status === 'completed' || f.status === 'closed') {
          classification = 'COMPLETED';
        } else if (sTime < startOfToday.getTime()) {
          classification = 'OVERDUE';
        } else if (sTime >= startOfToday.getTime() && sTime <= endOfToday.getTime()) {
          classification = 'DUE TODAY';
        } else if (sTime > endOfToday.getTime()) {
          classification = 'UPCOMING';
        }

        const fmtDate = (d) => d ? new Date(new Date(d).getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19) : 'N/A';

        worksheet.addRow([
          f.id, cust ? cust.name : 'N/A', cust ? cust.phone : 'N/A',
          enq ? enq.productName || 'General' : 'General', f.reason || 'Sales Follow-up',
          fmtDate(f.scheduledAt), f.status, classification,
          fmtDate(f.createdAt), fmtDate(f.completedAt)
        ]);
      });

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE D: PRODUCT PERFORMANCE REPORT
    // Date semantics: Scoped by sales & enquiry activity dates
    // ──────────────────────────────────────────────────────────────────────────
    } else if (type === 'products') {
      const products = await Product.find({ shopId }).sort({ name: 1 }).lean();
      const enquiries = await Enquiry.find({
        shopId,
        createdAt: { $gte: queryStart, $lte: queryEnd }
      }).lean();
      const sales = await Sale.find({
        shopId,
        createdAt: { $gte: queryStart, $lte: queryEnd }
      }).lean();

      const enqStatsByProd = new Map();
      enquiries.forEach(e => {
        const cur = enqStatsByProd.get(e.productId) || { total: 0, purchased: 0 };
        cur.total += 1;
        if (e.purchaseStatus === 'Purchased') cur.purchased += 1;
        enqStatsByProd.set(e.productId, cur);
      });

      const saleStatsByProdId = new Map();
      const saleStatsByProdName = new Map();
      sales.forEach(s => {
        if (Array.isArray(s.items)) {
          s.items.forEach(item => {
            const q = item.quantity || 0;
            const rev = item.total || 0;
            if (item.productId) {
              const cur = saleStatsByProdId.get(item.productId) || { qty: 0, rev: 0 };
              cur.qty += q;
              cur.rev += rev;
              saleStatsByProdId.set(item.productId, cur);
            } else if (item.productName) {
              const cur = saleStatsByProdName.get(item.productName) || { qty: 0, rev: 0 };
              cur.qty += q;
              cur.rev += rev;
              saleStatsByProdName.set(item.productName, cur);
            }
          });
        }
      });

      let grandRevenue = 0;
      let grandQty = 0;

      const productStats = products.map(p => {
        const eStat = enqStatsByProd.get(p.id) || { total: 0, purchased: 0 };
        const sStatId = saleStatsByProdId.get(p.id) || { qty: 0, rev: 0 };
        const sStatName = saleStatsByProdName.get(p.name) || { qty: 0, rev: 0 };
        const qtySold = sStatId.qty + sStatName.qty;
        const revenue = sStatId.rev + sStatName.rev;

        grandRevenue += revenue;
        grandQty += qtySold;

        const conversionRate = eStat.total > 0
          ? Number(((eStat.purchased / eStat.total) * 100).toFixed(1))
          : 0;

        return {
          id: p.id,
          name: p.name,
          category: p.category || 'General',
          enquiries: eStat.total,
          purchasedEnquiries: eStat.purchased,
          notPurchasedEnquiries: eStat.total - eStat.purchased,
          qtySold,
          revenue,
          conversionRate
        };
      });

      worksheet.addRow(['Summary Totals']);
      worksheet.addRow(['Total Products Cataloged:', products.length]);
      worksheet.addRow(['Total Quantity Sold:', grandQty]);
      worksheet.addRow(['Total Product Revenue:', grandRevenue]);
      worksheet.addRow([]);

      worksheet.getCell('B8').numberFormat = '₹#,##0.00';

      const headerRow = worksheet.addRow([
        'Product ID', 'Product Name', 'Category', 'Total Enquiries',
        'Purchased Enquiries', 'Not Purchased Enquiries', 'Quantity Sold',
        'Total Revenue', 'Conversion Rate (%)'
      ]);

      headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });

      productStats.forEach(ps => {
        const r = worksheet.addRow([
          ps.id, ps.name, ps.category, ps.enquiries,
          ps.purchasedEnquiries, ps.notPurchasedEnquiries, ps.qtySold,
          ps.revenue, `${ps.conversionRate}%`
        ]);

        r.getCell(8).numberFormat = '₹#,##0.00';
      });

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE E: BUSINESS SUMMARY REPORT
    // Date semantics: Scoped by creation/transaction dates within IST period
    // ──────────────────────────────────────────────────────────────────────────
    } else if (type === 'summary') {
      const [customersCount, enquiries, followUps, sales] = await Promise.all([
        Customer.countDocuments({ shopId, createdAt: { $gte: queryStart, $lte: queryEnd } }),
        Enquiry.find({ shopId, createdAt: { $gte: queryStart, $lte: queryEnd } }).lean(),
        FollowUp.find({ shopId, createdAt: { $gte: queryStart, $lte: queryEnd } }).lean(),
        Sale.find({ shopId, createdAt: { $gte: queryStart, $lte: queryEnd } }).lean()
      ]);

      const totalEnquiries = enquiries.length;
      const purchasedEnquiries = enquiries.filter(e => e.purchaseStatus === 'Purchased').length;
      const notPurchasedEnquiries = totalEnquiries - purchasedEnquiries;
      const conversionRate = totalEnquiries > 0 ? Number(((purchasedEnquiries / totalEnquiries) * 100).toFixed(1)) : 0;

      const totalFollowUps = followUps.length;
      const pendingFollowUps = followUps.filter(f => f.status === 'scheduled' || f.status === 'ready' || f.status === 'snoozed').length;
      const completedFollowUps = followUps.filter(f => f.status === 'completed' || f.status === 'closed').length;

      const totalSales = sales.length;
      let totalItemsSold = 0;
      let totalRevenue = 0;

      sales.forEach(s => {
        totalRevenue += (s.totalAmount || 0);
        if (Array.isArray(s.items)) {
          s.items.forEach(i => { totalItemsSold += (i.quantity || 0); });
        }
      });

      worksheet.addRow(['Executive Key Metrics Summary']);
      worksheet.addRow([]);

      const metricsTable = [
        ['Metric Description', 'Authoritative Value'],
        ['Total New Customers', customersCount],
        ['Total Enquiries', totalEnquiries],
        ['Purchased Enquiries', purchasedEnquiries],
        ['Not Purchased Enquiries', notPurchasedEnquiries],
        ['Enquiry Conversion Rate', `${conversionRate}%`],
        ['Total Follow-ups', totalFollowUps],
        ['Pending Follow-ups', pendingFollowUps],
        ['Completed Follow-ups', completedFollowUps],
        ['Total Sales / Orders', totalSales],
        ['Total Items Sold', totalItemsSold],
        ['Total Revenue', totalRevenue]
      ];

      metricsTable.forEach((row, idx) => {
        const r = worksheet.addRow(row);
        if (idx === 0) {
          r.eachCell(c => {
            c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
          });
        } else if (idx === 11) {
          r.getCell(2).numberFormat = '₹#,##0.00';
          r.getCell(1).font = { bold: true };
          r.getCell(2).font = { bold: true };
        }
      });

    // ──────────────────────────────────────────────────────────────────────────
    // REPORT TYPE F: SALES REPORT (via unified reports endpoint)
    // ──────────────────────────────────────────────────────────────────────────
    } else if (type === 'sales') {
      const salesDocs = await Sale.find({
        shopId,
        createdAt: { $gte: queryStart, $lte: queryEnd }
      }).sort({ createdAt: -1 }).lean();

      const totalRevenue = salesDocs.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
      worksheet.addRow(['Summary Totals']);
      worksheet.addRow(['Total Bills:', salesDocs.length]);
      worksheet.addRow(['Total Revenue:', totalRevenue]);
      worksheet.addRow([]);
      worksheet.getCell('B9').numberFormat = '₹#,##0.00';

      const headerRow = worksheet.addRow([
        'Invoice #', 'Sale Date (IST)', 'Customer Name', 'Customer Phone',
        'Items Count', 'Subtotal', 'Discount', 'GST', 'Total Amount', 'Payment Method', 'Source'
      ]);
      headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      });

      salesDocs.forEach(s => {
        const saleDateIST = new Date(new Date(s.createdAt).getTime() + istOffsetMs).toISOString().replace('T', ' ').substring(0, 19);
        const r = worksheet.addRow([
          sanitizeSpreadsheetCell(s.invoiceNumber || s.id),
          saleDateIST,
          sanitizeSpreadsheetCell(s.customerName || 'Walk-in Customer'),
          sanitizeSpreadsheetCell(s.customerPhone || 'N/A'),
          Array.isArray(s.items) ? s.items.length : 0,
          s.subtotal || 0,
          s.discount || 0,
          s.totalGst || 0,
          s.totalAmount || 0,
          s.paymentMethod || 'Cash',
          s.source || 'direct'
        ]);
        [6, 7, 8, 9].forEach(colIdx => { r.getCell(colIdx).numberFormat = '₹#,##0.00'; });
      });
    }

    // Auto-fit Column Widths
    worksheet.columns.forEach(column => {
      let maxLen = 14;
      column.eachCell({ includeEmpty: false }, cell => {
        const valStr = cell.value ? String(cell.value) : '';
        if (valStr.length > maxLen && valStr.length < 55) {
          maxLen = valStr.length;
        }
      });
      column.width = maxLen + 3;
    });

    const filename = `QuickR_${type.toUpperCase()}_Report_${filenamePeriod}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export business report error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to generate business report.' });
    }
  }
});

app.get('/api/sales', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'No shop associated with user' });
    }
    const query = { shopId };

    // Staff sees ONLY sales created by that specific Staff user
    if (req.user.role === 'staff') {
      query['createdBy.userId'] = req.user.id;
    }

    const list = await Sale.find(query).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Idempotency recovery lookup for uncertain / timed-out submissions
app.get('/api/sales/status/:requestId', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'No shop associated with user' });
    }
    const cleanRequestId = asSafeString(req.params.requestId);
    if (!cleanRequestId) {
      return res.status(400).json({ error: 'Valid requestId is required' });
    }

    const query = { shopId, requestId: cleanRequestId };
    if (req.user.role === 'staff') {
      query['createdBy.userId'] = req.user.id;
    }

    const existingSale = await Sale.findOne(query).lean();
    return res.json({
      found: Boolean(existingSale),
      sale: existingSale || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify sale status' });
  }
});

app.post('/api/sales', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required to create a sale' });
    }

    const {
      customerId,
      customerName,
      customerPhone,
      enquiryId,
      followUpId,
      items,
      discount,
      discountType = 'percentage',
      totalAmount,
      paymentMethod,
      source,
      saleSource,
      campaignId,
      requestId
    } = req.body || {};

    if (!Array.isArray(items) || !items.length || totalAmount === undefined || !paymentMethod) {
      return res.status(400).json({ error: 'Items, totalAmount, and paymentMethod are required' });
    }

    const cleanRequestId = requestId && String(requestId).trim() ? String(requestId).trim() : undefined;

    // ──────────────────────────────────────────────────────────────────────────
    // IDEMPOTENCY CHECK (FIRST PASS)
    // Return existing sale if this shop already processed this requestId
    // ──────────────────────────────────────────────────────────────────────────
    if (cleanRequestId) {
      const existingSale = await Sale.findOne({ shopId, requestId: cleanRequestId }).lean();
      if (existingSale) {
        console.log(`[IDEMPOTENCY] Returned existing sale for requestId: ${cleanRequestId}`);
        return res.status(200).json({
          success: true,
          sale: existingSale,
          duplicate: true
        });
      }
    }

    const rawDiscount = discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
    if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
      return res.status(400).json({ error: 'Discount cannot be negative' });
    }

    const cleanDiscountType = discountType === 'amount' ? 'amount' : 'percentage';
    if (cleanDiscountType === 'percentage' && rawDiscount > 100) {
      return res.status(400).json({ error: 'Discount percentage cannot exceed 100%' });
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ error: 'Invalid sale item entry' });
      }
      const rawQty = Number(item.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        return res.status(400).json({ error: `Invalid quantity for ${item.productName || item.productId || 'item'}` });
      }
      if (item.rate !== undefined && item.rate !== null && item.rate !== '') {
        const rawRate = Number(item.rate);
        if (!Number.isFinite(rawRate) || rawRate < 0) {
          return res.status(400).json({ error: `Invalid unit selling price for ${item.productName || item.productId || 'item'}` });
        }
      } else if (!item.productId) {
        return res.status(400).json({ error: `Invalid rate for custom item ${item.productName || 'item'}` });
      }
    }

    // Performance measurement timing start
    const perfStart = Date.now();

    // Fetch Products & Shop in parallel
    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean).map(String))];
    const [dbProducts, shop] = await Promise.all([
      productIds.length > 0 ? Product.find({ id: { $in: productIds }, shopId }).lean() : Promise.resolve([]),
      Shop.findOne({ customId: shopId }).lean()
    ]);
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    // Validate stock and compute authoritative server-side line totals
    const requestedQtyByProduct = new Map();
    const preparedLines = [];
    let serverSubtotal = 0;

    for (const item of items) {
      const dbProd = item.productId ? productMap.get(String(item.productId)) : null;
      if (item.productId) {
        if (!dbProd) {
          return res.status(404).json({ error: `Product ${item.productName || item.productId} not found` });
        }
        if (dbProd.shopId !== shopId) {
          return res.status(403).json({ error: `Product ${dbProd.name || item.productId} does not belong to this shop` });
        }
        if (!dbProd.isActive) {
          return res.status(400).json({
            error: `Cannot complete sale: "${dbProd.name}" is inactive. Activate it before billing.`,
            inactive: true,
            productId: dbProd.id
          });
        }
      }

      const rawQty = Number(item.quantity);
      const isLengthProd = dbProd ? dbProd.measurementType === 'length' : item.measurementType === 'length';
      const sellingUnit = isLengthProd ? (item.sellingUnit === 'cm' ? 'cm' : 'm') : 'piece';

      const baseQty = (isLengthProd && sellingUnit === 'cm')
        ? Math.round((rawQty / 100) * 10000) / 10000
        : Math.round(rawQty * 10000) / 10000;

      if (baseQty <= 0) {
        return res.status(400).json({ error: `Invalid base quantity for ${item.productName || item.productId || 'item'}` });
      }

      if (dbProd) {
        requestedQtyByProduct.set(dbProd.id, Math.round(((requestedQtyByProduct.get(dbProd.id) || 0) + baseQty) * 10000) / 10000);
      }

      let trustedRate;
      if (item.rate !== undefined && item.rate !== null && item.rate !== '') {
        const customRate = Number(item.rate);
        if (!Number.isFinite(customRate) || customRate < 0) {
          return res.status(400).json({ error: `Invalid unit selling price for ${item.productName || (dbProd ? dbProd.name : 'item')}` });
        }
        trustedRate = Math.round(customRate * 100) / 100;
      } else if (dbProd) {
        trustedRate = Number(dbProd.sellingPrice);
      } else {
        return res.status(400).json({ error: `Unit selling price is required for ${item.productName || 'item'}` });
      }

      const originalCataloguePrice = dbProd
        ? Number(dbProd.sellingPrice)
        : (item.originalPrice !== undefined && item.originalPrice !== null ? Number(item.originalPrice) : trustedRate);

      const rawLineTotal = Math.round((baseQty * trustedRate) * 100) / 100;
      serverSubtotal += rawLineTotal;

      preparedLines.push({
        item,
        dbProd,
        isLengthProd,
        sellingUnit,
        rawQty,
        baseQty,
        originalCataloguePrice,
        trustedRate,
        rawLineTotal
      });
    }

    // Aggregate check across duplicate cart lines for the same product
    for (const [prodId, totalBaseReq] of requestedQtyByProduct.entries()) {
      const prod = productMap.get(prodId);
      if ((prod.availability || 0) < totalBaseReq) {
        const isLengthProd = prod.measurementType === 'length';
        const availDisplay = isLengthProd ? `${prod.availability || 0} m` : `${prod.availability || 0}`;
        const reqDisplay = isLengthProd ? `${totalBaseReq} m` : `${totalBaseReq}`;
        return res.status(400).json({
          error: `Insufficient stock for ${prod.name}. Available: ${availDisplay}, Requested: ${reqDisplay}`
        });
      }
    }

    serverSubtotal = Math.round(serverSubtotal * 100) / 100;

    let numericDiscount = 0;
    if (cleanDiscountType === 'percentage') {
      numericDiscount = Math.round(((serverSubtotal * rawDiscount) / 100) * 100) / 100;
    } else {
      if (rawDiscount > serverSubtotal) {
        return res.status(400).json({ error: 'Discount amount cannot exceed subtotal' });
      }
      numericDiscount = Math.round(rawDiscount * 100) / 100;
    }

    const isGstRegistered = !!(shop && (shop.gst?.registered ?? shop.isGstRegistered));
    const shopGstin = isGstRegistered ? (shop.gst?.gstin || shop.gstin || '') : '';
    const shopState = shop?.gst?.state || 'Tamil Nadu';
    const shopStateCode = shop?.gst?.stateCode || getStateCodeFromName(shopState);

    // Customer State / GSTIN handling (Optional)
    const { customerState, customerStateCode, customerGstin } = req.body || {};
    const finalCustState = customerState ? String(customerState).trim() : '';
    const finalCustStateCode = customerStateCode ? String(customerStateCode).trim() : (finalCustState ? getStateCodeFromName(finalCustState) : shopStateCode);
    const finalCustGstin = customerGstin ? String(customerGstin).trim().toUpperCase() : '';

    // Determine Intra-State (CGST + SGST) vs Inter-State (IGST)
    const isInterState = isGstRegistered && (finalCustStateCode !== shopStateCode);

    let calculatedTotalGst = 0;
    let calculatedTotalTaxable = 0;
    let calculatedCgst = 0;
    let calculatedSgst = 0;
    let calculatedIgst = 0;

    const processedItems = [];

    for (const line of preparedLines) {
      const { item, dbProd, isLengthProd, sellingUnit, rawQty, baseQty, originalCataloguePrice, trustedRate, rawLineTotal } = line;
      const lineTaxableSubtotal = serverSubtotal > 0
        ? (rawLineTotal * (1 - (numericDiscount / serverSubtotal)))
        : rawLineTotal;

      let itemGstRate = 0;
      let itemHsnCode = '';
      let itemPriceIncludesGst = true;

      if (dbProd) {
        itemGstRate = dbProd.gstRate || 0;
        itemHsnCode = dbProd.hsnCode || '';
        itemPriceIncludesGst = dbProd.priceIncludesGst !== undefined ? Boolean(dbProd.priceIncludesGst) : true;
      } else if (item.priceIncludesGst !== undefined) {
        itemPriceIncludesGst = Boolean(item.priceIncludesGst);
      }

      const itemGstResult = calculateGST({
        amount: lineTaxableSubtotal,
        gstRate: itemGstRate,
        priceIncludesGst: itemPriceIncludesGst,
        isInterState,
        enabled: isGstRegistered
      });

      calculatedTotalGst += itemGstResult.totalTax;
      calculatedTotalTaxable += itemGstResult.taxableAmount;
      calculatedCgst += itemGstResult.cgst;
      calculatedSgst += itemGstResult.sgst;
      calculatedIgst += itemGstResult.igst;

      processedItems.push({
        productId: item.productId || '',
        productName: item.productName || (dbProd ? dbProd.name : 'Product'),
        category: item.category || (dbProd ? dbProd.category : '') || '',
        size: item.size || (dbProd && Array.isArray(dbProd.sizes) ? dbProd.sizes.join(', ') : '') || '',
        measurementType: isLengthProd ? 'length' : 'piece',
        sellingUnit,
        baseQuantity: baseQty,
        quantity: rawQty,
        originalPrice: originalCataloguePrice,
        rate: trustedRate,
        total: rawLineTotal,
        gstRate: itemGstRate,
        gstAmount: itemGstResult.totalTax,
        hsnCode: itemHsnCode,
        priceIncludesGst: itemPriceIncludesGst,
        taxableAmount: itemGstResult.taxableAmount,
        cgst: itemGstResult.cgst,
        sgst: itemGstResult.sgst,
        igst: itemGstResult.igst,
        totalTax: itemGstResult.totalTax
      });
    }

    calculatedTotalGst = Math.round(calculatedTotalGst * 100) / 100;
    calculatedTotalTaxable = Math.round(calculatedTotalTaxable * 100) / 100;
    calculatedCgst = Math.round(calculatedCgst * 100) / 100;
    calculatedSgst = Math.round(calculatedSgst * 100) / 100;
    calculatedIgst = Math.round(calculatedIgst * 100) / 100;

    const taxType = !isGstRegistered ? 'NONE' : (isInterState ? 'IGST' : 'CGST_SGST');
    const finalTotalAmount = isGstRegistered
      ? Math.round((calculatedTotalTaxable + calculatedTotalGst) * 100) / 100
      : Math.round(Math.max(0, serverSubtotal - numericDiscount) * 100) / 100;

    // ──────────────────────────────────────────────────────────────────────────
    // WALK-IN CUSTOMER AUTO-SAVE WORKFLOW (runs after input/stock validation)
    // ──────────────────────────────────────────────────────────────────────────
    let finalCustomerId = customerId ? String(customerId).trim() : '';
    let finalCustomerName = customerName ? String(customerName).trim() : '';

    if (finalCustomerId) {
      const existingById = await Customer.findOne({ shopId, id: finalCustomerId }).lean();
      if (existingById) {
        finalCustomerId = existingById.id;
        if (!finalCustomerName) finalCustomerName = existingById.name;
      } else {
        finalCustomerId = '';
      }
    }

    if (!finalCustomerId && customerPhone && String(customerPhone).trim()) {
      const normalizedPhone = normalizeIndianMobileNumber(customerPhone);
      if (normalizedPhone) {
        const existingCust = await Customer.findOne({ shopId, phone: normalizedPhone }).lean();
        if (existingCust) {
          finalCustomerId = existingCust.id;
          if (!finalCustomerName) finalCustomerName = existingCust.name;
        } else {
          const newCustId = `CUST-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
          const displayName = finalCustomerName || normalizedPhone;

          const newCust = new Customer({
            id: newCustId,
            name: displayName,
            phone: normalizedPhone,
            email: '',
            location: shop?.address || 'Tamil Nadu',
            status: 'Active',
            shopId
          });
          await newCust.save();

          const { allowWhatsAppOffers } = req.body;
          const consentStatus = allowWhatsAppOffers === true || allowWhatsAppOffers === 'true' ? 'active' : 'withdrawn';
          await ConsentRecord.findOneAndUpdate(
            { userId: newCustId, shopId, purpose: 'marketing' },
            {
              $set: {
                status: consentStatus,
                consentedAt: consentStatus === 'active' ? new Date() : null,
                withdrawnAt: consentStatus === 'withdrawn' ? new Date() : null
              },
              $setOnInsert: {
                id: `CNS-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                userId: newCustId,
                shopId,
                purpose: 'marketing',
                noticeVersion: '1.0'
              }
            },
            { upsert: true, new: true }
          );

          Activity.create({
            id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
            customerId: newCustId,
            type: 'customer_added',
            description: `Auto-saved walk-in customer: ${displayName}`,
            shopId
          }).catch(e => console.error('Walk-in customer activity logging failed:', e));

          finalCustomerId = newCustId;
          finalCustomerName = displayName;
        }
      }
    }

    if (!finalCustomerName) {
      finalCustomerName = 'Walk-in Customer';
    }

    // Generate atomic per-shop Invoice Number & unique Sale ID
    let invoiceNumber = await allocateNextInvoiceNumber(shopId);
    const saleId = `SALE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const salePayload = {
      id: saleId,
      invoiceNumber,
      customerId: finalCustomerId,
      customerName: finalCustomerName,
      customerPhone: customerPhone ? String(customerPhone).trim() : undefined,
      customerState: finalCustState,
      customerStateCode: finalCustStateCode,
      customerGstin: finalCustGstin,
      enquiryId: enquiryId || '',
      followUpId: followUpId || '',
      items: processedItems,
      subtotal: serverSubtotal,
      discount: numericDiscount,
      discountType: cleanDiscountType,
      totalGst: isGstRegistered ? calculatedTotalGst : 0,
      totalAmount: finalTotalAmount,
      isGstRegistered,
      gstin: shopGstin,
      gst: {
        enabled: isGstRegistered,
        rate: processedItems.length === 1 ? (processedItems[0].gstRate || 0) : 0,
        taxableAmount: calculatedTotalTaxable,
        cgst: calculatedCgst,
        sgst: calculatedSgst,
        igst: calculatedIgst,
        totalTax: calculatedTotalGst,
        taxType
      },
      paymentMethod,
      source: source || 'direct',
      saleSource: saleSource || (campaignId ? 'campaign' : 'normal'),
      campaignId: campaignId || '',
      createdBy: {
        userId: req.user.id,
        name: req.user.name || 'User',
        role: req.user.role || 'staff'
      },
      shopId
    };
    if (cleanRequestId) {
      salePayload.requestId = cleanRequestId;
    }

    let newSale = new Sale(salePayload);

    // ──────────────────────────────────────────────────────────────────────────
    // TRANSACTION & ATOMIC STOCK CONCURRENCY
    // Deduct stock BEFORE saving Sale so failed stock checks never commit orphan
    // sales even on standalone MongoDB without replica-set transactions.
    // ──────────────────────────────────────────────────────────────────────────
    for (let invAttempt = 0; invAttempt < 2; invAttempt++) {
      let session = null;
      let useTransaction = false;

      try {
        session = await mongoose.startSession();
        if (session && session.supports.transactions) {
          session.startTransaction();
          useTransaction = true;
        } else if (session) {
          await session.endSession();
          session = null;
        }
      } catch (txInitErr) {
        if (session) {
          try { await session.endSession(); } catch (e) {}
        }
        session = null;
        useTransaction = false;
      }

      const decrementedProducts = [];

      try {
        const saveOptions = (useTransaction && session) ? { session } : {};

        // Perform atomic conditional stock decrement per unique product FIRST
        for (const [prodId, decQty] of requestedQtyByProduct.entries()) {
          const updateResult = await Product.updateOne(
            { id: prodId, shopId, availability: { $gte: decQty } },
            { $inc: { availability: -decQty } },
            saveOptions
          );

          if (updateResult.matchedCount === 0) {
            const currentProd = await Product.findOne({ id: prodId, shopId }).select('name availability').lean();
            const currentAvail = currentProd ? currentProd.availability : 0;
            const prodName = currentProd?.name || productMap.get(prodId)?.name || prodId;
            throw new Error(`INSUFFICIENT_STOCK: Stock changed during checkout for ${prodName}. Available: ${currentAvail}, Requested: ${decQty}`);
          }
          decrementedProducts.push({ prodId, decQty });
        }

        await newSale.save(saveOptions);

        if (enquiryId) {
          await Enquiry.findOneAndUpdate({ id: enquiryId, shopId }, { purchaseStatus: 'Purchased' }, saveOptions);
        }

        if (followUpId) {
          await FollowUp.findOneAndUpdate({ id: followUpId, shopId }, { status: 'closed', outcome: 'Purchased', completedAt: new Date() }, saveOptions);
        }

        if (useTransaction && session) {
          await session.commitTransaction();
        }
        break;
      } catch (saveErr) {
        if (useTransaction && session) {
          await session.abortTransaction();
        } else if (decrementedProducts.length > 0) {
          // Manual compensating rollback for standalone MongoDB
          for (const dec of decrementedProducts) {
            await Product.updateOne(
              { id: dec.prodId, shopId },
              { $inc: { availability: dec.decQty } }
            ).catch(rbErr => console.error('Stock rollback failed:', dec.prodId, rbErr));
          }
        }

        // Handle MongoDB Duplicate Key (E11000) race condition for requestId
        if (saveErr.code === 11000 && cleanRequestId) {
          const existingSale = await Sale.findOne({ shopId, requestId: cleanRequestId }).lean();
          if (existingSale) {
            console.warn(`[IDEMPOTENCY] Race condition caught by MongoDB unique index for requestId: ${cleanRequestId}`);
            return res.status(200).json({
              success: true,
              sale: existingSale,
              duplicate: true
            });
          }
        }

        // Recover once if an unseeded historical invoice collided on { shopId, invoiceNumber }
        const isInvoiceDup = saveErr.code === 11000 && (saveErr.keyPattern?.invoiceNumber || saveErr.message?.includes('invoiceNumber'));
        if (isInvoiceDup && invAttempt === 0) {
          console.warn(`[INVOICE COUNTER SYNC] Repairing sequence after collision for shop ${shopId}`);
          await ensureInvoiceCounterInitialized(shopId);
          invoiceNumber = await allocateNextInvoiceNumber(shopId);
          salePayload.invoiceNumber = invoiceNumber;
          newSale = new Sale(salePayload);
          continue;
        }

        if (saveErr.message && saveErr.message.startsWith('INSUFFICIENT_STOCK:')) {
          return res.status(400).json({ error: saveErr.message.replace('INSUFFICIENT_STOCK: ', '') });
        }

        throw saveErr;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    // Helper for reliable customer statistics recalculation via aggregation
    const recalculateCustomerStats = async (custId, sId) => {
      try {
        const [stats] = await Sale.aggregate([
          { $match: { customerId: custId, shopId: sId } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalSpend: { $sum: { $ifNull: ['$totalAmount', 0] } },
              lastCreatedAt: { $max: '$createdAt' }
            }
          }
        ]);
        const count = stats?.count || 0;
        const totalSpend = Math.round((stats?.totalSpend || 0) * 100) / 100;
        const lastPurchaseStr = stats?.lastCreatedAt ? new Date(stats.lastCreatedAt).toISOString() : '';

        await Customer.updateOne(
          { id: custId, shopId: sId },
          {
            $set: {
              totalPurchases: count,
              totalSpending: totalSpend,
              'preferences.lastPurchase': lastPurchaseStr
            }
          }
        );
      } catch (e) {
        console.error('Customer stats recalculation error:', e);
      }
    };

    if (finalCustomerId) {
      recalculateCustomerStats(finalCustomerId, shopId);
    }

    const totalDuration = Date.now() - perfStart;
    console.log(`[PERF] POST /api/sales - total: ${totalDuration}ms`);

    Activity.create({
      id: `ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      customerId: finalCustomerId || 'walk-in',
      type: 'sale_completed',
      description: `Bill generated: ${newSale.invoiceNumber} for ₹${finalTotalAmount}`,
      shopId
    }).catch(e => console.error('Background activity logging failed:', e));

    res.status(201).json({ success: true, sale: newSale, duplicate: false });

  } catch (err) {
    console.error('Failed to create bill/sale:', err);
    res.status(500).json({ error: 'Failed to create bill/sale' });
  }
});


app.delete('/api/sales', requireAuth, requireNonStaff, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ success: false, error: 'Shop context required' });
    }

    let rawBody = req.body;
    if (typeof rawBody === 'string') {
      try { rawBody = JSON.parse(rawBody); } catch (e) {}
    }
    const rawIds = rawBody?.ids || (rawBody?.id ? [rawBody.id] : null) || (req.query?.id ? [req.query.id] : null) || (req.query?.ids ? String(req.query.ids).split(',') : null);
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))]
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'A non-empty array of sale IDs is required.' });
    }

    // Atomically claim and delete each sale BEFORE restoring stock to prevent double-restoration under concurrency
    const deletedSales = [];
    for (const saleId of ids) {
      const deletedSale = await Sale.findOneAndDelete({ id: saleId, shopId }).lean();
      if (deletedSale) {
        deletedSales.push(deletedSale);
        if (Array.isArray(deletedSale.items) && deletedSale.items.length > 0) {
          for (const item of deletedSale.items) {
            if (item.productId) {
              const restoreQty = Number(item.baseQuantity) || Number(item.quantity) || 0;
              if (restoreQty > 0) {
                await Product.updateOne(
                  { id: item.productId, shopId },
                  { $inc: { availability: restoreQty } }
                );
              }
            }
          }
        }
      }
    }

    if (deletedSales.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching sales found for your shop.' });
    }

    const deletedIds = deletedSales.map(s => s.id);
    const affectedCustIds = [...new Set(deletedSales.map(s => s.customerId).filter(Boolean))];

    // Recalculate purchase count & total spending for affected customers via aggregation
    for (const cId of affectedCustIds) {
      const [stats] = await Sale.aggregate([
        { $match: { customerId: cId, shopId } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalSpend: { $sum: { $ifNull: ['$totalAmount', 0] } },
            lastCreatedAt: { $max: '$createdAt' }
          }
        }
      ]);
      await Customer.updateOne(
        { id: cId, shopId },
        {
          $set: {
            totalPurchases: stats?.count || 0,
            totalSpending: Math.round((stats?.totalSpend || 0) * 100) / 100,
            'preferences.lastPurchase': stats?.lastCreatedAt ? new Date(stats.lastCreatedAt).toISOString() : ''
          }
        }
      );
    }

    res.json({
      success: true,
      message: `Successfully deleted ${deletedIds.length} sale(s).`,
      deletedIds
    });
  } catch (err) {
    console.error('Delete sales error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete sales' });
  }
});

app.get('/api/activities', requireAuth, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 200;
    const list = await Activity.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});
// Delete Enquiry endpoint with safe cascade
app.delete('/api/enquiries/:id', requireAuth, requireNonStaff, async (req, res) => {
  try {
    if (!req.user.shopId) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const enquiryId = req.params.id;
    // Find and delete the enquiry belonging to the shop
    const enquiry = await Enquiry.findOneAndDelete({ id: enquiryId, shopId: req.user.shopId }).lean();
    if (!enquiry) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    // Delete any active follow-ups related to this enquiry
    await FollowUp.deleteMany({
      enquiryId,
      shopId: req.user.shopId,
      status: { $in: ['ready', 'sent', 'scheduled'] }
    });

    // NOTE: Do NOT delete related sales, messages, or activities to preserve business history

    res.json({ success: true, deletedEnquiryId: enquiryId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete enquiry' });
  }
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const shopId = req.user.shopId;
    if (!shopId) {
      return res.status(403).json({ error: 'Shop context required for dashboard metrics' });
    }

    const isStaff = req.user.role === 'staff';
    const { startOfToday, endOfToday } = getISTDayBounds();

    const [
      activeFollowUpsCount,
      overdueFollowUpsCount,
      todayFollowUpsCount,
      upcomingFollowUpsCount,
      totalEnquiriesCount,
      todayEnquiriesCount,
      todayPurchasedEnquiriesCount,
      todaySalesAgg,
      totalCustomersCount,
      totalProductsCount,
      recoveredSalesAgg,
      completedFwCount,
      totalOutreachFwCount
    ] = await Promise.all([
      FollowUp.countDocuments({ shopId, status: { $in: ['ready', 'sent', 'scheduled', 'snoozed'] } }),
      FollowUp.countDocuments({ shopId, status: { $in: ['ready', 'scheduled', 'snoozed'] }, scheduledAt: { $lt: startOfToday } }),
      FollowUp.countDocuments({ shopId, status: { $in: ['ready', 'scheduled', 'snoozed'] }, scheduledAt: { $gte: startOfToday, $lte: endOfToday } }),
      FollowUp.countDocuments({ shopId, status: { $in: ['ready', 'scheduled', 'snoozed'] }, scheduledAt: { $gt: endOfToday } }),
      Enquiry.countDocuments({ shopId }),
      Enquiry.countDocuments({ shopId, createdAt: { $gte: startOfToday, $lte: endOfToday } }),
      isStaff ? Promise.resolve(0) : Enquiry.countDocuments({ shopId, createdAt: { $gte: startOfToday, $lte: endOfToday }, purchaseStatus: 'Purchased' }),
      isStaff ? Promise.resolve([]) : Sale.aggregate([
        { $match: { shopId, createdAt: { $gte: startOfToday, $lte: endOfToday } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ]),
      Customer.countDocuments({ shopId }),
      Product.countDocuments({ shopId }),
      isStaff ? Promise.resolve([]) : Sale.aggregate([
        { $match: { shopId, source: 'quickr_followup' } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ]),
      FollowUp.countDocuments({ shopId, status: { $in: ['completed', 'closed'] } }),
      FollowUp.countDocuments({ shopId, status: { $in: ['sent', 'completed', 'closed'] } })
    ]);

    const todaySalesCount = todaySalesAgg[0]?.count || 0;
    const todayRevenue = Math.round((todaySalesAgg[0]?.revenue || 0) * 100) / 100;
    const recoveredSalesAmount = Math.round((recoveredSalesAgg[0]?.revenue || 0) * 100) / 100;
    const conversionsCount = recoveredSalesAgg[0]?.count || 0;
    const conversionRate = completedFwCount > 0 ? Math.min(100, Math.round((conversionsCount / completedFwCount) * 100)) : 0;
    const responseRate = totalOutreachFwCount > 0 ? Math.min(100, Math.round((completedFwCount / totalOutreachFwCount) * 100)) : 0;

    res.json({
      // Today Specific Metrics (IST) - Hidden for Staff
      todaySalesCount: isStaff ? undefined : todaySalesCount,
      todayRevenue: isStaff ? undefined : todayRevenue,
      todayEnquiriesCount,
      todayPurchasesCount: isStaff ? undefined : todayPurchasedEnquiriesCount,
      todayFollowUpsCount,

      // Follow-up Breakdown
      activeFollowUps: activeFollowUpsCount,
      overdueFollowUps: overdueFollowUpsCount,
      upcomingFollowUps: upcomingFollowUpsCount,
      pendingFollowUps: activeFollowUpsCount,

      // Total Shop Catalog & CRM Metrics
      totalCustomers: totalCustomersCount,
      totalProducts: totalProductsCount,
      totalEnquiries: totalEnquiriesCount,

      // Historical Conversions & Follow-Up Outcomes - Hidden for Staff
      recoveredSales: isStaff ? undefined : recoveredSalesAmount,
      conversions: isStaff ? undefined : conversionsCount,
      conversionRate: isStaff ? undefined : conversionRate,
      responseRate
    });
  } catch (err) {
    console.error('Dashboard metrics error:', err);
    res.status(500).json({ error: 'Failed to calculate dashboard analytics' });
  }
});

// ===================================
// ADMIN & INTEGRATION ROUTES
// ===================================
app.use('/api/admin', adminRouter);
app.use('/api/ai', aiRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/privacy', privacyRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api/reengagement', reengagementRouter);

// Unmatched API routes return clean JSON 404 instead of HTML
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// Centralized Global Express Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[GLOBAL SERVER ERROR]:', err.message || err);

  if (res.headersSent) {
    return next(err);
  }

  // Handle CORS errors specifically
  if (err.message === 'Not allowed by CORS origin policy') {
    return res.status(403).json({ success: false, error: 'Access denied: Origin not allowed by CORS policy' });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    success: false,
    error: isProduction ? 'Something went wrong. Please try again.' : (err.message || 'Internal Server Error')
  });
});

let campaignCleanupInterval = null;
let storageCleanupInterval = null;
let server = null;

if (!IS_TEST_IMPORT) {
  server = app.listen(PORT, () => {
    console.log(`🚀 QuickR API Server running on port ${PORT}`);

    // Background campaign media cleanup on server start and every 6 hours
    import('./routes/campaigns.js').then(({ cleanupExpiredCampaignMedia }) => {
      cleanupExpiredCampaignMedia();
      campaignCleanupInterval = setInterval(() => {
        cleanupExpiredCampaignMedia();
      }, 6 * 60 * 60 * 1000);
      campaignCleanupInterval.unref();
    }).catch(() => {});

    // Background campaign worker recovery (resumes interrupted campaigns safely)
    import('./services/campaignWorker.js').then(({ initWorkerRecovery }) => {
      initWorkerRecovery();
    }).catch(() => {});

    // Background 90-day storage cleanup runner (processes approved shop cleanups)
    import('./services/storageCleanupService.js').then(({ runScheduledStorageCleanup }) => {
      runScheduledStorageCleanup();
      storageCleanupInterval = setInterval(() => {
        runScheduledStorageCleanup();
      }, 6 * 60 * 60 * 1000);
      storageCleanupInterval.unref();
    }).catch(() => {});
  });
}

// Graceful Shutdown Handlers (SIGTERM & SIGINT)
let isShuttingDown = false;

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  if (campaignCleanupInterval) {
    clearInterval(campaignCleanupInterval);
    campaignCleanupInterval = null;
  }
  if (storageCleanupInterval) {
    clearInterval(storageCleanupInterval);
    storageCleanupInterval = null;
  }

  const finishClose = async () => {
    console.log('🔒 HTTP server closed to new connections.');
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('🍃 MongoDB connection closed cleanly.');
      }
    } catch (err) {
      console.error('Error during MongoDB closure:', err.message);
    }
    console.log('👋 QuickR Backend graceful shutdown complete.');
    process.exit(0);
  };

  if (server) {
    server.close(finishClose);
  } else {
    finishClose();
  }

  // Force shutdown after 10 seconds timeout if requests hang
  setTimeout(() => {
    console.error('⚠️ Could not close connections in time, forcing exit.');
    process.exit(1);
  }, 10000).unref();
};

if (!IS_TEST_IMPORT) {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED PROMISE REJECTION]:', reason instanceof Error ? reason.stack || reason.message : reason);
  });
}

export { app };

