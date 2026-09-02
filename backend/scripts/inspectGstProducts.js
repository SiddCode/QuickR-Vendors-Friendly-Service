import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function inspect() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quickr';
  await mongoose.connect(uri);
  const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
  
  const prods = await Product.find({ name: { $regex: /lygra|jeans/i } });
  console.log('--- MATCHING PRODUCTS ---');
  console.log(JSON.stringify(prods, null, 2));

  const allProds = await Product.find({}).select('id name sellingPrice gstRate hsnCode priceIncludesGst gstMode taxIncluded');
  console.log('--- ALL PRODUCTS SUMMARY ---');
  console.log(JSON.stringify(allProds, null, 2));

  await mongoose.disconnect();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
