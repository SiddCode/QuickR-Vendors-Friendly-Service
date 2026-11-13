import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Package, Barcode, Plus } from 'lucide-react';
import type { Product } from '../types';

interface AddProductSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  products: Product[];
  title?: string;
  subtitle?: string;
}

export const AddProductSelectModal: React.FC<AddProductSelectModalProps> = ({
  isOpen,
  onClose,
  onSelectProduct,
  products,
  title = 'Select Product to Add',
  subtitle = 'Search and select active products for billing'
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset search and auto-focus when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter to active products only and sort alphabetically
  const activeProducts = useMemo(() => {
    return products.filter(p => p.isActive);
  }, [products]);

  // Real-time case-insensitive search by product name or barcode with trimmed spaces
  const filteredProducts = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    let result = activeProducts;

    if (trimmed) {
      result = activeProducts.filter(p => {
        const nameMatch = p.name ? p.name.toLowerCase().includes(trimmed) : false;
        const barcodeMatch = p.barcode ? p.barcode.toLowerCase().includes(trimmed) : false;
        const categoryMatch = p.category ? p.category.toLowerCase().includes(trimmed) : false;
        return nameMatch || barcodeMatch || categoryMatch;
      });
    }

    // Ascending A-Z alphabetical sorting (case-insensitive)
    return [...result].sort((a, b) => 
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );
  }, [activeProducts, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn font-sans">
      <div 
        className="bg-white rounded-2xl sm:rounded-3xl max-w-xl w-full max-h-[85vh] sm:max-h-[80vh] flex flex-col border border-slate-100 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar (Sticky at Top) */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by product name or barcode..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filteredProducts.length === 1) {
                  e.preventDefault();
                  onSelectProduct(filteredProducts[0]);
                }
              }}
              className="w-full pl-10 pr-10 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-2 font-medium">
            <span>
              {searchQuery.trim() ? (
                <>Found <strong className="text-slate-700">{filteredProducts.length}</strong> matching {filteredProducts.length === 1 ? 'product' : 'products'}</>
              ) : (
                <>Showing all <strong className="text-slate-700">{activeProducts.length}</strong> active products (A–Z)</>
              )}
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-primary-600 hover:text-primary-800 font-bold hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>

        {/* Product List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-100">
          {activeProducts.length === 0 ? (
            <div className="p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-3">
              <Package className="w-10 h-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">No active products available</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Activate or add products in the Products inventory section to bill them.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-3">
              <Package className="w-10 h-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">No products found</p>
              <p className="text-xs text-slate-500 max-w-xs">
                No active products match "{searchQuery.trim()}". Check the spelling or search by barcode.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProducts.map(p => {
                const isLen = p.measurementType === 'length';
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProduct(p)}
                    className="w-full text-left p-3 sm:p-3.5 bg-white hover:bg-primary-50/50 rounded-xl border border-slate-200/80 hover:border-primary-300 transition-all flex items-center justify-between gap-3 group shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-800 group-hover:text-primary-700 truncate">
                          {p.name}
                        </span>
                        {p.category && (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold shrink-0">
                            {p.category}
                          </span>
                        )}
                        {isLen && (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-bold shrink-0">
                            Fabric / Metres
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-slate-500">
                        {p.barcode && (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shrink-0">
                            <Barcode className="w-3 h-3" />
                            {p.barcode}
                          </span>
                        )}
                        {p.availability !== undefined && (
                          <span className="text-[11px] text-slate-500 font-medium">
                            Stock: <strong className="text-slate-700">{p.availability} {isLen ? 'm' : 'pcs'}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div>
                        <div className="text-sm sm:text-base font-black text-slate-900 group-hover:text-primary-600">
                          ₹{p.sellingPrice.toLocaleString('en-IN')}{isLen ? '/m' : ''}
                        </div>
                        {p.originalPrice && p.originalPrice > p.sellingPrice && (
                          <div className="text-[11px] text-slate-400 line-through">
                            ₹{p.originalPrice.toLocaleString('en-IN')}
                          </div>
                        )}
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center group-hover:bg-primary-600 group-hover:text-white transition-colors shrink-0">
                        <Plus className="w-4 h-4" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="hidden sm:inline">Tip: Press Enter to select single search result, or Esc to close.</span>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 transition-colors ml-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
