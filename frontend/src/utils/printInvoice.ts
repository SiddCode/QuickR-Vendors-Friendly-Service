import type { Sale } from '../types';

export function printSaleInvoiceWindow(sale: Sale, shopName?: string) {
  if (!sale) return;

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

  const isGst = !!(sale.isGstRegistered || sale.gstin || sale.gst?.enabled);
  const gstin = sale.gstin || '';
  const headerTitle = isGst ? 'TAX INVOICE' : 'RETAIL BILL';

  const subtotal = sale.subtotal ?? (sale.items || []).reduce((acc, item) => acc + (item.total || (item.quantity * item.rate)), 0);
  const discount = sale.discount || 0;
  const taxableTotal = sale.gst?.taxableAmount ?? Math.max(0, subtotal - discount);
  const totalGst = isGst ? (sale.totalGst ?? (sale.items || []).reduce((acc, i) => acc + (i.gstAmount || 0), 0)) : 0;
  const totalAmount = sale.totalAmount ?? (isGst ? (taxableTotal + totalGst) : taxableTotal);

  const taxType = sale.gst?.taxType || 'NONE';
  const cgst = sale.gst?.cgst || 0;
  const sgst = sale.gst?.sgst || 0;
  const igst = sale.gst?.igst || 0;

  const tableHeadersHtml = isGst ? `
    <tr>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: left;">Product</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: center;">HSN</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: center;">Qty</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">Rate</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">GST Rate</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">GST Amt</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">Total</th>
    </tr>
  ` : `
    <tr>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: left;">Product</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: center;">Qty</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">Rate</th>
      <th style="padding: 6px 4px; border-bottom: 2px solid #0f172a; text-align: right;">Amount</th>
    </tr>
  `;

  const itemsHtml = (sale.items || []).map(item => {
    if (isGst) {
      return `
        <tr>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${item.productName || 'Product'}</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-size: 10px;">${item.hsnCode || '—'}</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${Number(item.rate).toLocaleString('en-IN')}</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right;">${item.gstRate || 0}%</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${Number(item.gstAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">₹${Number(item.total).toLocaleString('en-IN')}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${item.productName || 'Product'}</td>
        <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
        <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${Number(item.rate).toLocaleString('en-IN')}</td>
        <td style="padding: 6px 4px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">₹${Number(item.total).toLocaleString('en-IN')}</td>
      </tr>
    `;
  }).join('');

  const discountHtml = discount > 0 ? `
    <div style="display: flex; justify-content: space-between; color: #047857; font-weight: 600; margin-bottom: 4px;">
      <span>Discount Applied</span>
      <span>- ₹${Number(discount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
    </div>
  ` : '';

  let gstBreakdownHtml = '';
  if (isGst) {
    if (taxType === 'IGST' || igst > 0) {
      gstBreakdownHtml = `
        <div style="display: flex; justify-content: space-between; color: #475569; margin-bottom: 4px;">
          <span>Taxable Amount</span>
          <span>₹${Number(taxableTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #4f46e5; font-weight: 600; margin-bottom: 4px;">
          <span>IGST</span>
          <span>+ ₹${Number(igst || totalGst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #4f46e5; font-weight: 700; margin-bottom: 4px;">
          <span>Total GST</span>
          <span>+ ₹${Number(totalGst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
      `;
    } else {
      const halfGst = cgst > 0 ? cgst : Math.round((totalGst / 2) * 100) / 100;
      const otherHalfGst = sgst > 0 ? sgst : Math.round((totalGst - halfGst) * 100) / 100;
      gstBreakdownHtml = `
        <div style="display: flex; justify-content: space-between; color: #475569; margin-bottom: 4px;">
          <span>Taxable Amount</span>
          <span>₹${Number(taxableTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #4f46e5; font-weight: 600; margin-bottom: 4px;">
          <span>CGST</span>
          <span>+ ₹${Number(halfGst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #4f46e5; font-weight: 600; margin-bottom: 4px;">
          <span>SGST</span>
          <span>+ ₹${Number(otherHalfGst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: #4f46e5; font-weight: 700; margin-bottom: 4px;">
          <span>Total GST</span>
          <span>+ ₹${Number(totalGst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
      `;
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice #${sale.invoiceNumber || sale.id}</title>
  <style>
    @page {
      size: auto;
      margin: 10mm;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.4;
    }
    .invoice-card {
      width: 100%;
      max-width: 580px;
      margin: 0 auto;
      padding: 16px;
      box-sizing: border-box;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .header h1 {
      margin: 0 0 4px 0;
      font-size: 20px;
      text-transform: uppercase;
      letter-spacing: -0.5px;
      color: #0f172a;
    }
    .header p {
      margin: 0;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #475569;
      text-transform: uppercase;
    }
    .gstin-badge {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 8px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-family: monospace;
      font-weight: 700;
      font-size: 11px;
      color: #0f172a;
    }
    .meta-grid {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 12px;
      margin-bottom: 16px;
      font-size: 11px;
    }
    .meta-grid strong {
      color: #334155;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 11px;
    }
    th {
      text-transform: uppercase;
      font-size: 10px;
      color: #0f172a;
    }
    .totals {
      border-top: 1px solid #cbd5e1;
      padding-top: 10px;
      margin-bottom: 20px;
      font-size: 11px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      color: #475569;
    }
    .grand-total {
      display: flex;
      justify-content: space-between;
      border-top: 2px solid #0f172a;
      padding-top: 8px;
      margin-top: 8px;
      font-size: 13px;
      font-weight: 900;
      color: #0f172a;
      text-transform: uppercase;
    }
    .footer {
      text-align: center;
      border-top: 1px dashed #cbd5e1;
      padding-top: 12px;
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <h1>${shopName || 'QuickR Retail Store'}</h1>
      <p>${headerTitle}</p>
      ${isGst && gstin ? `<div class="gstin-badge">GSTIN: ${gstin}</div>` : ''}
    </div>

    <div class="meta-grid">
      <div>
        <div><strong>Invoice No:</strong> ${sale.invoiceNumber || sale.id}</div>
        <div><strong>Date:</strong> ${formattedDate}</div>
        <div><strong>Time:</strong> ${formattedTime}</div>
      </div>
      <div style="text-align: right;">
        <div><strong>Customer:</strong> ${sale.customerName || 'Walk-in Customer'}</div>
        ${sale.customerPhone ? `<div><strong>Phone:</strong> ${sale.customerPhone}</div>` : ''}
        <div><strong>Payment:</strong> ${sale.paymentMethod || 'Cash'}</div>
      </div>
    </div>

    <table>
      <thead>
        ${tableHeadersHtml}
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>₹${Number(subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      ${discountHtml}
      ${gstBreakdownHtml}
      <div class="grand-total">
        <span>Total Amount Paid</span>
        <span>₹${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>

    <div class="footer">
      Thank you for your purchase!
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
        setTimeout(function() {
          window.close();
        }, 500);
      }, 100);
    };
  </script>
</body>
</html>`;

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }
}
