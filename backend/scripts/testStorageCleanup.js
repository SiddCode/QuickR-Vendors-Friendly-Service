import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connectDB } from '../config/database.js';
import { Customer } from '../models/Customer.js';
import { Product } from '../models/Product.js';
import { Enquiry } from '../models/Enquiry.js';
import { FollowUp } from '../models/FollowUp.js';
import { Activity } from '../models/Activity.js';
import { Sale } from '../models/Sale.js';
import { StorageCleanupSetting } from '../models/StorageCleanupSetting.js';
import { getCleanupMetrics, executeShopCleanup } from '../services/storageCleanupService.js';

const runTests = async () => {
  console.log('🧪 Starting Storage Cleanup System Tests...');
  await connectDB();

  const testShopA = 'test-shop-storage-a';
  const testShopB = 'test-shop-storage-b';

  // Cleanup test documents from previous runs
  await Enquiry.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await FollowUp.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Activity.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Customer.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Product.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Sale.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await StorageCleanupSetting.deleteMany({ shopId: { $in: [testShopA, testShopB] } });

  const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);

  // Seed test records
  const cust = await Customer.create({ id: 'CUST-TEST-1', name: 'Test Customer', phone: '+919999900000', shopId: testShopA });
  const prod = await Product.create({ id: 'PROD-TEST-1', name: 'Test Product', sellingPrice: 999, category: 'Shirts', shopId: testShopA });
  const sale = await Sale.create({ id: 'SALE-TEST-1', invoiceNumber: 'INV-TEST-1', customerId: cust.id, items: [{ productId: prod.id, productName: prod.name, quantity: 1, rate: 999, total: 999 }], subtotal: 999, totalAmount: 999, paymentMethod: 'Cash', shopId: testShopA, createdAt: ninetyFiveDaysAgo });

  // 1. Old Closed Enquiry (35 days old)
  const oldClosedEnq = await Enquiry.create({ id: 'ENQ-OLD-CLOSED', customerId: cust.id, productId: prod.id, size: 'M', color: 'Black', purchaseStatus: 'Purchased', shopId: testShopA, createdAt: thirtyFiveDaysAgo });

  // 2. Old Active FollowUp (35 days old, status 'ready')
  const oldActiveFW = await FollowUp.create({ id: 'FW-OLD-ACTIVE', customerId: cust.id, enquiryId: oldClosedEnq.id, reason: 'Active test', scheduledAt: thirtyFiveDaysAgo, status: 'ready', message: 'Test', shopId: testShopA, createdAt: thirtyFiveDaysAgo });

  // 3. 95-day Closed Enquiry & FollowUp
  const ancientClosedEnq = await Enquiry.create({ id: 'ENQ-95-CLOSED', customerId: cust.id, productId: prod.id, size: 'L', color: 'White', purchaseStatus: 'Purchased', shopId: testShopA, createdAt: ninetyFiveDaysAgo });
  const ancientClosedFW = await FollowUp.create({ id: 'FW-95-CLOSED', customerId: cust.id, enquiryId: ancientClosedEnq.id, reason: 'Closed test', scheduledAt: ninetyFiveDaysAgo, status: 'closed', message: 'Test', shopId: testShopA, createdAt: ninetyFiveDaysAgo });

  // 4. Shop B document (95 days old closed)
  const shopBEnq = await Enquiry.create({ id: 'ENQ-SHOP-B', customerId: 'CUST-B', productId: 'PROD-B', size: 'S', color: 'Blue', purchaseStatus: 'Purchased', shopId: testShopB, createdAt: ninetyFiveDaysAgo });

  console.log('\n--- TEST 1: Check 30-day Eligibility & Status Protection ---');
  let metricsA = await getCleanupMetrics(testShopA);
  console.log(`Shop A Eligible Enquiries: ${metricsA.eligibleEnquiries} (Expected: 2 -> ENQ-OLD-CLOSED and ENQ-95-CLOSED)`);
  console.log(`Shop A Eligible FollowUps: ${metricsA.eligibleFollowUps} (Expected: 1 -> FW-95-CLOSED; FW-OLD-ACTIVE protected)`);
  if (metricsA.eligibleEnquiries === 2 && metricsA.eligibleFollowUps === 1) {
    console.log('✅ TEST 1 PASSED');
  } else {
    console.error('❌ TEST 1 FAILED');
  }

  console.log('\n--- TEST 2: Attempt Execution Without Owner Approval ---');
  let resultNoApprove = await executeShopCleanup(testShopA);
  console.log(`Executed: ${resultNoApprove.executed} | Reason: ${resultNoApprove.reason}`);
  const enqCountPre = await Enquiry.countDocuments({ shopId: testShopA });
  if (!resultNoApprove.executed && enqCountPre === 2) {
    console.log('✅ TEST 2 PASSED (No documents deleted without approval)');
  } else {
    console.error('❌ TEST 2 FAILED');
  }

  console.log('\n--- TEST 3: Approve Cleanup & Run 90-Day Deletion ---');
  await StorageCleanupSetting.create({
    shopId: testShopA,
    status: 'APPROVED',
    approvedAt: new Date(),
    approvedByUserId: 'USER-TEST-1'
  });

  let resultApproved = await executeShopCleanup(testShopA);
  console.log(`Executed: ${resultApproved.executed} | Deleted Enquiries: ${resultApproved.deletedEnquiries} | Deleted FollowUps: ${resultApproved.deletedFollowUps}`);

  const remainingEnqA = await Enquiry.find({ shopId: testShopA });
  const remainingFWA = await FollowUp.find({ shopId: testShopA });
  const shopBEnqExists = await Enquiry.findOne({ id: 'ENQ-SHOP-B' });
  const custExists = await Customer.findOne({ id: cust.id });
  const saleExists = await Sale.findOne({ id: sale.id });

  console.log(`Remaining Shop A Enquiries: ${remainingEnqA.length} (Expected: 1 -> ENQ-OLD-CLOSED kept because age < 90 days)`);
  console.log(`Remaining Shop A FollowUps: ${remainingFWA.length} (Expected: 1 -> FW-OLD-ACTIVE kept because status=ready)`);
  console.log(`Shop B Enquiry Exists: ${Boolean(shopBEnqExists)} (Expected: true -> Shop B isolated)`);
  console.log(`Linked Customer Exists: ${Boolean(custExists)} (Expected: true -> Customer never deleted)`);
  console.log(`95-Day Sale Exists: ${Boolean(saleExists)} (Expected: true -> Sales never deleted)`);

  if (
    remainingEnqA.length === 1 &&
    remainingEnqA[0].id === 'ENQ-OLD-CLOSED' &&
    remainingFWA.length === 1 &&
    remainingFWA[0].id === 'FW-OLD-ACTIVE' &&
    shopBEnqExists &&
    custExists &&
    saleExists
  ) {
    console.log('✅ TEST 3, 4, 5, 6, 7, 8, 9 PASSED! All retention rules and shop isolation verified.');
  } else {
    console.error('❌ TEST FAILED');
  }

  // Cleanup test documents
  await Enquiry.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await FollowUp.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Activity.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Customer.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Product.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await Sale.deleteMany({ shopId: { $in: [testShopA, testShopB] } });
  await StorageCleanupSetting.deleteMany({ shopId: { $in: [testShopA, testShopB] } });

  process.exit(0);
};

runTests().catch(err => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
