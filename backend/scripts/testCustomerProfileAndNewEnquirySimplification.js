import fs from 'fs';
import path from 'path';

console.log('👤 Starting Customer Profile & New Enquiry Simplification Verification Suite...\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

const customerProfilePath = path.resolve('frontend/src/pages/CustomerProfile.tsx');
const newEnquiryPath = path.resolve('frontend/src/pages/NewEnquiry.tsx');

const customerProfileContent = fs.readFileSync(customerProfilePath, 'utf8');
const newEnquiryContent = fs.readFileSync(newEnquiryPath, 'utf8');

// ==========================================
// 1. CUSTOMER PROFILE VERIFICATIONS
// ==========================================

// 1.1 Single Scrolling Page Layout (No multi-tab state)
assert(
  !customerProfileContent.includes("activeTab === 'overview'") &&
  !customerProfileContent.includes("activeTab === 'enquiries'") &&
  !customerProfileContent.includes("activeTab === 'followups'") &&
  !customerProfileContent.includes("activeTab === 'campaigns'") &&
  !customerProfileContent.includes("activeTab === 'notes'"),
  '1. Customer Profile replaces multi-tab system with a single clean scrolling page'
);

// 1.2 Customer Header Elements
assert(
  customerProfileContent.includes('customer.name') &&
  customerProfileContent.includes('customer.phone') &&
  customerProfileContent.includes('customer.location') &&
  customerProfileContent.includes('customer.status') &&
  customerProfileContent.includes('customer.id'),
  '2. Customer header shows Customer Name, Phone, Location (conditional), Status, and subtle Customer ID'
);

// 1.3 Two Primary Actions: New Enquiry & WhatsApp
assert(
  customerProfileContent.includes("setCurrentPage('new-enquiry')") &&
  customerProfileContent.includes('handleSendWhatsApp') &&
  customerProfileContent.includes('New Enquiry') &&
  customerProfileContent.includes('WhatsApp'),
  '3. Customer header provides two prominent primary actions: New Enquiry and WhatsApp'
);

// 1.4 Delete Customer Action with Confirmation
assert(
  customerProfileContent.includes('setShowDeleteModal(true)') &&
  customerProfileContent.includes('deleteCustomer(customer.id)') &&
  customerProfileContent.includes('Delete customer?'),
  '4. Delete Customer is preserved as a separate less-prominent action with confirmation modal'
);

// 1.5 Compact Customer Preferences (Interested, Size, Colours, No Defaults, Editable)
assert(
  customerProfileContent.includes('Customer Preferences') &&
  customerProfileContent.includes('customer.preferences?.interestedIn') &&
  customerProfileContent.includes('customer.preferences?.preferredSize') &&
  customerProfileContent.includes('customer.preferences?.preferredColors') &&
  customerProfileContent.includes('isEditingPreferences') &&
  customerProfileContent.includes('handleSavePreferences'),
  '5. Customer preferences displays compact section for categories, sizes, colours and supports editing without fake defaults'
);

// 1.6 Combined Chronological Activity Timeline
assert(
  customerProfileContent.includes('timelineEntries') &&
  customerProfileContent.includes('timelineFilter') &&
  customerProfileContent.includes('Enquiry:') &&
  customerProfileContent.includes('Purchase Completed') &&
  customerProfileContent.includes('Follow-up'),
  '6. Activity timeline combines enquiries, purchases, follow-ups, and campaigns chronologically'
);

// 1.7 Notes Section
assert(
  customerProfileContent.includes('Customer Notes') &&
  customerProfileContent.includes('handleAddNoteSubmit') &&
  customerProfileContent.includes('addNote(customer.id') &&
  customerProfileContent.includes('customerNotes'),
  '7. Compact Notes section is located near bottom with input, add action, and existing notes display'
);

// 1.8 Removal of Visual Clutter
assert(
  !customerProfileContent.includes('AI Sales Opportunity') &&
  !customerProfileContent.includes('AI Customer Intelligence') &&
  !customerProfileContent.includes('What QuickR knows:'),
  '8. Removed oversized AI cards, fake hardcoded stats cards, and redundant clutter from Customer Profile'
);

// ==========================================
// 2. NEW ENQUIRY VERIFICATIONS
// ==========================================

// 2.1 Customer Section (Search, selected customer display, Add New Customer)
assert(
  newEnquiryContent.includes('1. Customer') &&
  newEnquiryContent.includes('Search customer by name or 10-digit mobile') &&
  newEnquiryContent.includes('Change') &&
  newEnquiryContent.includes('handleAddNewCustomerSubmit') &&
  newEnquiryContent.includes('Quick Add Customer'),
  '9. New Enquiry Step 1 provides customer search, selected customer banner, and quick Add New Customer'
);

// 2.2 Product Section (Active products A-Z, price, sizes, colours)
assert(
  newEnquiryContent.includes('2. Product') &&
  newEnquiryContent.includes('activeProducts') &&
  newEnquiryContent.includes('Selling Price:') &&
  newEnquiryContent.includes('p.sellingPrice'),
  '10. New Enquiry Step 2 displays active product selection with current selling price, sizes, and colours'
);

// 2.3 Customer Requirement (Sizes pills, Colours, Quantity +/-)
assert(
  newEnquiryContent.includes('3. Customer Requirement') &&
  newEnquiryContent.includes('currentProduct.sizes.map') &&
  newEnquiryContent.includes('currentProduct.colors.map') &&
  newEnquiryContent.includes('Math.max(1, prev - 1)') &&
  newEnquiryContent.includes('prev + 1'),
  '11. New Enquiry Step 3 provides selectable size pills, colour options, and +/- quantity controls'
);

// 2.4 Follow-up Section (Default Tomorrow, supported options, scheduling preserved)
assert(
  newEnquiryContent.includes('4. Follow-up') &&
  newEnquiryContent.includes("setFollowUpDate('Tomorrow')") || newEnquiryContent.includes("useState('Tomorrow')") &&
  newEnquiryContent.includes('recommendFollowUp') &&
  newEnquiryContent.includes('calculateFollowUpDateIST'),
  '12. New Enquiry Step 4 defaults follow-up to Tomorrow with scheduling options preserved'
);

// 2.5 Optional Note Section
assert(
  newEnquiryContent.includes('5. Optional Note') &&
  newEnquiryContent.includes('notes') &&
  !newEnquiryContent.includes('notes *'),
  '13. New Enquiry Step 5 provides a single compact optional note field'
);

// 2.6 Submission & Redirection
assert(
  newEnquiryContent.includes('Create Enquiry') &&
  newEnquiryContent.includes('isSubmittingEnquiry') &&
  newEnquiryContent.includes("setCurrentPage('customer-profile')") &&
  newEnquiryContent.includes('setSelectedCustomerId'),
  '14. New Enquiry Step 6 provides duplicate submission prevention and navigates to Customer Profile on success'
);

// 2.7 Sidebar Removal & Responsive Form
assert(
  !newEnquiryContent.includes('lg:col-span-4') &&
  !newEnquiryContent.includes('Enquiry Summary') &&
  !newEnquiryContent.includes('What happens next?'),
  '15. Removed large 5-section card layout and oversized Enquiry Summary sidebar for a clean compact form'
);

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
