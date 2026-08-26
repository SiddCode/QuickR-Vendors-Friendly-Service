import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, X, Receipt, Search, Check, ChevronDown } from 'lucide-react';

interface BillingProps {
  setCurrentPage: (page: string) => void;
  billingInitialData?: {
    customerId?: string;
    enquiryId?: string;
    followUpId?: string;
    productId?: string;
    rate?: number;
  } | null;
}

interface BillItem {
  id: string; // temp id for UI
  productId: string;
  quantity: number;
  rate: number;
}

export const Billing: React.FC<BillingProps> = ({ setCurrentPage, billingInitialData }) => {
  const { customers, products, createSale, shopProfile } = useApp();

  const activeProducts = products.filter(p => p.isActive);

  const [isWalkIn, setIsWalkIn] = useState(!billingInitialData?.customerId);
  const [selectedCustomerId, setSelectedCustomerId] = useState(billingInitialData?.customerId || '');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerState, setCustomerState] = useState('Tamil Nadu');
  const [customerStateCode, setCustomerStateCode] = useState('33');
  const [customerGstin, setCustomerGstin] = useState('');

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

  const handleCustStateChange = (stName: string) => {
    setCustomerState(stName);
    const match = INDIAN_STATES.find(s => s.name === stName);
    if (match) setCustomerStateCode(match.code);
  };
  
  const [items, setItems] = useState<BillItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');

  // Handle outside click to close customer dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter customers based on search query (Name or Phone number)
  const trimmedQuery = customerSearchQuery.trim().toLowerCase();
  const filteredCustomers = customers.filter(c => {
    if (!trimmedQuery) return true;
    const nameMatch = c.name ? c.name.toLowerCase().includes(trimmedQuery) : false;
    const phoneMatch = c.phone ? c.phone.toLowerCase().includes(trimmedQuery) : false;
    return nameMatch || phoneMatch;
  });

  const selectedCustomerObj = customers.find(c => c.id === selectedCustomerId);

  useEffect(() => {
    if (billingInitialData && billingInitialData.productId) {
      const prod = activeProducts.find(p => p.id === billingInitialData.productId);
      if (prod) {
        setItems([{
          id: Date.now().toString(),
          productId: prod.id,
          quantity: 1,
          rate: billingInitialData.rate !== undefined ? billingInitialData.rate : prod.sellingPrice
        }]);
      }
    } else {
      // Default one empty item
      if (activeProducts.length > 0) {
        setItems([{
          id: Date.now().toString(),
          productId: activeProducts[0].id,
          quantity: 1,
          rate: activeProducts[0].sellingPrice
        }]);
      }
    }
  }, [billingInitialData]);

  const handleAddItem = () => {
    if (activeProducts.length === 0) return;
    setItems([...items, {
      id: Date.now().toString(),
      productId: activeProducts[0].id,
      quantity: 1,
      rate: activeProducts[0].sellingPrice
    }]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleItemChange = (id: string, field: keyof BillItem, value: any) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Auto-update rate if product changes
        if (field === 'productId') {
          const prod = activeProducts.find(p => p.id === value);
          if (prod) updated.rate = prod.sellingPrice;
        }
        return updated;
      }
      return item;
    }));
  };

  // Calculations
  const isGstRegistered = !!shopProfile?.isGstRegistered;
  const shopGstin = shopProfile?.gstin || '';

  const validatedDiscountPercent = Math.min(100, Math.max(0, Number(discountPercent) || 0));

  const enrichedItems = items.map(item => {
    const prod = products.find(p => p.id === item.productId);
    const lineTotal = item.quantity * item.rate;
    const itemGstRate = (isGstRegistered && prod && prod.gstRate !== undefined) ? prod.gstRate : 0;
    const priceIncludesGst = prod?.priceIncludesGst !== undefined ? prod.priceIncludesGst : false;
    
    // Proportional taxable amount after discount
    let itemGstAmount = 0;
    let itemTaxableAmount = lineTotal;

    if (isGstRegistered && itemGstRate > 0) {
      const subtotalTemp = items.reduce((acc, i) => acc + (i.quantity * i.rate), 0);
      const discountAmtTemp = (subtotalTemp * validatedDiscountPercent) / 100;
      const lineSubtotalAfterDiscount = subtotalTemp > 0 ? (lineTotal * (1 - (discountAmtTemp / subtotalTemp))) : lineTotal;

      if (priceIncludesGst) {
        itemTaxableAmount = Math.round((lineSubtotalAfterDiscount / (1 + itemGstRate / 100)) * 100) / 100;
        itemGstAmount = Math.round((lineSubtotalAfterDiscount - itemTaxableAmount) * 100) / 100;
      } else {
        itemTaxableAmount = Math.round(lineSubtotalAfterDiscount * 100) / 100;
        itemGstAmount = Math.round((itemTaxableAmount * (itemGstRate / 100)) * 100) / 100;
      }
    } else {
      const subtotalTemp = items.reduce((acc, i) => acc + (i.quantity * i.rate), 0);
      const discountAmtTemp = (subtotalTemp * validatedDiscountPercent) / 100;
      itemTaxableAmount = subtotalTemp > 0 ? Math.round((lineTotal * (1 - (discountAmtTemp / subtotalTemp))) * 100) / 100 : lineTotal;
    }

    return {
      ...item,
      productName: prod?.name || 'Unknown Product',
      category: prod?.category || 'Category',
      gstRate: itemGstRate,
      gstAmount: itemGstAmount,
      taxableAmount: itemTaxableAmount,
      priceIncludesGst,
      total: lineTotal
    };
  });

  const subtotal = enrichedItems.reduce((acc, item) => acc + item.total, 0);
  const discountAmount = Number(((subtotal * validatedDiscountPercent) / 100).toFixed(2));
  
  const hasInclusiveItems = enrichedItems.some(i => i.gstRate > 0 && i.priceIncludesGst);
  const totalGst = isGstRegistered ? Math.round(enrichedItems.reduce((acc, item) => acc + item.gstAmount, 0) * 100) / 100 : 0;

  let taxableSubtotal = Math.max(0, subtotal - discountAmount);
  if (isGstRegistered && hasInclusiveItems) {
    taxableSubtotal = Math.round(enrichedItems.reduce((acc, item) => acc + item.taxableAmount, 0) * 100) / 100;
  }

  const grandTotalAmount = isGstRegistered 
    ? Math.round((taxableSubtotal + totalGst) * 100) / 100 
    : Math.max(0, subtotal - discountAmount);

  const handleDiscountChange = (valStr: string) => {
    if (valStr === '') {
      setDiscountPercent(0);
      return;
    }
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    if (val < 0) {
      setDiscountPercent(0);
    } else if (val > 100) {
      setDiscountPercent(100);
    } else {
      setDiscountPercent(val);
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowWhatsAppOffers, setAllowWhatsAppOffers] = useState<boolean>(true);

  const handleGenerateBill = async () => {
    if (items.length === 0) return alert('Please add at least one item');
    if (isSubmitting) return;
    
    let finalCustomerId = '';
    let finalCustomerName = 'Walk-in Customer';
    
    if (!isWalkIn) {
      if (!selectedCustomerId) return alert('Please select a customer');
      const c = customers.find(x => x.id === selectedCustomerId);
      if (c) {
        finalCustomerId = c.id;
        finalCustomerName = c.name;
      }
    } else if (customerName.trim()) {
      finalCustomerName = customerName.trim();
    }

    const payload = {
      customerId: finalCustomerId,
      customerName: finalCustomerName,
      customerPhone: isWalkIn && customerPhone.trim() ? customerPhone.trim() : undefined,
      customerState: isGstRegistered ? customerState : undefined,
      customerStateCode: isGstRegistered ? customerStateCode : undefined,
      customerGstin: isGstRegistered && customerGstin.trim() ? customerGstin.trim().toUpperCase() : undefined,
      allowWhatsAppOffers: isWalkIn && customerPhone.trim() ? allowWhatsAppOffers : undefined,
      enquiryId: billingInitialData?.enquiryId || '',
      followUpId: billingInitialData?.followUpId || '',
      items: enrichedItems.map(i => ({
        productId: i.productId,
        productName: i.productName,
        category: i.category,
        quantity: i.quantity,
        rate: i.rate,
        total: i.total,
        gstRate: i.gstRate,
        gstAmount: i.gstAmount
      })),
      subtotal,
      discount: discountAmount,
      totalGst,
      totalAmount: grandTotalAmount,
      paymentMethod,
      source: billingInitialData?.enquiryId ? 'quickr_followup' : 'direct'
    };

    setIsSubmitting(true);
    try {
      const sale = await createSale(payload);
      if (sale) {
        // Navigate directly to Sales page after generating bill without opening print window
        setCurrentPage('sales');
      }
    } catch (err) {
      console.error('Failed to generate bill:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-grow p-4 lg:p-8 space-y-6 bg-slate-50 min-h-screen font-sans">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">New Bill</h1>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Customer Details (Optional)</h2>
            
            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input 
                  type="radio" 
                  checked={isWalkIn} 
                  onChange={() => setIsWalkIn(true)} 
                  className="text-primary-500 focus:ring-primary-400 w-4 h-4"
                />
                Walk-in Customer
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <input 
                  type="radio" 
                  checked={!isWalkIn} 
                  onChange={() => setIsWalkIn(false)} 
                  className="text-primary-500 focus:ring-primary-400 w-4 h-4"
                />
                Existing Customer
              </label>
            </div>

            {isWalkIn ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Customer Name (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Ravi"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    placeholder="e.g. 9876543210"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                {customerPhone.trim() && (
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowWhatsAppOffers}
                      onChange={e => setAllowWhatsAppOffers(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-semibold text-slate-600">
                      Allow order updates & occasional offers on WhatsApp
                    </span>
                  </label>
                )}

                {isGstRegistered && (
                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Customer State</label>
                        <select
                          value={customerState}
                          onChange={e => handleCustStateChange(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-800 focus:outline-none focus:border-primary-400"
                        >
                          {INDIAN_STATES.map(st => (
                            <option key={st.code} value={st.name}>{st.name} ({st.code})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">State Code</label>
                        <input
                          type="text"
                          readOnly
                          value={customerStateCode}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-600 focus:outline-none cursor-not-allowed"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Customer GSTIN (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 33AAAAA0000A1Z5"
                        value={customerGstin}
                        onChange={e => setCustomerGstin(e.target.value.toUpperCase())}
                        maxLength={15}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-primary-400 uppercase tracking-wider"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div ref={dropdownRef} className="relative">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Select Customer *</label>
                
                {/* Search Input Control */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    placeholder="🔍 Search by name or phone..."
                    value={isDropdownOpen ? customerSearchQuery : (selectedCustomerObj ? `${selectedCustomerObj.name} (${selectedCustomerObj.phone})` : customerSearchQuery)}
                    onFocus={() => {
                      setIsDropdownOpen(true);
                      setCustomerSearchQuery('');
                    }}
                    onChange={(e) => {
                      setCustomerSearchQuery(e.target.value);
                      if (!isDropdownOpen) setIsDropdownOpen(true);
                    }}
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-10 text-sm focus:outline-none focus:border-primary-400 shadow-2xs font-medium text-slate-800 placeholder-slate-400"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Dropdown Options Container */}
                {isDropdownOpen && (
                  <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto py-1.5 text-sm divide-y divide-slate-50">
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((c) => {
                        const isSelected = c.id === selectedCustomerId;
                        return (
                          <div
                            key={c.id}
                            onClick={() => {
                              setSelectedCustomerId(c.id);
                              setCustomerSearchQuery('');
                              setIsDropdownOpen(false);
                            }}
                            className={`px-3.5 py-2.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors ${
                              isSelected ? 'bg-primary-50/60' : ''
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className={`font-bold ${isSelected ? 'text-primary-600' : 'text-slate-800'}`}>
                                {c.name}
                              </span>
                              <span className="text-xs text-slate-400 font-medium">
                                {c.phone}
                              </span>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-primary-600 shrink-0" />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-xs text-slate-400 font-semibold text-center">
                        No customers found
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-6">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Items</h2>
            
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-grow w-full">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Product</label>
                    <select 
                      value={item.productId}
                      onChange={e => handleItemChange(item.id, 'productId', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-400"
                    >
                      {activeProducts.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="w-full md:w-24 shrink-0">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity</label>
                    <input 
                      type="number" 
                      min="1"
                      value={item.quantity}
                      onChange={e => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-400 text-center"
                    />
                  </div>

                  <div className="w-full md:w-32 shrink-0">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Rate (₹)</label>
                    <input 
                      type="number" 
                      min="0"
                      value={item.rate}
                      onChange={e => handleItemChange(item.id, 'rate', Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-400 text-center font-bold text-slate-700"
                    />
                  </div>

                  {items.length > 1 && (
                    <button 
                      onClick={() => handleRemoveItem(item.id)}
                      className="p-2 text-slate-400 hover:text-danger-500 hover:bg-danger-50 rounded-lg mb-0.5 shrink-0 transition-colors"
                      title="Remove item"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button 
              onClick={handleAddItem}
              className="mt-4 flex items-center gap-1.5 text-primary-600 font-bold text-sm hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Another Item
            </button>
          </div>
          
          <div className="p-6 border-t border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between gap-6">
            <div className="w-full md:w-1/2">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Payment Method</h2>
              <div className="grid grid-cols-2 gap-3">
                {['Cash', 'UPI', 'Card', 'Other'].map(method => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2 px-3 rounded-xl border text-sm font-bold transition-all ${
                      paymentMethod === method 
                        ? 'bg-primary-50 border-primary-500 text-primary-600 shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full md:w-1/2 space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center text-sm font-medium text-slate-600">
                <span>Subtotal</span>
                <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              
              <div className="flex justify-between items-center text-sm font-medium text-slate-600">
                <span className="flex items-center gap-1 font-semibold text-slate-700">Discount:</span>
                <div className="flex items-center gap-1.5">
                  <input 
                    type="number" 
                    min="0"
                    max="100"
                    step="any"
                    value={discountPercent === 0 ? '' : discountPercent}
                    onChange={e => handleDiscountChange(e.target.value)}
                    placeholder="0"
                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-sm font-bold focus:outline-none focus:border-primary-500 text-center"
                  />
                  <span className="font-bold text-slate-600">%</span>
                </div>
              </div>

              {validatedDiscountPercent > 0 && (
                <div className="flex justify-between items-center text-xs font-semibold text-emerald-600">
                  <span>Discount ({validatedDiscountPercent}%):</span>
                  <span>-₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}

              {isGstRegistered && (
                <>
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-500 pt-1 border-t border-dashed border-slate-200">
                    <span>Taxable Subtotal</span>
                    <span>₹{taxableSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {customerStateCode !== (shopProfile?.stateCode || '33') ? (
                    <div className="flex justify-between items-center text-xs font-semibold text-indigo-600">
                      <span>IGST Total:</span>
                      <span>+₹{totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center text-xs font-medium text-indigo-600">
                        <span>CGST (Half):</span>
                        <span>+₹{(Math.round((totalGst / 2) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-medium text-indigo-600">
                        <span>SGST (Half):</span>
                        <span>+₹{(Math.round((totalGst - (Math.round((totalGst / 2) * 100) / 100)) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center text-xs font-bold text-indigo-700 pt-1 border-t border-slate-100">
                    <span className="flex items-center gap-1">
                      Total GST:
                      {shopGstin && <span className="text-[10px] text-slate-400 font-mono">({shopGstin})</span>}
                    </span>
                    <span>+₹{totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-base sm:text-lg font-bold text-slate-800">
                <span>Grand Total</span>
                <span className="text-primary-600 font-extrabold">₹{grandTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="p-6 bg-white border-t border-slate-100 flex gap-4">
            <button 
              onClick={() => setCurrentPage('dashboard')}
              className="px-6 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleGenerateBill}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-primary-600 text-white font-bold rounded-xl shadow-sm hover:bg-primary-700 transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
            >
              <Receipt className="w-5 h-5" />
              {isSubmitting ? 'Generating Bill...' : 'Generate Bill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
