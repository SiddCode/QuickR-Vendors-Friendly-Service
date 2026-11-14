import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  ArrowLeft, 
  Search, 
  Plus, 
  Check, 
  User, 
  Package, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';
import { calculateFollowUpDateIST } from '../utils/date';

interface NewEnquiryProps {
  setCurrentPage: (page: string) => void;
  setSelectedCustomerId: (id: string) => void;
  initialCustomerId?: string;
}

export const NewEnquiry: React.FC<NewEnquiryProps> = ({ 
  setCurrentPage, 
  setSelectedCustomerId,
  initialCustomerId 
}) => {
  const { customers, products, addCustomer, addEnquiry } = useApp();

  // Active products sorted alphabetically A-Z
  const activeProducts = useMemo(
    () => products
      .filter(p => p.isActive)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
    [products]
  );

  // 1. Customer Selection State
  const [selectedCustId, setSelectedCustId] = useState<string>(() => {
    if (initialCustomerId && customers.some(c => c.id === initialCustomerId)) {
      return initialCustomerId;
    }
    return customers[0]?.id || '';
  });
  const [custSearch, setCustSearch] = useState('');
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  const [isChangingCustomer, setIsChangingCustomer] = useState(false);

  // Add New Customer Sub-form State
  const [showAddCustForm, setShowAddCustForm] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [isCreatingCust, setIsCreatingCust] = useState(false);

  // 2. Product Selection State
  const [prodId, setProdId] = useState<string>(activeProducts[0]?.id || '');
  const currentProduct = activeProducts.find(p => p.id === prodId) || activeProducts[0];

  // 3. Customer Requirement State
  const [size, setSize] = useState<string>('Free Size');
  const [color, setColor] = useState<string>('Standard');
  const [qty, setQty] = useState(1);

  // 4. Follow-up State
  const [recommendFollowUp, setRecommendFollowUp] = useState(true);
  const [followUpDate, setFollowUpDate] = useState('Tomorrow');
  const [customDate, setCustomDate] = useState('');

  // 5. Optional Note State
  const [notes, setNotes] = useState('');

  // Form Status State
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingEnquiry, setIsSubmittingEnquiry] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currentCustomer = customers.find(c => c.id === selectedCustId);

  // Automatically update size and color when product changes
  useEffect(() => {
    if (currentProduct) {
      if (currentProduct.sizes && currentProduct.sizes.length > 0) {
        if (!currentProduct.sizes.includes(size)) {
          setSize(currentProduct.sizes[0]);
        }
      } else {
        setSize('Free Size');
      }

      if (currentProduct.colors && currentProduct.colors.length > 0) {
        if (!currentProduct.colors.includes(color)) {
          setColor(currentProduct.colors[0]);
        }
      } else {
        setColor('Standard');
      }
    }
  }, [prodId, currentProduct]);

  // Filtered customer list for search
  const customerListFiltered = useMemo(() => {
    if (!custSearch.trim()) return customers.slice(0, 10);
    const q = custSearch.toLowerCase().trim();
    return customers.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))
    );
  }, [customers, custSearch]);

  const handleSelectCustomer = (id: string) => {
    setSelectedCustId(id);
    setCustSearch('');
    setShowCustDropdown(false);
    setIsChangingCustomer(false);
    setFormError(null);
  };

  // Quick Add Customer Handler
  const handleAddNewCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCustName.trim();
    const cleanPhone = newCustPhone.trim().replace(/\D/g, '');

    if (!cleanName) {
      setFormError('Customer name is required.');
      return;
    }
    if (cleanPhone.length < 10) {
      setFormError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setFormError(null);
    setIsCreatingCust(true);
    try {
      const newCust = await addCustomer({
        name: cleanName,
        phone: cleanPhone,
        email: '',
        location: '',
        preferences: {},
        status: 'Active'
      });

      if (newCust) {
        setSelectedCustId(newCust.id);
        setShowAddCustForm(false);
        setNewCustName('');
        setNewCustPhone('');
        setIsChangingCustomer(false);
      } else {
        setFormError('Could not save customer. Please check the 10-digit mobile number.');
      }
    } finally {
      setIsCreatingCust(false);
    }
  };

  // Create Enquiry Handler
  const handleCreateEnquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingEnquiry) return; // Prevent duplicate submissions

    if (!selectedCustId) {
      setFormError('Please select or add a customer.');
      return;
    }
    if (!prodId) {
      setFormError('Please select a product.');
      return;
    }

    let calculatedScheduledAt: Date | undefined;
    let targetFollowUpDate: string | undefined;

    if (recommendFollowUp) {
      if (followUpDate === 'Custom' && customDate) {
        calculatedScheduledAt = new Date(customDate);
        targetFollowUpDate = customDate;
      } else {
        calculatedScheduledAt = calculateFollowUpDateIST(followUpDate);
        targetFollowUpDate = followUpDate;
      }
    }

    setFormError(null);
    setIsSubmittingEnquiry(true);

    try {
      const created = await addEnquiry({
        customerId: selectedCustId,
        productId: prodId,
        size: size || 'Free Size',
        color: color || 'Standard',
        quantity: Math.max(1, Number(qty) || 1),
        interest: 'Interested',
        purchaseStatus: "Didn't Purchase",
        notes: notes.trim(),
        scheduledAt: calculatedScheduledAt ? calculatedScheduledAt.toISOString() : undefined,
        followUpDate: targetFollowUpDate
      });

      if (created) {
        setSuccessMessage('Enquiry created successfully!');
        setSelectedCustomerId(selectedCustId);
        // Short delay to display success feedback before returning to customer profile
        setTimeout(() => {
          setCurrentPage('customer-profile');
        }, 500);
      } else {
        setFormError('Failed to save enquiry. Please try again.');
        setIsSubmittingEnquiry(false);
      }
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while creating enquiry.');
      setIsSubmittingEnquiry(false);
    }
  };

  // If no customers or products exist
  if (customers.length === 0) {
    return (
      <div className="flex-grow p-8 flex flex-col items-center justify-center font-sans text-center max-w-md mx-auto space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center mx-auto">
          <User className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-800">No Customers Found</h2>
        <p className="text-xs text-slate-500">You need at least one customer to create an enquiry.</p>
        <button 
          onClick={() => setCurrentPage('customers')} 
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all"
        >
          Go to Customers
        </button>
      </div>
    );
  }

  if (activeProducts.length === 0) {
    return (
      <div className="flex-grow p-8 flex flex-col items-center justify-center font-sans text-center max-w-md mx-auto space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center mx-auto">
          <Package className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-800">No Active Products</h2>
        <p className="text-xs text-slate-500">You need at least one active product in your catalogue to create an enquiry.</p>
        <button 
          onClick={() => setCurrentPage('products')} 
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all"
        >
          Go to Products
        </button>
      </div>
    );
  }

  return (
    <div className="flex-grow p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full font-sans space-y-6 animate-fadeIn">
      
      {/* Top Header & Navigation */}
      <div className="flex items-center justify-between">
        <button 
          type="button"
          onClick={() => {
            if (initialCustomerId) {
              setSelectedCustomerId(initialCustomerId);
              setCurrentPage('customer-profile');
            } else {
              setCurrentPage('customers');
            }
          }} 
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 font-bold text-xs sm:text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <span className="text-xs text-slate-400 font-medium">Quick Enquiry</span>
      </div>

      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">New Customer Enquiry</h1>
        <p className="text-xs text-slate-400 mt-0.5">Quickly record a customer product request and follow-up</p>
      </div>

      {/* Main Compact Form Card */}
      <form onSubmit={handleCreateEnquiry} className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 sm:p-7 space-y-6">

        {/* 1. CUSTOMER SECTION */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-primary-600" />
            1. Customer <span className="text-rose-500">*</span>
          </label>

          {/* Selected Customer Card or Search Field */}
          {currentCustomer && !isChangingCustomer && !showAddCustForm ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 font-black text-sm flex items-center justify-center shrink-0">
                  {currentCustomer.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'C'}
                </div>
                <div>
                  <p className="font-bold text-slate-800 text-sm">{currentCustomer.name}</p>
                  <p className="text-xs text-slate-500 font-medium">{currentCustomer.phone}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsChangingCustomer(true)}
                className="text-xs font-bold text-primary-600 hover:text-primary-800 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search input with live dropdown */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search customer by name or 10-digit mobile..."
                  value={custSearch}
                  onChange={(e) => {
                    setCustSearch(e.target.value);
                    setShowCustDropdown(true);
                  }}
                  onFocus={() => setShowCustDropdown(true)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-4 pr-10 text-xs sm:text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all"
                />
                <Search className="absolute right-3.5 top-3 w-4 h-4 text-slate-400 pointer-events-none" />

                {/* Dropdown search results */}
                {showCustDropdown && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto z-20 text-xs">
                    {customerListFiltered.length > 0 ? (
                      customerListFiltered.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCustomer(c.id)}
                          className="w-full text-left px-4 py-2.5 hover:bg-primary-50/60 flex items-center justify-between border-b border-slate-50 last:border-0 transition-colors"
                        >
                          <span className="font-bold text-slate-800">{c.name}</span>
                          <span className="text-slate-500 font-mono text-[11px]">{c.phone}</span>
                        </button>
                      ))
                    ) : (
                      <div className="p-3 text-center text-slate-400">No matching customer found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Add New Customer Action / Sub-form */}
              {!showAddCustForm ? (
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddCustForm(true);
                      setIsChangingCustomer(true);
                    }}
                    className="text-xs font-bold text-primary-600 hover:text-primary-700 flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> + Add New Customer
                  </button>

                  {isChangingCustomer && currentCustomer && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsChangingCustomer(false);
                        setShowCustDropdown(false);
                      }}
                      className="text-xs text-slate-400 hover:text-slate-600 font-medium"
                    >
                      Keep {currentCustomer.name}
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">Quick Add Customer</span>
                    <button
                      type="button"
                      onClick={() => setShowAddCustForm(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <input
                      type="text"
                      placeholder="Customer Name *"
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500"
                    />
                    <input
                      type="tel"
                      placeholder="10-digit Mobile *"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500 font-mono"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddCustForm(false)}
                      className="px-3 py-1.5 text-xs text-slate-500 font-medium hover:text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isCreatingCust}
                      onClick={handleAddNewCustomerSubmit}
                      className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      {isCreatingCust ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      <span>Save Customer</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. PRODUCT SECTION */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-4 h-4 text-primary-600" />
            2. Product <span className="text-rose-500">*</span>
          </label>

          <select
            value={prodId}
            onChange={(e) => setProdId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all"
          >
            {activeProducts.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.category ? `(${p.category})` : ''} — ₹{p.sellingPrice.toLocaleString('en-IN')}
              </option>
            ))}
          </select>

          {/* Product metadata preview */}
          {currentProduct && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium">Selling Price:</span>
                <span className="font-extrabold text-slate-800 text-sm">₹{currentProduct.sellingPrice.toLocaleString('en-IN')}</span>
              </div>

              <div className="text-[11px] text-slate-500">
                {currentProduct.sizes && currentProduct.sizes.length > 0 && (
                  <span className="mr-3">Sizes: <strong className="text-slate-700">{currentProduct.sizes.join(', ')}</strong></span>
                )}
                {currentProduct.colors && currentProduct.colors.length > 0 && (
                  <span>Colours: <strong className="text-slate-700">{currentProduct.colors.join(', ')}</strong></span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. CUSTOMER REQUIREMENT SECTION */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
            3. Customer Requirement
          </label>

          {/* Size Pills */}
          <div>
            <span className="block text-xs font-semibold text-slate-600 mb-1.5">Size <span className="text-rose-500">*</span></span>
            <div className="flex flex-wrap gap-2">
              {currentProduct?.sizes && currentProduct.sizes.length > 0 ? (
                currentProduct.sizes.map(sz => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setSize(sz)}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      size === sz
                        ? 'bg-primary-50 border-primary-500 text-primary-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {sz}
                  </button>
                ))
              ) : (
                <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">Free Size</span>
              )}
            </div>
          </div>

          {/* Colour Pills (only when product has colors) */}
          {currentProduct?.colors && currentProduct.colors.length > 0 && (
            <div>
              <span className="block text-xs font-semibold text-slate-600 mb-1.5">Colour (Optional)</span>
              <div className="flex flex-wrap gap-2">
                {currentProduct.colors.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      color === c
                        ? 'bg-primary-50 border-primary-500 text-primary-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity Controls */}
          <div>
            <span className="block text-xs font-semibold text-slate-600 mb-1.5">Quantity</span>
            <div className="flex items-center gap-2.5">
              <button 
                type="button"
                onClick={() => setQty(prev => Math.max(1, prev - 1))}
                className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 transition-colors shadow-2xs"
              >
                -
              </button>
              <span className="w-10 text-center text-sm font-extrabold text-slate-800">{qty}</span>
              <button 
                type="button"
                onClick={() => setQty(prev => prev + 1)}
                className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 font-bold hover:bg-slate-50 transition-colors shadow-2xs"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* 4. FOLLOW-UP SECTION */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-primary-600" />
            4. Follow-up
          </label>

          <div className="space-y-3">
            <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={recommendFollowUp}
                onChange={(e) => setRecommendFollowUp(e.target.checked)}
                className="rounded text-primary-600 focus:ring-primary-400 w-4 h-4 border-slate-300"
              />
              <span>Schedule follow-up reminder</span>
            </label>

            {recommendFollowUp && (
              <div className="space-y-2 pt-1 pl-6">
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  {['Tomorrow', 'Today', '3 days', 'Next week', 'Custom'].map(timing => (
                    <button
                      key={timing}
                      type="button"
                      onClick={() => setFollowUpDate(timing)}
                      className={`px-3 py-1.5 rounded-lg border transition-all ${
                        followUpDate === timing
                          ? 'bg-primary-50 border-primary-500 text-primary-700 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {timing}
                    </button>
                  ))}
                </div>

                {followUpDate === 'Custom' && (
                  <div className="pt-1">
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg py-1.5 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500"
                    />
                  </div>
                )}

                <p className="text-[11px] text-slate-400 font-medium">
                  A task will be scheduled automatically in Today's Work for this date.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 5. OPTIONAL NOTE SECTION */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-slate-400" />
            5. Optional Note
          </label>
          <textarea
            placeholder="Add any specific customer notes or preferences (optional)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3.5 text-xs text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all font-medium"
          />
        </div>

        {/* Form Alerts */}
        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-center gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 6. SUBMISSION ACTIONS */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button 
            type="button"
            onClick={() => {
              if (initialCustomerId) {
                setSelectedCustomerId(initialCustomerId);
                setCurrentPage('customer-profile');
              } else {
                setCurrentPage('customers');
              }
            }}
            className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs sm:text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>

          <button 
            type="submit"
            disabled={isSubmittingEnquiry}
            className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all flex items-center gap-2"
          >
            {isSubmittingEnquiry ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Create Enquiry</span>
              </>
            )}
          </button>
        </div>

      </form>

    </div>
  );
};
