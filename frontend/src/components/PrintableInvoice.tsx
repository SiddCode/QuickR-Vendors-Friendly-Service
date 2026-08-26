import React from 'react';
import type { Sale } from '../types';

interface PrintableInvoiceProps {
  sale: Sale | null;
  shopName?: string;
}

export const PrintableInvoice: React.FC<PrintableInvoiceProps> = ({ sale, shopName }) => {
  if (!sale) return null;

  const createdDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const formattedDate = createdDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const formattedTime = createdDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const isGst = !!(sale.isGstRegistered || sale.gstin);
  const gstin = sale.gstin || '';
  const headerTitle = isGst ? 'TAX INVOICE' : 'RETAIL BILL';

  const subtotal = sale.subtotal ?? (sale.items || []).reduce((acc, item) => acc + (item.total || (item.quantity * item.rate)), 0);
  const discount = sale.discount || 0;
  const taxableTotal = Math.max(0, subtotal - discount);
  const totalGst = isGst ? (sale.totalGst ?? (sale.items || []).reduce((acc, i) => acc + (i.gstAmount || 0), 0)) : 0;
  const totalAmount = sale.totalAmount ?? (isGst ? (taxableTotal + totalGst) : taxableTotal);

  return (
    <div id="quickr-print-invoice" className="bg-white text-slate-900 p-8 max-w-xl mx-auto font-sans">
      {/* Shop Header */}
      <div className="text-center border-b border-slate-300 pb-4 mb-5">
        <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 mb-0.5">
          {shopName || 'QuickR Retail Store'}
        </h1>
        <p className="text-xs font-extrabold text-slate-600 uppercase tracking-widest">{headerTitle}</p>
        {isGst && gstin && (
          <div className="mt-1.5 inline-block px-2.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[11px] font-bold text-slate-900">
            GSTIN: {gstin}
          </div>
        )}
      </div>

      {/* Invoice & Customer Meta */}
      <div className="flex justify-between items-start text-xs border-b border-slate-200 pb-4 mb-5 leading-relaxed">
        <div>
          <p><strong className="text-slate-800 uppercase font-bold">Invoice No:</strong> {sale.invoiceNumber || sale.id}</p>
          <p><strong className="text-slate-800 uppercase font-bold">Date:</strong> {formattedDate}</p>
          <p><strong className="text-slate-800 uppercase font-bold">Time:</strong> {formattedTime}</p>
        </div>
        <div className="text-right">
          <p><strong className="text-slate-800 uppercase font-bold">Customer:</strong> {sale.customerName || 'Walk-in Customer'}</p>
          {sale.customerPhone && <p><strong className="text-slate-800 uppercase font-bold">Phone:</strong> {sale.customerPhone}</p>}
          <p><strong className="text-slate-800 uppercase font-bold">Payment:</strong> {sale.paymentMethod || 'Cash'}</p>
        </div>
      </div>

      {/* Itemized Table */}
      <table className="w-full text-xs text-left border-collapse mb-5">
        <thead>
          <tr className="border-b-2 border-slate-800 text-slate-800 font-bold uppercase text-[11px]">
            <th className="py-2 pr-2">Product</th>
            <th className="py-2 px-2 text-center">Qty</th>
            <th className="py-2 px-2 text-right">Rate</th>
            {isGst && <th className="py-2 px-2 text-right">GST Rate</th>}
            {isGst && <th className="py-2 px-2 text-right">GST Amt</th>}
            <th className="py-2 pl-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {(sale.items || []).map((item, idx) => (
            <tr key={idx} className="align-top">
              <td className="py-2.5 pr-2 font-semibold text-slate-900">{item.productName || 'Product'}</td>
              <td className="py-2.5 px-2 text-center font-medium text-slate-700">{item.quantity}</td>
              <td className="py-2.5 px-2 text-right font-medium text-slate-700">₹{Number(item.rate).toLocaleString('en-IN')}</td>
              {isGst && <td className="py-2.5 px-2 text-right font-medium text-slate-700">{item.gstRate || 0}%</td>}
              {isGst && <td className="py-2.5 px-2 text-right font-medium text-slate-700">₹{Number(item.gstAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>}
              <td className="py-2.5 pl-2 text-right font-bold text-slate-900">₹{Number(item.total).toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Subtotal, Discount, GST & Total */}
      <div className="border-t border-slate-300 pt-3 space-y-1 text-xs mb-6">
        <div className="flex justify-between text-slate-700 font-medium">
          <span>Subtotal</span>
          <span>₹{Number(subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-emerald-700 font-bold">
            <span>Discount Applied</span>
            <span>- ₹{Number(discount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
        {isGst && (
          <>
            <div className="flex justify-between text-slate-600 font-medium">
              <span>Taxable Subtotal</span>
              <span>₹{Number(taxableTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-indigo-700 font-bold">
              <span>Total GST</span>
              <span>+ ₹{Number(totalGst).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-sm font-black text-slate-950 pt-2 border-t-2 border-slate-900">
          <span className="uppercase">Total Amount Paid</span>
          <span>₹{Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pt-4 border-t border-dashed border-slate-300 text-xs font-semibold text-slate-500">
        <p>Thank you for your purchase!</p>
      </div>
    </div>
  );
};
