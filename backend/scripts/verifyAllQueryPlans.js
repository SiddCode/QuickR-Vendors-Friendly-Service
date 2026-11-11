import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { connectDB } from '../config/database.js';
import { User } from '../models/User.js';
import { Shop } from '../models/Shop.js';
import { Customer } from '../models/Customer.js';
import { Product } from '../models/Product.js';
import { Enquiry } from '../models/Enquiry.js';
import { FollowUp } from '../models/FollowUp.js';
import { Sale } from '../models/Sale.js';
import { Message } from '../models/Message.js';
import { Activity } from '../models/Activity.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { OtpVerification } from '../models/OtpVerification.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';

function summarizePlan(explainOut) {
  const winPlan = explainOut?.queryPlanner?.winningPlan || {};
  const exec = explainOut?.executionStats || {};

  const stages = [];
  const indexNames = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.stage) stages.push(node.stage);
    if (node.indexName) indexNames.push(node.indexName);
    if (node.inputStage) walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
  };
  walk(winPlan);

  return {
    stages: stages.join(' -> '),
    indexes: indexNames.join(', ') || 'NONE',
    hasCollscan: stages.includes('COLLSCAN'),
    nReturned: exec.nReturned ?? 0,
    totalKeysExamined: exec.totalKeysExamined ?? 0,
    totalDocsExamined: exec.totalDocsExamined ?? 0,
    executionTimeMillis: exec.executionTimeMillis ?? 0
  };
}

async function main() {
  const conn = await connectDB();
  if (!conn) {
    console.error('MongoDB connection unavailable. Set MONGODB_URI and re-run outside sandbox.');
    process.exit(1);
  }

  const sampleShopId = 'DEMO_SHOP';
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const checks = [
    { name: 'User email lookup', run: () => User.find({ email: 'owner@demo.com' }).explain('executionStats') },
    { name: 'User shop membership', run: () => User.find({ id: 'USR-1', shopId: sampleShopId }).explain('executionStats') },
    { name: 'Shop customId lookup', run: () => Shop.find({ customId: sampleShopId }).explain('executionStats') },
    { name: 'Customer shop list sort', run: () => Customer.find({ shopId: sampleShopId }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'Customer phone lookup', run: () => Customer.find({ shopId: sampleShopId, phone: '9876543210' }).explain('executionStats') },
    { name: 'Product active shop list', run: () => Product.find({ shopId: sampleShopId, isActive: true }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'Product barcode lookup', run: () => Product.find({ shopId: sampleShopId, barcode: 'QKR-1234' }).explain('executionStats') },
    { name: 'Enquiry shop list sort', run: () => Enquiry.find({ shopId: sampleShopId }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'FollowUp work queue filter', run: () => FollowUp.find({ shopId: sampleShopId, status: { $in: ['ready', 'scheduled'] } }).sort({ scheduledAt: 1 }).explain('executionStats') },
    { name: 'Sale shop list sort', run: () => Sale.find({ shopId: sampleShopId }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'Sale followup attribution', run: () => Sale.find({ shopId: sampleShopId, source: 'quickr_followup' }).explain('executionStats') },
    { name: 'Sale product buyers filter', run: () => Sale.find({ shopId: sampleShopId, 'items.productId': 'PROD-1' }).explain('executionStats') },
    { name: 'Sale idempotency check', run: () => Sale.find({ shopId: sampleShopId, requestId: 'REQ-1' }).explain('executionStats') },
    { name: 'Message webhook lookup', run: () => Message.find({ providerMessageId: 'wamid.test' }).explain('executionStats') },
    { name: 'Activity shop feed', run: () => Activity.find({ shopId: sampleShopId }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'Consent marketing lookup', run: () => ConsentRecord.find({ userId: 'CUST-1', shopId: sampleShopId, purpose: 'marketing' }).explain('executionStats') },
    { name: 'OTP recent lookup', run: () => OtpVerification.find({ phone: '9876543210' }).sort({ createdAt: -1 }).explain('executionStats') },
    { name: 'CampaignRecipient status', run: () => CampaignRecipient.find({ shopId: sampleShopId, campaignId: 'CMP-1', status: 'SENT' }).explain('executionStats') },
    { name: 'FollowUp 30d cleanup', run: () => FollowUp.find({ shopId: sampleShopId, status: { $in: ['completed', 'closed'] }, createdAt: { $lte: thirtyDaysAgo } }).explain('executionStats') }
  ];

  let collscanCount = 0;
  for (const check of checks) {
    const raw = await check.run();
    const summary = summarizePlan(raw);
    if (summary.hasCollscan) collscanCount++;
    console.log(
      `${summary.hasCollscan ? '[WARN COLLSCAN]' : '[OK INDEXED]'} ${check.name.padEnd(28)} | ` +
      `index=${summary.indexes} | stage=${summary.stages} | keys=${summary.totalKeysExamined} | docs=${summary.totalDocsExamined} | ${summary.executionTimeMillis}ms`
    );
  }

  await mongoose.connection.close(false);
  console.log(`\nCompleted ${checks.length} explain checks. COLLSCAN warnings: ${collscanCount}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Query plan verification failed:', err);
  process.exit(1);
});
