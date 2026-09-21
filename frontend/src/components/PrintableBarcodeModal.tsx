import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { X, Printer } from 'lucide-react';
import type { Product } from '../types';

interface PrintableBarcodeModalProps {
  product: Product;
  shopName?: string;
  onClose: () => void;
}

export const PrintableBarcodeModal: React.FC<PrintableBarcodeModalProps> = ({ product, shopName, onClose }) => {
  // 4 SVG refs for the 4 labels on the print page
  const barcodeRefPreview = useRef<SVGSVGElement>(null);
  const barcodeRefPrint0 = useRef<SVGSVGElement>(null);
  const barcodeRefPrint1 = useRef<SVGSVGElement>(null);
  const barcodeRefPrint2 = useRef<SVGSVGElement>(null);
  const barcodeRefPrint3 = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (product && product.barcode) {
      const barcodeOptions = {
        format: 'CODE128',
        width: 2.0,
        height: 60,
        displayValue: false, // Explicit high-quality human-readable text below
        margin: 4
      };

      const refs = [
        barcodeRefPreview.current,
        barcodeRefPrint0.current,
        barcodeRefPrint1.current,
        barcodeRefPrint2.current,
        barcodeRefPrint3.current
      ];

      // Delay barcode rendering to ensure DOM refs are fully mounted
      const timer = setTimeout(() => {
        refs.forEach(ref => {
          if (ref && product.barcode) {
            try {
              JsBarcode(ref, product.barcode, barcodeOptions);
            } catch (err) {
              console.error('Barcode rendering error:', err);
            }
          }
        });
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [product, product.barcode]);

  const handlePrint = () => {
    // Re-verify SVGs exist before triggering browser print
    if (product.barcode) {
      const refs = [
        barcodeRefPrint0.current,
        barcodeRefPrint1.current,
        barcodeRefPrint2.current,
        barcodeRefPrint3.current
      ];
      refs.forEach(ref => {
        if (ref) {
          try {
            JsBarcode(ref, product.barcode as string, {
              format: 'CODE128',
              width: 2.0,
              height: 60,
              displayValue: false,
              margin: 4
            });
          } catch (_) {}
        }
      });
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
      }, 100);
    });
  };

  const displayShopName = shopName && String(shopName).trim() ? String(shopName).trim() : 'STORE LABEL';
  const displayProductName = product.name || 'PRODUCT';
  
  const hasMRP = product.originalPrice !== undefined && product.originalPrice !== null && Number(product.originalPrice) > 0;
  const sellingPriceVal = product.sellingPrice !== undefined && product.sellingPrice !== null ? Number(product.sellingPrice) : 0;
  const mrpVal = hasMRP ? Number(product.originalPrice) : null;
  const showDiscount = mrpVal !== null && mrpVal > sellingPriceVal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn barcode-print-root">
      {/* Screen Modal Dialog (Hidden during print) */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden font-sans print:hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Print Product Barcode Labels</h3>
            <p className="text-[11px] text-slate-400 font-medium">Generates 4 identical sticker labels per A4 page (2×2 layout)</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Screen Preview Card */}
        <div className="p-6 flex flex-col items-center justify-center bg-white border border-dashed border-slate-300 m-4 rounded-xl shadow-inner text-center">
          {/* 1. Shop Name */}
          <div className="text-sm font-black text-slate-800 uppercase tracking-wider max-w-[280px] truncate mb-2">
            {displayShopName}
          </div>

          {/* 2. Barcode Graphic */}
          <div className="bg-white p-1 rounded-lg border border-slate-100">
            <svg ref={barcodeRefPreview} className="max-w-full h-14"></svg>
          </div>

          {/* 3. Barcode Value */}
          <div className="text-xs font-mono font-extrabold tracking-widest text-slate-800 mt-1 mb-3 bg-slate-100 px-3 py-0.5 rounded border border-slate-200">
            {product.barcode || 'NO BARCODE'}
          </div>

          {/* 4. Product Name */}
          <div className="text-sm font-black text-slate-900 uppercase tracking-wide max-w-[280px] truncate mb-3">
            {displayProductName}
          </div>

          {/* 5. Price Section (No text labels, crossed-out MRP first, then selling price) */}
          <div className="flex items-center justify-center gap-4 text-base font-bold border-t border-slate-100 pt-3 w-full">
            {showDiscount && (
              <span className="text-slate-400 line-through font-bold text-sm">
                ₹{mrpVal}
              </span>
            )}
            <span className="text-slate-900 font-black text-lg">
              ₹{sellingPriceVal}
            </span>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition-colors text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 px-4 bg-primary-600 text-white font-bold rounded-xl shadow-sm hover:bg-primary-700 transition-colors flex items-center justify-center gap-2 text-xs"
          >
            <Printer className="w-4 h-4" />
            Print 4 Labels (A4)
          </button>
        </div>
      </div>

      {/* Printable 4-Label Layout (Only visible during window.print()) */}
      <div className="printable-barcode-sheet hidden print:block">
        <div className="grid grid-cols-2 grid-rows-2 gap-[6mm] w-[190mm] h-[277mm] m-0 p-0 box-border">
          {[barcodeRefPrint0, barcodeRefPrint1, barcodeRefPrint2, barcodeRefPrint3].map((ref, idx) => (
            <div
              key={idx}
              className="w-full h-full border-2 border-black rounded-xl p-[5mm] box-border flex flex-col items-center justify-between text-center bg-white"
              style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}
            >
              {/* 1. Shop Name */}
              <div className="w-full text-center pt-1">
                <div className="text-[16pt] font-black text-black uppercase tracking-wider max-w-[95%] truncate mx-auto leading-none">
                  {displayShopName}
                </div>
              </div>

              {/* 2. Barcode Graphic & 3. Barcode Value */}
              <div className="w-full flex flex-col items-center justify-center my-1">
                <svg ref={ref} className="w-[85%] h-[22mm]"></svg>
                <div className="text-[14pt] font-mono font-black tracking-widest text-black mt-1 bg-slate-100 px-3 py-0.5 rounded border border-slate-300">
                  {product.barcode}
                </div>
              </div>

              {/* 4. Product Name */}
              <div className="w-full text-center">
                <div className="text-[16pt] font-black text-black uppercase tracking-wide max-w-[95%] truncate mx-auto leading-tight">
                  {displayProductName}
                </div>
              </div>

              {/* 5. Price Section (Only raw prices: crossed out MRP + prominent Selling Price) */}
              <div className="w-full text-center pb-2 flex items-center justify-center gap-6">
                {showDiscount && (
                  <span className="text-[15pt] font-bold text-slate-600 line-through">
                    ₹{mrpVal}
                  </span>
                )}
                <span className="text-[19pt] font-black text-black">
                  ₹{sellingPriceVal}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

