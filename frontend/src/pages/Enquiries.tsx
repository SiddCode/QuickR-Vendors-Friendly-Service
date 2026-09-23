import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/StatusBadge';
import { Plus, Trash2, AlertCircle } from 'lucide-react';

interface EnquiriesProps {
  setCurrentPage: (page: string) => void;
  setSelectedCustomerId: (id: string) => void;
}

export const Enquiries: React.FC<EnquiriesProps> = ({ setCurrentPage, setSelectedCustomerId }) => {
  const { enquiries = [], customers = [], products = [], deleteEnquiry, bulkDeleteEnquiries } = useApp();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Bulk Selection States
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAllShopSelected, setIsAllShopSelected] = useState<boolean>(false);
  const [isBulkConfirmModalOpen, setIsBulkConfirmModalOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const enquiriesList = enquiries || [];
  const visibleIds = enquiriesList.map(e => e.id);
  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const isSomeVisibleSelected = visibleIds.some(id => selectedIds.includes(id));

  useEffect(() => {
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

  const handleSelectAllShopEnquiries = () => {
    const allShopIds = enquiriesList.map(e => e.id);
    setSelectedIds(allShopIds);
    setIsAllShopSelected(true);
  };

  const handleToggleSelectEnquiry = (e: React.MouseEvent | React.ChangeEvent, id: string) => {
    e.stopPropagation();
    setIsAllShopSelected(false);
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleCustomerClick = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setCurrentPage('customer-profile');
  };

  const handleDeleteClick = (e: React.MouseEvent, enquiryId: string) => {
    e.stopPropagation();
    setDeleteId(enquiryId);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const success = await deleteEnquiry(deleteId);
    setDeleteId(null);
    if (success) {
      setFeedbackMsg('Enquiry and active follow-up deleted successfully');
      setSelectedIds(prev => prev.filter(id => id !== deleteId));
      setTimeout(() => setFeedbackMsg(null), 3000);
    }
  };

  const handleExecuteBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsDeleting(true);
    try {
      const res = await bulkDeleteEnquiries(selectedIds);
      if (res.success) {
        setFeedbackMsg(res.message);
        setSelectedIds([]);
        setIsAllShopSelected(false);
        setIsBulkConfirmModalOpen(false);
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete enquiries');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalSelectedCount = selectedIds.length;
  const totalShopEnquiriesCount = enquiriesList.length;

  return (
    <div className="flex-grow p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans animate-fadeIn">
      {feedbackMsg && (
        <div className="bg-success-50 border border-success-200 text-success-700 px-4 py-3 rounded-xl text-sm font-semibold animate-fadeIn flex items-center justify-between">
          <span>{feedbackMsg}</span>
          <button onClick={() => setFeedbackMsg(null)} className="text-success-600 hover:text-success-800 p-1">
            ✕
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800">All Enquiries</h2>
          <p className="text-xs text-slate-400">View and manage customer clothing requests and purchase statuses</p>
        </div>
        <button
          onClick={() => setCurrentPage('new-enquiry')}
          className="bg-primary-500 hover:bg-primary-600 text-white font-bold text-sm px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" /> New Enquiry
        </button>
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

          {totalSelectedCount > 0 && totalSelectedCount < totalShopEnquiriesCount && !isAllShopSelected && (
            <button
              onClick={handleSelectAllShopEnquiries}
              className="text-xs text-primary-600 hover:text-primary-800 font-bold underline transition-colors"
            >
              Select all {totalShopEnquiriesCount} enquiries in shop
            </button>
          )}

          {isAllShopSelected && (
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
              All {totalShopEnquiriesCount} shop enquiries selected
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

      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-soft">
        <div className="overflow-x-auto">
          {enquiriesList.length === 0 ? (
            <p className="text-center text-slate-500 py-4">No enquiries found.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-400 font-semibold border-b border-slate-50 pb-2">
                  <th className="py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={isAllVisibleSelected}
                      onChange={handleToggleSelectAllVisible}
                      className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
                    />
                  </th>
                  <th className="py-2.5 text-xs">Customer</th>
                  <th className="py-2.5 text-xs">Product Details</th>
                  <th className="py-2.5 text-xs text-center">Requirement</th>
                  <th className="py-2.5 text-xs text-center">Price</th>
                  <th className="py-2.5 text-xs text-center">Interest</th>
                  <th className="py-2.5 text-xs text-center">Status</th>
                  <th className="py-2.5 text-xs text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {enquiriesList.map((item) => {
                  const customer = customers?.find((c) => c.id === item.customerId);
                  const product = products?.find((p) => p.id === item.productId);
                  const isChecked = selectedIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/50 cursor-pointer transition-colors ${isChecked ? 'bg-primary-50/30' : ''}`}
                      onClick={() => handleCustomerClick(item.customerId)}
                    >
                      <td className="py-3 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleToggleSelectEnquiry(e, item.id)}
                          className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
                        />
                      </td>
                      <td className="py-3">
                        <p className="font-bold text-slate-700">{customer?.name || 'Customer'}</p>
                        <p className="text-xs text-slate-400">{customer?.phone}</p>
                      </td>
                      <td className="py-3">
                        <p className="font-bold text-slate-700">{item.productName || product?.name || 'Product'}</p>
                        <p className="text-[10px] text-slate-400">{item.productCategory || product?.category || 'Category'}</p>
                      </td>
                      <td className="py-3 text-center text-xs">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">
                          {item.size} / {item.color}
                        </span>
                      </td>
                      <td className="py-3 text-center font-bold text-slate-700 text-sm">
                        ₹{item.priceAtEnquiry || product?.sellingPrice || 0}
                      </td>
                      <td className="py-3 text-center">
                        <StatusBadge status={item.interest} />
                      </td>
                      <td className="py-3 text-center">
                        <StatusBadge status={item.purchaseStatus} />
                      </td>
                      <td className="py-3 text-right pr-4">
                        <button
                          onClick={(e) => handleDeleteClick(e, item.id)}
                          className="p-1.5 text-slate-400 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                          title="Delete Enquiry"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bulk Delete Confirmation Modal */}
      {isBulkConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-800">
                Delete {totalSelectedCount} {totalSelectedCount === 1 ? 'enquiry' : 'enquiries'}?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              You are about to delete <strong className="text-slate-800 font-bold">{totalSelectedCount} selected {totalSelectedCount === 1 ? 'enquiry' : 'enquiries'}</strong>.
              {isAllShopSelected && (
                <span className="block mt-2 text-rose-600 font-bold">
                  Warning: You have selected ALL {totalShopEnquiriesCount} enquiries in your shop!
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              Note: Related active follow-ups for these enquiries will be safely removed.
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
                {isDeleting ? 'Deleting...' : `Delete ${totalSelectedCount} Enquiries`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 space-y-4 animate-scaleUp">
            <h3 className="text-lg font-bold text-slate-800">Delete this enquiry?</h3>
            <p className="text-sm text-slate-500">
              Active follow-ups will also be removed. Sales history and customer records will be preserved.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-semibold text-white bg-danger-600 hover:bg-danger-700 rounded-xl transition-colors shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
