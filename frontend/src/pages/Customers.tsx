import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/StatusBadge';
import { Plus, Search, UserPlus, SlidersHorizontal, MapPin, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';

interface CustomersProps {
  setCurrentPage: (page: string) => void;
  setSelectedCustomerId: (id: string) => void;
}

export const Customers: React.FC<CustomersProps> = ({ setCurrentPage, setSelectedCustomerId }) => {
  const { customers, enquiries, sales, addCustomer, deleteCustomer, bulkDeleteCustomers } = useApp();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Customer Deletion Modal State
  const [customerToDelete, setCustomerToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAllShopSelected, setIsAllShopSelected] = useState<boolean>(false);
  const [isBulkConfirmModalOpen, setIsBulkConfirmModalOpen] = useState<boolean>(false);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);

  const selectAllCheckboxRef = React.useRef<HTMLInputElement>(null);
  
  // Pagination State
  const [page, setPage] = useState(1);
  const pageSize = 12;
  
  // Add Customer Modal State (Simplified: Name, Phone, WhatsApp Consent)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [allowWhatsAppOffers, setAllowWhatsAppOffers] = useState(true);

  const handleCustomerClick = (id: string) => {
    setSelectedCustomerId(id);
    setCurrentPage('customer-profile');
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || isSubmitting) return;

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setPhoneError('Enter a valid 10-digit mobile number.');
      return;
    }

    setPhoneError(null);
    setIsSubmitting(true);
    try {
      const created = await addCustomer({
        name: name.trim(),
        phone: phone.trim(),
        email: '',
        location: '', // Preserves legacy DB schema without asking user for address
        allowWhatsAppOffers,
        preferences: {},
        status: 'Active'
      });

      if (!created) {
        setPhoneError('Could not save customer. Please verify the mobile number and try again.');
        return;
      }

      // Reset Form only on success
      setName('');
      setPhone('');
      setAllowWhatsAppOffers(true);
      setPhoneError(null);
      setIsModalOpen(false);
    } catch (err: any) {
      const errMsg = err.message || 'Enter a valid 10-digit mobile number.';
      setPhoneError(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return customers.filter(c => {
      const matchesSearch = !q ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(debouncedSearch.trim()) ||
        (c.location || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [customers, debouncedSearch, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedCustomers = filteredCustomers.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleIds = paginatedCustomers.map(c => c.id);

  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const isSomeVisibleSelected = visibleIds.some(id => selectedIds.includes(id));

  React.useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeVisibleSelected && !isAllVisibleSelected;
    }
  }, [isSomeVisibleSelected, isAllVisibleSelected]);

  const handleToggleSelectAllVisible = () => {
    if (isAllVisibleSelected || isAllShopSelected) {
      setSelectedIds([]);
      setIsAllShopSelected(false);
    } else {
      setSelectedIds(visibleIds);
    }
  };

  const handleSelectAllShopCustomers = () => {
    const allShopIds = customers.map(c => c.id);
    setSelectedIds(allShopIds);
    setIsAllShopSelected(true);
  };

  const handleToggleSelectCustomer = (id: string) => {
    setIsAllShopSelected(false);
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleExecuteBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsDeleting(true);
    try {
      const res = await bulkDeleteCustomers(selectedIds);
      if (res.success) {
        setBulkResultMessage(res.message);
        setSelectedIds([]);
        setIsAllShopSelected(false);
        setIsBulkConfirmModalOpen(false);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete customers');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalSelectedCount = selectedIds.length;
  const totalShopCustomersCount = customers.length;

  return (
    <div className="flex-grow p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans">
      {bulkResultMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-semibold shadow-sm">
          <span>{bulkResultMessage}</span>
          <button onClick={() => setBulkResultMessage(null)} className="text-emerald-600 hover:text-emerald-800 p-1">
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Customers</h2>
          <p className="text-sm text-slate-400">Manage and view your clothing shop customer profiles</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-primary-500 hover:bg-primary-600 text-white font-bold text-sm px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all duration-150"
        >
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-soft flex flex-wrap gap-4 items-center justify-between">
        <div className="relative flex-grow max-w-md">
          <input
            type="text"
            placeholder="Search by name, phone or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-primary-400 focus:bg-white transition-all duration-150"
          />
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filter:
          </span>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-100 text-slate-600 text-sm rounded-xl py-2 px-3 focus:outline-none focus:border-primary-400 transition-colors"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 select-none">
            <input 
              type="checkbox" 
              ref={selectAllCheckboxRef}
              checked={isAllVisibleSelected}
              onChange={handleToggleSelectAllVisible}
              className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
            />
            Select All
          </label>

          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {totalSelectedCount} selected
          </span>

          {totalSelectedCount > 0 && totalSelectedCount < totalShopCustomersCount && !isAllShopSelected && (
            <button
              onClick={handleSelectAllShopCustomers}
              className="text-xs text-primary-600 hover:text-primary-800 font-bold underline transition-colors"
            >
              Select all {totalShopCustomersCount} customers in shop
            </button>
          )}

          {isAllShopSelected && (
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
              All {totalShopCustomersCount} shop customers selected
            </span>
          )}
        </div>

        <button
          onClick={() => setIsBulkConfirmModalOpen(true)}
          disabled={totalSelectedCount === 0}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          Delete Selected ({totalSelectedCount})
        </button>
      </div>

      {/* Customers List — Compact Horizontal Row Layout */}
      {paginatedCustomers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2">
          <p className="text-sm font-bold text-slate-700">No customers found</p>
          <p className="text-xs text-slate-400">Try adjusting your search query or status filter.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {paginatedCustomers.map((customer) => {
            const custEnquiries = enquiries.filter(e => e.customerId === customer.id);
            const totalEnq = custEnquiries.length;
            const custSales = sales.filter(s => s.customerId === customer.id);
            const purchasedCount = Math.max(custSales.length, customer.totalPurchases || 0);
            const isChecked = selectedIds.includes(customer.id);

            // Compute initials safely
            const initials = customer.name 
              ? customer.name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase() 
              : 'C';

            return (
              <div 
                key={customer.id}
                onClick={() => handleCustomerClick(customer.id)}
                className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-150 flex flex-col lg:flex-row lg:items-center justify-between gap-3 group cursor-pointer ${
                  isChecked 
                    ? 'border-primary-300 bg-primary-50/20 shadow-xs ring-1 ring-primary-200' 
                    : 'bg-white border-slate-200/80 hover:bg-slate-50/80 hover:border-slate-300 shadow-2xs'
                }`}
              >
                {/* Left section: Checkbox, Avatar, Name & Mobile */}
                <div className="flex items-center gap-3 min-w-[220px] lg:w-[28%] shrink-0">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleToggleSelectCustomer(customer.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300 cursor-pointer shrink-0"
                  />
                  <div className="w-10 h-10 rounded-full bg-primary-50 text-primary-600 font-extrabold text-xs flex items-center justify-center shrink-0 border border-primary-100">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-sm text-slate-800 group-hover:text-primary-600 transition-colors truncate">
                      {customer.name}
                    </h3>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      {customer.phone}
                    </p>
                  </div>
                </div>

                {/* Middle section: Location, Preferred Size, Interested Category (if available) */}
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-slate-600 flex-1 lg:px-4 py-2 lg:py-0 border-t border-b lg:border-t-0 lg:border-b-0 border-slate-100">
                  {customer.location && customer.location.trim() && customer.location !== 'Not specified' && (
                    <span className="flex items-center gap-1 text-slate-600 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[180px]">{customer.location}</span>
                    </span>
                  )}
                  {customer.preferences?.preferredSize && customer.preferences.preferredSize.trim() && customer.preferences.preferredSize !== 'Not specified' && (
                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                      Size: <strong className="text-primary-600 font-bold">{customer.preferences.preferredSize}</strong>
                    </span>
                  )}
                  {customer.preferences?.interestedIn && customer.preferences.interestedIn.trim() && customer.preferences.interestedIn !== 'Not specified' && (
                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                      Interest: <strong className="text-slate-800 font-bold">{customer.preferences.interestedIn}</strong>
                    </span>
                  )}
                  {(!customer.location || customer.location === 'Not specified') && 
                   (!customer.preferences?.preferredSize || customer.preferences.preferredSize === 'Not specified') && 
                   (!customer.preferences?.interestedIn || customer.preferences.interestedIn === 'Not specified') && (
                    <span className="text-slate-400 text-xs italic">No additional details</span>
                  )}
                </div>

                {/* Right section: Active/Inactive status, Total Enquiries, Purchased count, Delete action */}
                <div className="flex items-center justify-between lg:justify-end gap-3 sm:gap-4 shrink-0 text-xs w-full lg:w-auto">
                  <StatusBadge status={customer.status} />

                  <div className="flex items-center gap-2 text-slate-600 font-medium">
                    <span className="bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded-lg">
                      Enquiries: <strong className="text-slate-800 font-bold">{totalEnq}</strong>
                    </span>
                    <span className="bg-slate-50 border border-slate-200/70 px-2.5 py-1 rounded-lg">
                      Purchased: <strong className="text-emerald-700 font-bold">{purchasedCount}</strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCustomerToDelete({ id: customer.id, name: customer.name });
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                    title="Delete Customer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {isBulkConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-800">
                Delete {totalSelectedCount} {totalSelectedCount === 1 ? 'customer' : 'customers'}?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              You are about to delete <strong className="text-slate-800 font-bold">{totalSelectedCount} selected {totalSelectedCount === 1 ? 'customer' : 'customers'}</strong>.
              {isAllShopSelected && (
                <span className="block mt-2 text-rose-600 font-bold">
                  Warning: You have selected ALL {totalShopCustomersCount} customers in your shop!
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              Note: Operational CRM records (enquiries, follow-ups) will be cleaned up. Completed historical bills retain billing customer names for audit reports.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsBulkConfirmModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteBulkDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs transition-colors shadow-sm disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : `Delete ${totalSelectedCount} Customers`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 sm:px-6 py-3.5 rounded-2xl border border-slate-100 text-xs font-semibold text-slate-600">
          <span>Showing {((safePage - 1) * pageSize) + 1} to {Math.min(safePage * pageSize, filteredCustomers.length)} of {filteredCustomers.length} customers</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-2 font-bold text-slate-800">Page {safePage} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 max-h-[90dvh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary-500" /> Add New Customer
            </h3>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 transition-all"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-semibold text-slate-500">Mobile Number *</label>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">10 Digits</span>
                </div>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-semibold font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 transition-all"
                />
                {phoneError && (
                  <p className="text-xs text-rose-500 font-semibold mt-1 animate-fadeIn">{phoneError}</p>
                )}
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/70 cursor-pointer transition-all">
                  <input
                    type="checkbox"
                    checked={allowWhatsAppOffers}
                    onChange={(e) => setAllowWhatsAppOffers(e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer shrink-0"
                  />
                  <span className="text-xs font-semibold text-slate-700">
                    Allow order updates & occasional offers on WhatsApp
                  </span>
                </label>
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {customerToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Delete customer?</h3>
                <p className="text-xs text-slate-400 font-medium">Customer: <strong className="text-slate-700">{customerToDelete.name}</strong></p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              This will permanently remove this customer and their enquiries, follow-ups, messages, and activity history from QuickR. Historical sales will be preserved.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setCustomerToDelete(null)}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (isDeleting || !customerToDelete) return;
                  setIsDeleting(true);
                  try {
                    await deleteCustomer(customerToDelete.id);
                    setCustomerToDelete(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  'Delete Customer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
