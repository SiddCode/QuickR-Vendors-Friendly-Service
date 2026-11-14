import { useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { Search, X, Package, Barcode, Plus } from 'lucide-react';
import type { Product } from '../types';

export interface InlineProductSearchRef {
  focus: () => void;
  clear: () => void;
  close: () => void;
  open: () => void;
}

interface InlineProductSearchProps {
  products: Product[];
  onSelectProduct: (product: Product) => void;
  className?: string;
  placeholder?: string;
  maxListHeightClass?: string;
}

export const InlineProductSearch = forwardRef<InlineProductSearchRef, InlineProductSearchProps>(({
  products,
  onSelectProduct,
  className = '',
  placeholder = 'Search product name or barcode...',
  maxListHeightClass = 'max-h-56'
}, ref) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      setIsOpen(true);
      setHighlightedIndex(0);
      internalInputRef.current?.focus();
    },
    clear: () => {
      setSearchQuery('');
      setHighlightedIndex(0);
    },
    close: () => {
      setIsOpen(false);
    },
    open: () => {
      setIsOpen(true);
      setHighlightedIndex(0);
    }
  }));

  // Close when clicking outside container
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Handle Escape key to close results
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filter to active products only
  const activeProducts = useMemo(() => {
    return products.filter(p => Boolean(p.isActive));
  }, [products]);

  // Real-time case-insensitive search by product name, barcode, or category with trimmed spaces
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

  // Reset highlighted index when search query or results length change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, filteredProducts.length]);

  // Scroll highlighted item into view if keyboard navigated
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleClear = () => {
    setSearchQuery('');
    setHighlightedIndex(0);
    internalInputRef.current?.focus();
  };

  const handleSelect = (product: Product) => {
    onSelectProduct(product);
    setSearchQuery('');
    setIsOpen(false);
    setHighlightedIndex(0);
  };

  return (
    <div 
      ref={containerRef}
      className={`bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3 sm:p-4 space-y-3 transition-all ${className}`}
    >
      {/* Search Input Bar */}
      <div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={internalInputRef}
            type="text"
            inputMode="search"
            placeholder={placeholder}
            value={searchQuery}
            onFocus={() => setIsOpen(true)}
            onClick={() => setIsOpen(true)}
            onChange={e => {
              setSearchQuery(e.target.value);
              setHighlightedIndex(0);
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                internalInputRef.current?.blur();
              } else if (e.key === 'ArrowDown') {
                if (!isOpen) {
                  setIsOpen(true);
                } else if (filteredProducts.length > 0) {
                  e.preventDefault();
                  setHighlightedIndex(prev => (prev + 1) % filteredProducts.length);
                }
              } else if (e.key === 'ArrowUp') {
                if (isOpen && filteredProducts.length > 0) {
                  e.preventDefault();
                  setHighlightedIndex(prev => (prev - 1 + filteredProducts.length) % filteredProducts.length);
                }
              } else if (e.key === 'Enter') {
                if (isOpen && filteredProducts.length > 0) {
                  e.preventDefault();
                  const target = filteredProducts[highlightedIndex] || filteredProducts[0];
                  if (target) handleSelect(target);
                }
              }
            }}
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-full transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Count / Status Info (Only visible when list is open) */}
        {isOpen && (
          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-400 px-1 pt-2 font-medium">
            <span>
              {searchQuery.trim() ? (
                <>Found <strong className="text-slate-700 font-bold">{filteredProducts.length}</strong> matching {filteredProducts.length === 1 ? 'product' : 'products'}</>
              ) : (
                <>All active products (<strong className="text-slate-700 font-bold">{activeProducts.length}</strong>) • Sorted A–Z</>
              )}
              <span className="ml-2 hidden sm:inline text-slate-400 font-normal">
                • <kbd className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-500">↑</kbd> <kbd className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-500">↓</kbd> navigate • <kbd className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-500">Enter</kbd> add
              </span>
            </span>
            <div className="flex items-center gap-2">
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
                >
                  Clear filter
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-medium hover:underline cursor-pointer"
              >
                Hide list
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Product List directly below search input — ONLY shown when isOpen is true */}
      {isOpen && (
        <div className={`overflow-y-auto divide-y divide-slate-100 pr-0.5 pt-1 border-t border-slate-100 ${maxListHeightClass}`}>
          {activeProducts.length === 0 ? (
            <div className="p-4 sm:p-6 text-center flex flex-col items-center justify-center space-y-1.5 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
              <Package className="w-6 h-6 text-slate-300" />
              <p className="text-xs font-bold text-slate-700">No active products available</p>
              <p className="text-[11px] text-slate-400 max-w-xs">
                Activate products in Inventory to add them to customer bills.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-4 sm:p-6 text-center flex flex-col items-center justify-center space-y-2 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
              <Package className="w-6 h-6 text-slate-300" />
              <p className="text-xs font-bold text-slate-700">No products found</p>
              <p className="text-[11px] text-slate-400 max-w-xs">
                No active products match "{searchQuery.trim()}". Check the spelling or search by barcode.
              </p>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-1.5 bg-slate-200/80 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 pt-1">
              {filteredProducts.map((p, idx) => {
                const isLen = p.measurementType === 'length';
                const isHighlighted = idx === highlightedIndex;
                return (
                  <div
                    key={p.id}
                    ref={el => { itemRefs.current[idx] = el; }}
                    onClick={() => handleSelect(p)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full text-left p-2.5 sm:p-3 rounded-xl border transition-all flex items-center justify-between gap-3 group cursor-pointer shadow-2xs ${
                      isHighlighted 
                        ? 'bg-blue-50/90 border-blue-400 ring-2 ring-blue-300' 
                        : 'bg-white hover:bg-blue-50/40 border-slate-200/70 hover:border-blue-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-bold text-xs sm:text-sm truncate ${
                          isHighlighted ? 'text-blue-800' : 'text-slate-800 group-hover:text-blue-700'
                        }`}>
                          {p.name}
                        </span>
                        {p.category && (
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold shrink-0">
                            {p.category}
                          </span>
                        )}
                        {isLen && (
                          <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-bold shrink-0">
                            Fabric / Metres
                          </span>
                        )}
                        {isHighlighted && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold shrink-0">
                            Selected
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-slate-500">
                        {p.barcode && (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] sm:text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100 shrink-0">
                            <Barcode className="w-3 h-3" />
                            {p.barcode}
                          </span>
                        )}
                        {p.availability !== undefined && (
                          <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                            Stock: <strong className="text-slate-700 font-bold">{p.availability} {isLen ? 'm' : 'pcs'}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-2.5">
                      <div>
                        <div className={`text-xs sm:text-sm font-black ${
                          isHighlighted ? 'text-blue-700' : 'text-slate-900 group-hover:text-blue-600'
                        }`}>
                          ₹{p.sellingPrice.toLocaleString('en-IN')}{isLen ? '/m' : ''}
                        </div>
                        {p.originalPrice && p.originalPrice > p.sellingPrice && (
                          <div className="text-[10px] text-slate-400 line-through">
                            ₹{p.originalPrice.toLocaleString('en-IN')}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(p);
                        }}
                        className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                          isHighlighted
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'
                        }`}
                        title="Add to bill (or press Enter)"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

InlineProductSearch.displayName = 'InlineProductSearch';
