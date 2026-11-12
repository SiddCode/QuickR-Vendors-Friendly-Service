import mongoose from 'mongoose';
import {
  assertSafeTestDatabaseConfig,
  assertSafeConnectedTestTarget,
  sanitizeMongoErrorText
} from '../backend/utils/mongoSafety.js';
import { User } from '../backend/models/User.js';
import { Shop } from '../backend/models/Shop.js';
import { Customer } from '../backend/models/Customer.js';
import { Product } from '../backend/models/Product.js';
import { Enquiry } from '../backend/models/Enquiry.js';
import { FollowUp } from '../backend/models/FollowUp.js';
import { Message } from '../backend/models/Message.js';
import { Sale } from '../backend/models/Sale.js';
import { Activity } from '../backend/models/Activity.js';
import { SubscriptionRequest } from '../backend/models/SubscriptionRequest.js';
import { ConsentRecord } from '../backend/models/ConsentRecord.js';
import { Campaign } from '../backend/models/Campaign.js';
import { CampaignRecipient } from '../backend/models/CampaignRecipient.js';
import { CampaignResponse } from '../backend/models/CampaignResponse.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_UPLOADS_DIR = path.join(__dirname, '../backend/uploads/temp_campaign_media');

async function countAllRecords() {
  const [
    shops, users, customers, products, sales, enquiries,
    followUps, campaigns, campaignRecipients, campaignResponses, consentRecords
  ] = await Promise.all([
    Shop.countDocuments(),
    User.countDocuments(),
    Customer.countDocuments(),
    Product.countDocuments(),
    Sale.countDocuments(),
    Enquiry.countDocuments(),
    FollowUp.countDocuments(),
    Campaign.countDocuments(),
    CampaignRecipient.countDocuments(),
    CampaignResponse.countDocuments(),
    ConsentRecord.countDocuments()
  ]);

  return {
    shops,
    users,
    customers,
    products,
    sales,
    enquiries,
    followUps,
    campaigns,
    campaignRecipients,
    campaignResponses,
    consentRecords
  };
}

async function runCleanup() {
  console.log('\n====================================================');
  console.log('🧹 QuickR — Isolated Test Database Cleanup');
  console.log('====================================================\n');

  const safeTarget = assertSafeTestDatabaseConfig({
    scriptName: 'cleanupAllTestShops.js',
    argv: process.argv.slice(2),
    suggestedTestDb: 'quickr_test',
    backendEnvPath: path.resolve(__dirname, '../backend/.env'),
    requireWipeConfirmation: true,
    disallowSharedDevDb: true,
    allowStagingDbIfConfirmed: false
  });

  const conn = await mongoose.connect(safeTarget.uri, { serverSelectionTimeoutMS: 5000 });
  assertSafeConnectedTestTarget(conn, safeTarget, { operation: 'cascade test data cleanup' });

  try {
    const beforeCounts = await countAllRecords();

    console.log('BEFORE CLEANUP RECORDS COUNT:');
    console.log('------------------------------------');
    console.log(`Shops:               ${beforeCounts.shops}`);
    console.log(`Users:               ${beforeCounts.users}`);
    console.log(`Customers:           ${beforeCounts.customers}`);
    console.log(`Products:            ${beforeCounts.products}`);
    console.log(`Sales:               ${beforeCounts.sales}`);
    console.log(`Enquiries:           ${beforeCounts.enquiries}`);
    console.log(`Follow-ups:          ${beforeCounts.followUps}`);
    console.log(`Campaigns:           ${beforeCounts.campaigns}`);
    console.log(`Campaign Recipients: ${beforeCounts.campaignRecipients}`);
    console.log(`Campaign Responses:  ${beforeCounts.campaignResponses}`);
    console.log(`Consent Records:     ${beforeCounts.consentRecords}`);
    console.log('------------------------------------\n');

    console.log(`🚀 Verified isolated test DB "${safeTarget.expectedDbName}". Executing cascade deletion...\n`);

    // Cascade delete all shop-linked records
    await Promise.all([
      Shop.deleteMany({}),
      User.deleteMany({ role: { $ne: 'admin' } }), // Preserve platform admin account
      Customer.deleteMany({}),
      Product.deleteMany({}),
      Sale.deleteMany({}),
      Enquiry.deleteMany({}),
      FollowUp.deleteMany({}),
      Message.deleteMany({}),
      Activity.deleteMany({ customerId: { $ne: 'SYSTEM' } }),
      SubscriptionRequest.deleteMany({}),
      ConsentRecord.deleteMany({}),
      Campaign.deleteMany({}),
      CampaignRecipient.deleteMany({}),
      CampaignResponse.deleteMany({})
    ]);

    // Clean temporary campaign media files
    let mediaCleanedCount = 0;
    if (fs.existsSync(TEMP_UPLOADS_DIR)) {
      const files = fs.readdirSync(TEMP_UPLOADS_DIR);
      for (const file of files) {
        if (file !== '.gitkeep') {
          fs.unlinkSync(path.join(TEMP_UPLOADS_DIR, file));
          mediaCleanedCount++;
        }
      }
    }

    const afterCounts = await countAllRecords();

    console.log('AFTER CLEANUP RECORDS COUNT:');
    console.log('------------------------------------');
    console.log(`Shops:               ${afterCounts.shops}`);
    console.log(`Non-Admin Users:     ${afterCounts.users}`);
    console.log(`Customers:           ${afterCounts.customers}`);
    console.log(`Products:            ${afterCounts.products}`);
    console.log(`Sales:               ${afterCounts.sales}`);
    console.log(`Enquiries:           ${afterCounts.enquiries}`);
    console.log(`Follow-ups:          ${afterCounts.followUps}`);
    console.log(`Campaigns:           ${afterCounts.campaigns}`);
    console.log(`Campaign Recipients: ${afterCounts.campaignRecipients}`);
    console.log(`Campaign Responses:  ${afterCounts.campaignResponses}`);
    console.log(`Consent Records:     ${afterCounts.consentRecords}`);
    console.log(`Temporary Media:     ${mediaCleanedCount} files removed`);
    console.log('------------------------------------\n');

    console.log('✨ Isolated test database cleanup complete!');
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(0);
}

runCleanup().catch(err => {
  console.error('Cleanup failed:', sanitizeMongoErrorText(err?.message || String(err)));
  process.exit(1);
});
