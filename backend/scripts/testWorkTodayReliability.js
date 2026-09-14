import mongoose from 'mongoose';
import { connectDB } from '../config/database.js';
import { Customer } from '../models/Customer.js';
import { Product } from '../models/Product.js';
import { Enquiry } from '../models/Enquiry.js';
import { FollowUp } from '../models/FollowUp.js';
import { getISTDayBounds, calculateScheduledDateIST } from '../utils/date.js';

const testWorkTodayReliability = async () => {
  console.log('🧪 Starting Today\'s Work Reliability & Performance Tests...');
  await connectDB();

  const shopId = 'test-shop-work-today';

  // Cleanup old test data
  await Customer.deleteMany({ shopId });
  await Product.deleteMany({ shopId });
  await Enquiry.deleteMany({ shopId });
  await FollowUp.deleteMany({ shopId });

  // 1. Verify IST Date Boundaries calculation
  const bounds = getISTDayBounds();
  console.log('\n--- TEST 1: IST Date Boundaries ---');
  console.log(`IST Date: ${bounds.istDateStr}`);
  console.log(`Start of Today (UTC): ${bounds.startOfToday.toISOString()}`);
  console.log(`End of Today (UTC): ${bounds.endOfToday.toISOString()}`);

  const diffHours = (bounds.endOfToday.getTime() - bounds.startOfToday.getTime()) / (1000 * 60 * 60);
  if (Math.abs(diffHours - 24) < 0.1) {
    console.log('✅ TEST 1 PASSED: Exact 24h IST business day boundaries calculated.');
  } else {
    console.error('❌ TEST 1 FAILED');
  }

  // 2. Test 23:30 IST vs 00:10 IST Midnight boundary safety
  console.log('\n--- TEST 2: Midnight / Timezone Boundary Test ---');
  const Sep14_2330_IST = new Date('2026-09-14T23:30:00+05:30');
  const Sep15_0010_IST = new Date('2026-09-15T00:10:00+05:30');

  const boundsSep14 = getISTDayBounds(Sep14_2330_IST);
  const boundsSep15 = getISTDayBounds(Sep15_0010_IST);

  console.log(`23:30 IST Date String: ${boundsSep14.istDateStr} (Expected: 2026-09-14)`);
  console.log(`00:10 IST Date String: ${boundsSep15.istDateStr} (Expected: 2026-09-15)`);

  if (boundsSep14.istDateStr === '2026-09-14' && boundsSep15.istDateStr === '2026-09-15') {
    console.log('✅ TEST 2 PASSED: Midnight boundaries remain strictly in their IST business day.');
  } else {
    console.error('❌ TEST 2 FAILED');
  }

  // 3. Test Enquiry Created Today ("Didn't Purchase") -> FollowUp Creation & Availability
  console.log('\n--- TEST 3: Enquiry & FollowUp Created Today Appears Immediately ---');
  const cust = await Customer.create({ id: 'CUST-WORK-1', name: 'Work Test Customer', phone: '9876543210', shopId });
  const prod = await Product.create({ id: 'PROD-WORK-1', name: 'Work Test Shirt', sellingPrice: 1299, category: 'Shirts', shopId });

  const enqId = `ENQ-${Date.now()}`;
  const newEnquiry = await Enquiry.create({
    id: enqId,
    customerId: cust.id,
    productId: prod.id,
    size: 'XL',
    color: 'Blue',
    purchaseStatus: "Didn't Purchase",
    shopId
  });

  const fwId = `FW-${Date.now()}`;
  const scheduledAt = calculateScheduledDateIST('today');
  const initialStatus = scheduledAt > bounds.endOfToday ? 'scheduled' : 'ready';

  const newFollowUp = await FollowUp.create({
    id: fwId,
    customerId: cust.id,
    enquiryId: enqId,
    reason: 'Customer did not purchase item today',
    scheduledAt,
    status: initialStatus,
    message: 'Hello, follow up message',
    priority: 'High',
    shopId
  });

  console.log(`Created FollowUp ID: ${newFollowUp.id} | Status: ${newFollowUp.status} | ScheduledAt (UTC): ${newFollowUp.scheduledAt.toISOString()}`);

  // Query followups as /api/work/today does
  const rawFollowUps = await FollowUp.find({
    shopId,
    status: { $in: ['ready', 'sent', 'scheduled'] }
  }).lean();

  const isDueToday = rawFollowUps.some(f => {
    const s = new Date(f.scheduledAt);
    return s >= bounds.startOfToday && s <= bounds.endOfToday && (f.status === 'ready' || f.status === 'sent' || f.status === 'scheduled');
  });

  console.log(`Raw Followups Found: ${rawFollowUps.length} | Is Due Today: ${isDueToday}`);

  if (isDueToday && rawFollowUps.length === 1) {
    console.log('✅ TEST 3 PASSED: Enquiry/FollowUp created today appears in Today\'s Work queue immediately.');
  } else {
    console.error('❌ TEST 3 FAILED');
  }

  // Cleanup
  await Customer.deleteMany({ shopId });
  await Product.deleteMany({ shopId });
  await Enquiry.deleteMany({ shopId });
  await FollowUp.deleteMany({ shopId });

  process.exit(0);
};

testWorkTodayReliability().catch(err => {
  console.error('Test exception:', err);
  process.exit(1);
});
