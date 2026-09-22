import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  TrendingUp, 
  Plus, 
  Search, 
  Receipt, 
  Download, 
  FileText, 
  RefreshCw, 
  AlertCircle, 
  Trash2, 
  CheckSquare, 
  Square, 
  MessageSquare,
  User,
  Clock,
  Printer,
  Eye
} from 'lucide-react';
import { api } from '../services/api';
import { openWhatsApp, buildWhatsAppBillMessage } from '../utils/whatsapp';
import { printSaleInvoiceWindow } from '../utils/printInvoice';

interface SalesProps {
  setCurrentPage: (page: string) => void;
}

export const Sales: React.FC<SalesProps> = ({ setCurrentPage }) => {
  const { sales, deleteSales, shopName, customers, currentUser, salesSessionActive, startSalesSession } = useApp();
  const isStaff = currentUser?.role === 'staff';

  const [search, setSearch] = useState('');
  const [filterPayment, setFilterPayment] = useState('All');
  const [expandedSale, setExpandedSale] = useState<string | null>(null);

  // Selection & Deletion State (Owner/Admin)
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Export Sales Report State (Owner/Admin)
  const [exportPeriod, setExportPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Exact Date + Time formatting helper (e.g. 22 Sep 2026, 10:42 AM)
  const formatDateTime = (dateVal: string | Date) => {
    if (!dateVal) return 'N/A';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  // Format "Billed by" string for Owner/Admin view
  const getBilledByLabel = (sale: any) => {
    if (!sale.createdBy || !sale.createdBy.name) {
      return 'Billed by: Not recorded';
    }
    const rawRole = sale.createdBy.role || 'user';
    const roleLabel = rawRole.charAt(0).toUpperCase() + rawRole.slice(1);
    return `Billed by: ${roleLabel}: ${sale.createdBy.name}`;
  };

  // Staff sees ONLY sales created by this staff user (backend filters, frontend safety guard)
  const accessibleSales = sales.filter(s => {
    if (isStaff) {
      if (s.createdBy?.userId) {
        return s.createdBy.userId === currentUser?.id;
      }
      // If legacy sale has no createdBy, do not show to staff
      return false;
    }
    return true;
  });

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todaySales = accessibleSales.filter(s => new Date(s.createdAt) >= todayStart);
  const todayRevenue = todaySales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalRevenue = accessibleSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const recoveredAmount = accessibleSales
    .filter(s => s.source === 'quickr_followup')
    .reduce((acc, s) => acc + (s.totalAmount || 0), 0);

  const filteredSales = accessibleSales.filter(s => {
    const matchSearch = !search ||
      (s.invoiceNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.customerName || '').toLowerCase().includes(search.toLowerCase());
    const matchPayment = filterPayment === 'All' || s.paymentMethod === filterPayment;
    return matchSearch && matchPayment;
  });

  const handleTriggerPrint = (sale: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    printSaleInvoiceWindow(sale, shopName);
  };

  const handleSendBillWhatsApp = (sale: any, e: React.MouseEvent) => {
    e.stopPropagation();
    let phoneToUse = sale.customerPhone;
    if (!phoneToUse && sale.customerId) {
      const foundCust = customers.find(c => c.id === sale.customerId);
      if (foundCust) phoneToUse = foundCust.phone;
    }

    if (!phoneToUse) {
      alert('Customer phone number is required to send bill on WhatsApp.');
      return;
    }

    const billMsg = buildWhatsAppBillMessage(shopName, sale.customerName || 'Customer', sale);
    openWhatsApp(phoneToUse, billMsg, shopName, sale.customerName || 'Customer');
  };

  const handleToggleSelectAll = () => {
    if (selectedSaleIds.length === filteredSales.length && filteredSales.length > 0) {
      setSelectedSaleIds([]);
    } else {
      setSelectedSaleIds(filteredSales.map(s => s.id));
    }
  };

  const handleToggleSelectSale = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSaleIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleDeleteSelectedConfirm = async () => {
    if (selectedSaleIds.length === 0 || isDeleting) return;
    setIsDeleting(true);
    try {
      const success = await deleteSales(selectedSaleIds);
      if (success) {
        setSelectedSaleIds([]);
        setShowDeleteModal(false);
      }
    } catch (err) {
      console.error('Delete sales error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStartSalesSession = () => {
    if (!salesSessionActive) {
      startSalesSession();
    }
    setCurrentPage('sales-session');
  };

  return (
    <div className="flex-grow p-4 lg:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800">Sales & Bills</h2>
          <p className="text-xs text-slate-500 font-medium">
            {isStaff ? 'Your completed customer bills & transactions' : 'All shop billing records and transaction history'}
          </p>
        </div>

        <button
          onClick={handleStartSalesSession}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all shrink-0"
        >
          <Receipt className="w-4 h-4" />
          {salesSessionActive ? 'Continue Sales Session' : 'Start Sales Session'}
        </button>
      </div>

      {/* ─── OWNER / ADMIN ONLY: SUMMARY CARDS ─── */}
      {!isStaff && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 mb-1">Today's Revenue</p>
            <p className="text-2xl font-black text-emerald-600">₹{todayRevenue.toLocaleString('en-IN')}</p>
            <p className="text-xs text-slate-400 mt-1">{todaySales.length} bills today</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 mb-1">Total Revenue</p>
            <p className="text-2xl font-black text-slate-800">₹{totalRevenue.toLocaleString('en-IN')}</p>
            <p className="text-xs text-slate-400 mt-1">{accessibleSales.length} total bills</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm col-span-2 md:col-span-1">
            <p className="text-xs font-semibold text-slate-400 mb-1">Recovered via Follow-up</p>
            <p className="text-2xl font-black text-purple-600">₹{recoveredAmount.toLocaleString('en-IN')}</p>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3 text-purple-500" />
              <p className="text-xs text-slate-400">
                {Math.round((recoveredAmount / (totalRevenue || 1)) * 100)}% of total
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── OWNER / ADMIN ONLY: EXPORT SALES REPORT CARD ─── */}
      {!isStaff && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-soft space-y-4 font-sans text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Export Sales Report</h3>
                <p className="text-xs text-slate-400 font-medium">Download dynamic Excel (.xlsx) report for accounting & records</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
              { id: 'custom', label: 'Custom Range' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => {
                  setExportPeriod(p.id as any);
                  setExportError(null);
                  setExportSuccess(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                  exportPeriod === p.id
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {exportPeriod === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 animate-fadeIn">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Start Date (IST)</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">End Date (IST)</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {exportError && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {exportSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700 font-semibold">
              {exportSuccess}
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={async () => {
                setExporting(true);
                setExportError(null);
                setExportSuccess(null);
                try {
                  await api.exportSalesReport({
                    period: exportPeriod,
                    startDate: customStartDate || undefined,
                    endDate: customEndDate || undefined
                  });
                  setExportSuccess('Sales report downloaded successfully.');
                } catch (err: any) {
                  setExportError(err.message || 'Unable to generate sales report.');
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {exporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating Excel...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download Excel Report (.xlsx)
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-grow">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by bill number or customer name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 bg-white"
          />
        </div>
        <select
          value={filterPayment}
          onChange={e => setFilterPayment(e.target.value)}
          className="border border-slate-200 rounded-xl px-4 py-2 bg-white text-sm focus:outline-none focus:border-primary-500 font-medium"
        >
          <option value="All">All Payment Methods</option>
          <option value="Cash">Cash</option>
          <option value="UPI">UPI</option>
          <option value="Card">Card</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {/* Selection Action Toolbar (Owner/Admin Only) */}
      {!isStaff && selectedSaleIds.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="bg-rose-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
              {selectedSaleIds.length} Selected
            </span>
            <span className="text-xs font-semibold text-rose-800">
              Select bills to perform batch actions
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleSelectAll}
              className="px-3 py-1.5 bg-white border border-rose-200 text-rose-700 font-bold text-xs rounded-xl hover:bg-rose-100/50 transition-colors"
            >
              {selectedSaleIds.length === filteredSales.length ? 'Deselect All' : 'Select All'}
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" /> Delete Selected ({selectedSaleIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Owner/Admin Only) */}
      {!isStaff && showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 font-sans">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Delete selected sales?</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  These {selectedSaleIds.length} sale(s) will be permanently removed.
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-800">
              ⚠️ Deleted sales cannot be recovered.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelectedConfirm}
                disabled={isDeleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting ? 'Deleting...' : 'Delete Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SALES & BILLS LIST ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-sans">
        {filteredSales.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500">
            <Receipt className="w-12 h-12 mb-4 text-slate-200" />
            <h3 className="text-lg font-bold text-slate-700 mb-2">No bills found</h3>
            <p className="mb-6 text-xs text-slate-400">
              {isStaff ? 'No completed bills found for your account.' : 'Start processing sales in Sales Session to track billing records.'}
            </p>
            <button
              onClick={handleStartSalesSession}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-xs transition-colors flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" /> Start Sales Session
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredSales.map(sale => {
              const isExpanded = expandedSale === sale.id;

              return (
                <div key={sale.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors space-y-3">
                  
                  {/* MAIN CARD LINE */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    
                    {/* Bill Info */}
                    <div className="flex items-start sm:items-center gap-3">
                      {!isStaff && (
                        <button
                          onClick={(e) => handleToggleSelectSale(sale.id, e)}
                          className="text-slate-400 hover:text-rose-600 transition-colors pt-0.5 sm:pt-0"
                        >
                          {selectedSaleIds.includes(sale.id) ? (
                            <CheckSquare className="w-5 h-5 text-rose-600" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300" />
                          )}
                        </button>
                      )}

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-800 text-base">
                            Bill #{sale.invoiceNumber ? sale.invoiceNumber.replace(/^INV-0*/, '') : sale.id}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                            {sale.invoiceNumber || sale.id}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 font-semibold flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          Customer: <strong className="text-slate-800">{sale.customerName || 'Walk-in Customer'}</strong>
                          {sale.customerPhone && (
                            <span className="text-slate-400 font-mono">({sale.customerPhone})</span>
                          )}
                        </p>

                        {/* Owner/Admin View: Show Billed By */}
                        {!isStaff && (
                          <p className="text-[11px] font-bold text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded-md inline-block">
                            {getBilledByLabel(sale)}
                          </p>
                        )}

                        <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1 pt-0.5">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {formatDateTime(sale.createdAt)}
                        </p>
                      </div>
                    </div>

                    {/* Bill Total & Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <div className="text-left sm:text-right">
                        <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total</span>
                        <span className="text-lg font-black text-emerald-600">₹{(sale.totalAmount || 0).toLocaleString('en-IN')}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                          title="View items"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>

                        <button
                          onClick={(e) => handleTriggerPrint(sale, e)}
                          className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                          title="Print Bill"
                        >
                          <Printer className="w-3.5 h-3.5 text-slate-600" /> Print
                        </button>

                        <button
                          onClick={(e) => handleSendBillWhatsApp(sale, e)}
                          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                          title="Send on WhatsApp"
                        >
                          <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* EXPANDED BILL DETAILS */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-slate-100 space-y-3 bg-slate-50/80 p-4 rounded-xl text-xs animate-fadeIn">
                      <h4 className="font-extrabold text-slate-700 uppercase text-[10px] tracking-wider">Bill Products Details</h4>
                      
                      <div className="space-y-1.5 bg-white p-3 rounded-lg border border-slate-200">
                        {sale.items?.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center py-1 border-b border-slate-50 last:border-0">
                            <div>
                              <span className="font-bold text-slate-800">{item.productName}</span>
                              <span className="text-slate-400 ml-2 font-mono">₹{item.rate} × {item.quantity}</span>
                            </div>
                            <span className="font-bold text-slate-800">₹{item.total.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1 text-slate-600 font-medium">
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span>₹{(sale.subtotal || 0).toLocaleString('en-IN')}</span>
                        </div>
                        {sale.discount ? (
                          <div className="flex justify-between text-emerald-600 font-bold">
                            <span>Discount:</span>
                            <span>-₹{sale.discount.toLocaleString('en-IN')}</span>
                          </div>
                        ) : null}
                        {(sale.totalGst || 0) > 0 && (
                          <div className="flex justify-between text-indigo-600 font-bold">
                            <span>Total GST:</span>
                            <span>+₹{(sale.totalGst || 0).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-slate-800 text-sm pt-1.5 border-t border-slate-100">
                          <span>Final Bill Total:</span>
                          <span className="text-emerald-600">₹{(sale.totalAmount || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sales;
