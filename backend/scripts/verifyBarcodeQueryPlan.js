import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../models/Product.js';

dotenv.config();

async function verifyExplainPlan() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickr';
  console.log('Connecting to MongoDB for query plan verification:', mongoUri);

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    // 1. Get List of Product Indexes
    const collection = mongoose.connection.collection('products');
    const indexes = await collection.indexes();
    console.log('\n--- PRODUCT INDEXES ---');
    console.log(JSON.stringify(indexes, null, 2));

    // 2. Explain Execution Plan for standard Barcode Lookup Query
    const testShopId = 'SHOP-000001';
    const testBarcode = 'QKR-7F3A92K1';

    const query = { shopId: testShopId, barcode: testBarcode, isActive: true };
    const explainResult = await collection.find(query).explain('executionStats');

    console.log('\n--- EXPLAIN QUERY PLAN (executionStats) ---');
    const winningPlan = explainResult.queryPlanner?.winningPlan || {};
    const executionStats = explainResult.executionStats || {};

    console.log('Full Winning Plan:', JSON.stringify(winningPlan, null, 2));
    console.log('Execution Total Keys Examined:', executionStats.totalKeysExamined);
    console.log('Execution Total Docs Examined:', executionStats.totalDocsExamined);
    console.log('Execution N Returned:', executionStats.nReturned);
    console.log('Execution Time (ms):', executionStats.executionTimeMillis);

  } catch (err) {
    console.error('Error during explain verification:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

verifyExplainPlan();
