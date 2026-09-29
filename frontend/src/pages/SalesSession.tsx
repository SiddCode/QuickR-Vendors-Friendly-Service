import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Plus, 
  X, 
  Receipt, 
  Search, 
  Check, 
  ChevronDown, 
  Camera, 
  Barcode, 
  AlertTriangle, 
  Printer, 
  MessageSquare, 
  CheckCircle2, 
  Play, 
  Power, 
  User as UserIcon,
  ShoppingCart,
  Keyboard
} from 'lucide-react';
import { api } from '../services/api';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { openWhatsApp, buildWhatsAppBillMessage } from '../utils/whatsapp';
import { printSaleInvoiceWindow } from '../utils/printInvoice';

interface SalesSessionProps {
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

export const SalesSession: React.FC<SalesSessionProps> = ({ setCurrentPage, billingInitialData: _billingInitialData }) => {
  const { 
    currentUser, 
    customers, 
    products, 
    createSale, 
    shopProfile, 
    shopName, 
    connectionState, 
    checkHealth,
    salesSessionActive,
    startSalesSession,
    endSalesSession,
    refreshData
  } = useApp();

  const [connectingMsg, setConnectingMsg] = useState<string | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);

  const activeProducts = products.filter(p => p.isActive);

  // Focus Refs for Keyboard Navigation
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const customerSearchInputRef = useRef<HTMLInputElement>(null);
  const walkinCustomerNameRef = useRef<HTMLInputElement>(null);
  const walkinCustomerPhoneRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);
  const paymentMethodContainerRef = useRef<HTMLDivElement>(null);
  const completeSaleBtnRef = useRef<HTMLButtonElement>(null);

  // Barcode scanning state
  const [barcodeEnabled] = useState<boolean>(() => {
    return localStorage.getItem('quickr_barcode_scanning_enabled') === 'true';
  });
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [outOfStockProduct, setOutOfStockProduct] = useState<any | null>(null);

  // Product Search State
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(0);
  const productDropdownRef = useRef<HTMLDivElement>(null);

  // Customer state
  const [isWalkIn, setIsWalkIn] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(0);
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
  
  // Cart items & Selected Cart Item for Keyboard +/-/Delete
  const [items, setItems] = useState<BillItem[]>([]);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);

  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [isDiscountDropdownOpen, setIsDiscountDropdownOpen] = useState(false);
  const discountDropdownRef = useRef<HTMLDivElement>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');

  // Filtered Products for Search Dropdown (capped at 20 results, empty when no query)
  const trimmedProdQuery = productSearchQuery.trim().toLowerCase();
  const filteredSearchProducts = trimmedProdQuery ? activeProducts.filter(p => {
    const nameMatch = p.name ? p.name.toLowerCase().includes(trimmedProdQuery) : false;
    const barcodeMatch = p.barcode ? p.barcode.toLowerCase().includes(trimmedProdQuery) : false;
    const categoryMatch = p.category ? p.category.toLowerCase().includes(trimmedProdQuery) : false;
    return nameMatch || barcodeMatch || categoryMatch;
  }).slice(0, 20) : [];

  // Filtered Customers for Search Dropdown
  const trimmedQuery = customerSearchQuery.trim().toLowerCase();
  const filteredCustomers = customers.filter(c => {
    if (!trimmedQuery) return true;
    const nameMatch = c.name ? c.name.toLowerCase().includes(trimmedQuery) : false;
    const phoneMatch = c.phone ? c.phone.toLowerCase().includes(trimmedQuery) : false;
    return nameMatch || phoneMatch;
  });

  const selectedCustomerObj = customers.find(c => c.id === selectedCustomerId);

  // 1. DEFAULT FOCUS: Automatically focus Product Search when session is active
  useEffect(() => {
    if (salesSessionActive) {
      const timer = setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [salesSessionActive]);

  // Helper: Add or increment product in cart by product object
  const addScannedProductToCart = (prod: any) => {
    if (!prod) return;
    if (prod.availability !== undefined && prod.availability <= 0) {
      setOutOfStockProduct(prod);
      return;
    }

    setItems(prevItems => {
      const existingIndex = prevItems.findIndex(i => i.productId === prod.id);
      if (existingIndex >= 0) {
        setSelectedCartItemId(prevItems[existingIndex].id);
        return prevItems.map((item, idx) => {
          if (idx === existingIndex) {
            return { ...item, quantity: item.quantity + 1 };
          }
          return item;
        });
      } else {
        const newItemId = Date.now().toString();
        setSelectedCartItemId(newItemId);
        return [
          ...prevItems,
          {
            id: newItemId,
            productId: prod.id,
            quantity: 1,
            rate: prod.sellingPrice
          }
        ];
      }
    });

    // Reset product search and return focus to Product Search input
    setProductSearchQuery('');
    setIsProductDropdownOpen(false);
    setTimeout(() => {
      productSearchInputRef.current?.focus();
    }, 50);
  };

  // Helper: Process scanned barcode string
  const processScannedBarcode = async (scannedCode: string) => {
    const cleanCode = scannedCode.trim().toUpperCase();
    if (!cleanCode) return;

    try {
      const localMatch = products.find(p => p.barcode && p.barcode.toUpperCase() === cleanCode);
      if (localMatch) {
        addScannedProductToCart(localMatch);
        return;
      }

      const foundProduct = await api.getProductByBarcode(cleanCode);
      if (foundProduct && foundProduct.id) {
        addScannedProductToCart(foundProduct);
      } else {
        setNotFoundBarcode(cleanCode);
      }
    } catch (err: any) {
      console.error('Barcode lookup error:', err);
      setNotFoundBarcode(cleanCode);
    }
  };

  // USB / Bluetooth Scanner Keyboard Wedge & Global POS Keydown Listener
  const keyBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!salesSessionActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const targetTag = activeEl?.tagName?.toUpperCase();
      const isInputActive = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || activeEl?.isContentEditable;

      // Handle Modals / Dialogs Escape key
      if (e.key === 'Escape') {
        if (showKeyboardHelp) {
          e.preventDefault();
          setShowKeyboardHelp(false);
          return;
        }
        if (isCameraScannerOpen) {
          e.preventDefault();
          setIsCameraScannerOpen(false);
          return;
        }
        if (notFoundBarcode) {
          e.preventDefault();
          setNotFoundBarcode(null);
          return;
        }
        if (outOfStockProduct) {
          e.preventDefault();
          setOutOfStockProduct(null);
          return;
        }
        if (isProductDropdownOpen) {
          e.preventDefault();
          setIsProductDropdownOpen(false);
          return;
        }
        if (isDropdownOpen) {
          e.preventDefault();
          setIsDropdownOpen(false);
          return;
        }
        if (isDiscountDropdownOpen) {
          e.preventDefault();
          setIsDiscountDropdownOpen(false);
          return;
        }
      }

      // ─── GLOBAL FUNCTION KEYS & POS SHORTCUTS (Work even if focused inside inputs) ───
      if (e.key === 'F10') {
        e.preventDefault();
        handleCompleteSale();
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        if (productSearchQuery.trim()) {
          setIsProductDropdownOpen(true);
        }
        productSearchInputRef.current?.focus();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (isWalkIn) {
          walkinCustomerNameRef.current?.focus();
        } else {
          setIsDropdownOpen(true);
          customerSearchInputRef.current?.focus();
        }
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        paymentMethodContainerRef.current?.focus();
        return;
      }

      // ─── SINGLE-LETTER SHORTCUTS (Only when NOT actively typing in an editable field) ───
      if (!isInputActive) {
        const lowerKey = e.key.toLowerCase();
        
        if (lowerKey === 's') {
          e.preventDefault();
          if (barcodeEnabled) {
            setIsCameraScannerOpen(true);
          } else {
            productSearchInputRef.current?.focus();
          }
          return;
        }

        if (lowerKey === 'c') {
          e.preventDefault();
          if (isWalkIn) {
            walkinCustomerNameRef.current?.focus();
          } else {
            setIsDropdownOpen(true);
            customerSearchInputRef.current?.focus();
          }
          return;
        }

        if (lowerKey === 'd') {
          e.preventDefault();
          discountInputRef.current?.focus();
          return;
        }

        if (lowerKey === 'p') {
          e.preventDefault();
          paymentMethodContainerRef.current?.focus();
          return;
        }

        // Cart Item Quantity Adjustment Shortcuts (+ / - / Delete)
        if (selectedCartItemId) {
          if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            setItems(prev => prev.map(item => item.id === selectedCartItemId ? { ...item, quantity: item.quantity + 1 } : item));
            return;
          }
          if (e.key === '-') {
            e.preventDefault();
            setItems(prev => prev.map(item => {
              if (item.id === selectedCartItemId && item.quantity > 1) {
                return { ...item, quantity: item.quantity - 1 };
              }
              return item;
            }));
            return;
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            handleRemoveItem(selectedCartItemId);
            return;
          }
        }

        // Payment Method Arrow Selection when container focused
        if (activeEl === paymentMethodContainerRef.current) {
          const methods = ['Cash', 'UPI', 'Card', 'Other'];
          const currentIndex = methods.indexOf(paymentMethod);
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % methods.length;
            setPaymentMethod(methods[nextIndex]);
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + methods.length) % methods.length;
            setPaymentMethod(methods[prevIndex]);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            completeSaleBtnRef.current?.focus();
            return;
          }
        }

        // USB / Bluetooth Scanner Keyboard Buffer Detection
        const currentTime = Date.now();
        if (currentTime - lastKeyTimeRef.current > 100) {
          keyBufferRef.current = '';
        }
        lastKeyTimeRef.current = currentTime;

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        if (e.key === 'Enter') {
          const barcodeVal = keyBufferRef.current.trim();
          if (barcodeVal) {
            e.preventDefault();
            processScannedBarcode(barcodeVal);
          }
          keyBufferRef.current = '';
        } else if (e.key.length === 1) {
          keyBufferRef.current += e.key;

          debounceTimerRef.current = setTimeout(() => {
            const barcodeVal = keyBufferRef.current.trim();
            if (barcodeVal.length >= 6 && barcodeVal.startsWith('QKR-')) {
              processScannedBarcode(barcodeVal);
              keyBufferRef.current = '';
            }
          }, 180);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [salesSessionActive, products, isWalkIn, showKeyboardHelp, isCameraScannerOpen, notFoundBarcode, outOfStockProduct, isProductDropdownOpen, isDropdownOpen, isDiscountDropdownOpen, selectedCartItemId, paymentMethod, barcodeEnabled]);

  // Handle outside click to close customer dropdown and discount dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setIsProductDropdownOpen(false);
      }
      if (discountDropdownRef.current && !discountDropdownRef.current.contains(e.target as Node)) {
        setIsDiscountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddItem = () => {
    if (activeProducts.length === 0) return;
    const newItemId = Date.now().toString();
    setItems([...items, {
      id: newItemId,
      productId: activeProducts[0].id,
      quantity: 1,
      rate: activeProducts[0].sellingPrice
    }]);
    setSelectedCartItemId(newItemId);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
    if (selectedCartItemId === id) {
      setSelectedCartItemId(null);
    }
  };

  const handleItemChange = (id: string, field: keyof BillItem, value: any) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'productId') {
          const prod = activeProducts.find(p => p.id === value);
          if (prod) updated.rate = prod.sellingPrice;
        }
        return updated;
      }
      return item;
    }));
  };

  // Current customer bill calculations
  const isGstRegistered = !!shopProfile?.isGstRegistered;
  const shopGstin = shopProfile?.gstin || '';

  const rawSubtotal = items.reduce((acc, i) => acc + (i.quantity * i.rate), 0);
  
  let validatedDiscountValue = Math.max(0, Number(discountValue) || 0);
  let discountAmount = 0;

  if (discountType === 'percentage') {
    validatedDiscountValue = Math.min(100, validatedDiscountValue);
    discountAmount = Math.round(((rawSubtotal * validatedDiscountValue) / 100) * 100) / 100;
  } else {
    validatedDiscountValue = Math.min(rawSubtotal, validatedDiscountValue);
    discountAmount = Math.round(validatedDiscountValue * 100) / 100;
  }

  const enrichedItems = items.map(item => {
    const prod = products.find(p => p.id === item.productId);
    const lineTotal = item.quantity * item.rate;
    const itemGstRate = (isGstRegistered && prod && prod.gstRate !== undefined) ? prod.gstRate : 0;
    const priceIncludesGst = prod?.priceIncludesGst !== undefined ? prod.priceIncludesGst : true;
    
    let itemGstAmount = 0;
    let itemTaxableAmount = lineTotal;

    if (isGstRegistered && itemGstRate > 0) {
      const lineSubtotalAfterDiscount = rawSubtotal > 0 ? (lineTotal * (1 - (discountAmount / rawSubtotal))) : lineTotal;

      if (priceIncludesGst) {
        itemTaxableAmount = Math.round((lineSubtotalAfterDiscount / (1 + itemGstRate / 100)) * 100) / 100;
        itemGstAmount = Math.round((lineSubtotalAfterDiscount - itemTaxableAmount) * 100) / 100;
      } else {
        itemTaxableAmount = Math.round(lineSubtotalAfterDiscount * 100) / 100;
        itemGstAmount = Math.round((itemTaxableAmount * (itemGstRate / 100)) * 100) / 100;
      }
    } else {
      itemTaxableAmount = rawSubtotal > 0 ? Math.round((lineTotal * (1 - (discountAmount / rawSubtotal))) * 100) / 100 : lineTotal;
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

  const subtotal = rawSubtotal;
  const hasInclusiveItems = enrichedItems.some(i => i.gstRate > 0 && i.priceIncludesGst);
  const totalGst = isGstRegistered ? Math.round(enrichedItems.reduce((acc, item) => acc + item.gstAmount, 0) * 100) / 100 : 0;

  let taxableSubtotal = Math.max(0, subtotal - discountAmount);
  if (isGstRegistered && hasInclusiveItems) {
    taxableSubtotal = Math.round(enrichedItems.reduce((acc, item) => acc + item.taxableAmount, 0) * 100) / 100;
  }

  const grandTotalAmount = isGstRegistered 
    ? Math.round((taxableSubtotal + totalGst) * 100) / 100 
    : Math.max(0, subtotal - discountAmount);

  const handleDiscountInputChange = (valStr: string) => {
    if (valStr === '') {
      setDiscountValue(0);
      return;
    }
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    if (val < 0) {
      setDiscountValue(0);
    } else if (discountType === 'percentage' && val > 100) {
      setDiscountValue(100);
    } else if (discountType === 'amount' && subtotal > 0 && val > subtotal) {
      setDiscountValue(subtotal);
    } else {
      setDiscountValue(val);
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowWhatsAppOffers, setAllowWhatsAppOffers] = useState<boolean>(true);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const handleCompleteSale = async () => {
    if (items.length === 0) return alert('Please add at least one product to the sale.');
    if (isSubmitting) return;
    
    if (connectionState !== 'ready') {
      setConnectingMsg('Connecting to server...');
      const isAlive = await checkHealth();
      setConnectingMsg(null);
      if (!isAlive) {
        alert('Server is currently offline or reconnecting. Please try again in a moment.');
        return;
      }
    }

    const requestIdToUse = activeRequestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    if (!activeRequestId) {
      setActiveRequestId(requestIdToUse);
    }

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
      discount: discountValue,
      discountType,
      totalGst,
      totalAmount: grandTotalAmount,
      paymentMethod,
      source: 'direct',
      requestId: requestIdToUse
    };

    setIsSubmitting(true);
    try {
      const sale = await createSale(payload);
      if (sale) {
        setActiveRequestId(null);
        setItems([]);
        setDiscountValue(0);
        setCustomerName('');
        setCustomerPhone('');
        setSelectedCustomerId('');
        setIsWalkIn(true);
        await refreshData();
        setCurrentPage('sales');
      }
    } catch (err) {
      console.error('Failed to complete sale:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [completedSale, setCompletedSale] = useState<any | null>(null);

  const handleStartNewSale = () => {
    setCompletedSale(null);
    setItems([]);
    setDiscountValue(0);
    setCustomerName('');
    setCustomerPhone('');
    setSelectedCustomerId('');
    setIsWalkIn(true);
    setTimeout(() => {
      productSearchInputRef.current?.focus();
    }, 50);
  };

  return (
    <div className="flex-grow p-4 lg:p-8 space-y-6 bg-slate-50 min-h-screen font-sans">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ─── SESSION HEADER ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-800">Sales Session</h1>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                salesSessionActive 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${salesSessionActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {salesSessionActive ? 'Session Active' : 'Session Inactive'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-semibold flex items-center gap-2">
              <UserIcon className="w-3.5 h-3.5 text-slate-400" />
              Staff Name: <strong className="text-slate-700 font-bold">{currentUser?.name || 'Staff Member'}</strong>
              <span className="text-slate-300">•</span>
              <span>Shop: <strong className="text-slate-700">{shopName}</strong></span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors border border-slate-200"
              title="Keyboard Shortcuts (/help)"
            >
              <Keyboard className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Shortcuts</span>
            </button>

            {salesSessionActive ? (
              <button
                onClick={() => {
                  if (items.length > 0 && !confirm('You have items in your current cart. End sales session?')) {
                    return;
                  }
                  endSalesSession();
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition-colors shadow-2xs"
              >
                <Power className="w-4 h-4" /> End Sales Session
              </button>
            ) : (
              <button
                onClick={startSalesSession}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors shadow-sm"
              >
                <Play className="w-4 h-4" /> Start Sales Session
              </button>
            )}
          </div>
        </div>

        {/* ─── INACTIVE SESSION PLACEHOLDER ─── */}
        {!salesSessionActive ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
              <ShoppingCart className="w-8 h-8" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h2 className="text-lg font-bold text-slate-800">No Sales Session Active</h2>
              <p className="text-xs text-slate-500 font-medium">
                Click "Start Sales Session" to activate your POS workspace, scan barcodes, and process customer bills.
              </p>
            </div>
            <button
              onClick={startSalesSession}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition-all inline-flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> Start Sales Session
            </button>
          </div>
        ) : (
          /* ─── ACTIVE SESSION WORKSPACE ─── */
          <div className="space-y-6">

            {/* KEYBOARD-FIRST PRODUCT SEARCH & BARCODE ACTION BAR */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950 rounded-2xl p-4 text-white shadow-md space-y-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0">
                    <Barcode className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
                      POS Product Search & Barcode Scanner <span className="bg-indigo-500/30 text-indigo-200 text-[10px] px-2 py-0.5 rounded-md border border-indigo-400/30">F2</span>
                    </h3>
                    <p className="text-[11px] text-slate-300 font-medium">Type name/barcode or scan USB scanner. Press ↑ ↓ and Enter to add.</p>
                  </div>
                </div>

                {barcodeEnabled && (
                  <button
                    onClick={() => setIsCameraScannerOpen(true)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow-sm transition-colors shrink-0"
                  >
                    <Camera className="w-4 h-4" /> Camera Scan <span className="text-[10px] bg-indigo-700/60 px-1.5 py-0.5 rounded">S</span>
                  </button>
                )}
              </div>

              {/* PRODUCT SEARCH DROPDOWN INPUT */}
              <div ref={productDropdownRef} className="relative">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    ref={productSearchInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={isProductDropdownOpen && filteredSearchProducts.length > 0}
                    aria-haspopup="listbox"
                    placeholder="Type product name or scan barcode (e.g. Cotton Shirt or 890123...)"
                    value={productSearchQuery}
                    onFocus={() => {
                      if (productSearchQuery.trim()) {
                        setIsProductDropdownOpen(true);
                        setHighlightedProductIndex(0);
                      }
                    }}
                    onChange={(e) => {
                      const newQuery = e.target.value;
                      setProductSearchQuery(newQuery);
                      if (newQuery.trim()) {
                        setIsProductDropdownOpen(true);
                      } else {
                        setIsProductDropdownOpen(false);
                      }
                      setHighlightedProductIndex(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        if (!isProductDropdownOpen && productSearchQuery.trim()) {
                          setIsProductDropdownOpen(true);
                          setHighlightedProductIndex(0);
                          e.preventDefault();
                          return;
                        }
                        if (isProductDropdownOpen && filteredSearchProducts.length > 0) {
                          e.preventDefault();
                          setHighlightedProductIndex(prev => (prev + 1) % filteredSearchProducts.length);
                          return;
                        }
                      }

                      if (e.key === 'ArrowUp') {
                        if (isProductDropdownOpen && filteredSearchProducts.length > 0) {
                          e.preventDefault();
                          setHighlightedProductIndex(prev => (prev - 1 + filteredSearchProducts.length) % filteredSearchProducts.length);
                          return;
                        }
                      }

                      if (e.key === 'Enter') {
                        if (isProductDropdownOpen && filteredSearchProducts.length > 0) {
                          e.preventDefault();
                          const targetProd = filteredSearchProducts[highlightedProductIndex] || filteredSearchProducts[0];
                          if (targetProd) {
                            addScannedProductToCart(targetProd);
                          }
                        }
                      }
                    }}
                    className="w-full bg-slate-800/90 border border-indigo-400/40 focus:border-indigo-300 rounded-xl py-2.5 pl-10 pr-10 text-sm font-semibold text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 shadow-inner transition-all"
                  />
                  {productSearchQuery && (
                    <button
                      onClick={() => {
                        setProductSearchQuery('');
                        setIsProductDropdownOpen(false);
                        productSearchInputRef.current?.focus();
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* PRODUCT SEARCH DROPDOWN RESULTS */}
                {isProductDropdownOpen && productSearchQuery.trim() !== '' && (
                  <div role="listbox" className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto py-1 text-sm text-slate-800 divide-y divide-slate-100">
                    {filteredSearchProducts.length > 0 ? (
                      filteredSearchProducts.map((p, idx) => {
                        const isHighlighted = idx === highlightedProductIndex;
                        return (
                          <div
                            key={p.id}
                            role="option"
                            aria-selected={isHighlighted}
                            onClick={() => addScannedProductToCart(p)}
                            onMouseEnter={() => setHighlightedProductIndex(idx)}
                            className={`px-4 py-2.5 cursor-pointer flex items-center justify-between transition-colors ${
                              isHighlighted ? 'bg-primary-50 text-primary-900 font-bold border-l-4 border-primary-600' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900">{p.name}</span>
                              <span className="text-xs text-slate-500 font-medium">
                                Category: {p.category} {p.barcode ? `| Barcode: ${p.barcode}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-right">
                              <div>
                                <span className="block text-xs font-black text-emerald-600">₹{p.sellingPrice.toLocaleString('en-IN')}</span>
                                <span className="text-[10px] text-slate-400 font-semibold">Stock: {p.availability || 0}</span>
                              </div>
                              {isHighlighted && <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded font-bold">Press Enter ↵</span>}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-xs text-slate-400 font-semibold text-center">
                        No matching products found. Try scanning barcode or typing name.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MAIN BILLING FORM CARD */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              
              {/* CUSTOMER SECTION */}
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-slate-400" /> Customer Information <span className="bg-slate-200 text-slate-700 text-[10px] px-2 py-0.5 rounded font-bold">F4 / C</span>
                  </h2>
                  <span className="text-xs text-slate-400 font-medium">Press <kbd className="bg-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-700">Tab</kbd> to move field</span>
                </div>
                
                <div className="flex gap-4 mb-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input 
                      type="radio" 
                      checked={isWalkIn} 
                      onChange={() => setIsWalkIn(true)} 
                      className="text-primary-600 focus:ring-primary-500 w-4 h-4"
                    />
                    Walk-in Customer
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input 
                      type="radio" 
                      checked={!isWalkIn} 
                      onChange={() => setIsWalkIn(false)} 
                      className="text-primary-600 focus:ring-primary-500 w-4 h-4"
                    />
                    Existing Customer
                  </label>
                </div>

                {isWalkIn ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Customer Name (Optional)</label>
                        <input 
                          ref={walkinCustomerNameRef}
                          type="text" 
                          placeholder="e.g. Ramesh"
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 font-medium text-slate-800 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number (Optional)</label>
                        <input 
                          ref={walkinCustomerPhoneRef}
                          type="tel" 
                          placeholder="e.g. 9876543210"
                          value={customerPhone}
                          onChange={e => setCustomerPhone(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 font-medium text-slate-800 font-mono transition-all"
                        />
                      </div>
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
                              className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-800 focus:outline-none focus:border-primary-500"
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
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-600 cursor-not-allowed"
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
                            className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-primary-500 uppercase tracking-wider"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div ref={dropdownRef} className="relative">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Select Customer *</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Search className="w-4 h-4" />
                      </div>
                      <input
                        ref={customerSearchInputRef}
                        type="text"
                        placeholder="🔍 Search by name or phone..."
                        value={isDropdownOpen ? customerSearchQuery : (selectedCustomerObj ? `${selectedCustomerObj.name} (${selectedCustomerObj.phone})` : customerSearchQuery)}
                        onFocus={() => {
                          setIsDropdownOpen(true);
                          setCustomerSearchQuery('');
                          setHighlightedCustomerIndex(0);
                        }}
                        onChange={(e) => {
                          setCustomerSearchQuery(e.target.value);
                          if (!isDropdownOpen) setIsDropdownOpen(true);
                          setHighlightedCustomerIndex(0);
                        }}
                        onKeyDown={(e) => {
                          if (!isDropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                            setIsDropdownOpen(true);
                            return;
                          }

                          if (isDropdownOpen && filteredCustomers.length > 0) {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setHighlightedCustomerIndex(prev => (prev + 1) % filteredCustomers.length);
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setHighlightedCustomerIndex(prev => (prev - 1 + filteredCustomers.length) % filteredCustomers.length);
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              const targetCust = filteredCustomers[highlightedCustomerIndex];
                              if (targetCust) {
                                setSelectedCustomerId(targetCust.id);
                                setCustomerSearchQuery('');
                                setIsDropdownOpen(false);
                                productSearchInputRef.current?.focus();
                              }
                            }
                          }
                        }}
                        className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-10 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 shadow-2xs font-medium text-slate-800 transition-all"
                      />
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {isDropdownOpen && (
                      <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto py-1.5 text-sm divide-y divide-slate-50">
                        {filteredCustomers.length > 0 ? (
                          filteredCustomers.map((c, idx) => {
                            const isSelected = c.id === selectedCustomerId;
                            const isHighlighted = idx === highlightedCustomerIndex;
                            return (
                              <div
                                key={c.id}
                                onClick={() => {
                                  setSelectedCustomerId(c.id);
                                  setCustomerSearchQuery('');
                                  setIsDropdownOpen(false);
                                  productSearchInputRef.current?.focus();
                                }}
                                onMouseEnter={() => setHighlightedCustomerIndex(idx)}
                                className={`px-3.5 py-2.5 cursor-pointer flex items-center justify-between transition-colors ${
                                  isHighlighted ? 'bg-primary-50 font-bold border-l-4 border-primary-600' : ''
                                } ${isSelected ? 'text-primary-700' : ''}`}
                              >
                                <div className="flex flex-col">
                                  <span className={`font-bold ${isSelected ? 'text-primary-600' : 'text-slate-800'}`}>
                                    {c.name}
                                  </span>
                                  <span className="text-xs text-slate-400 font-medium font-mono">
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
                            No matching customers found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PRODUCTS / CART ITEMS SECTION */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    Current Sale Cart Items <span className="bg-slate-200 text-slate-700 text-[10px] px-2 py-0.5 rounded font-bold">+ / - / Delete</span>
                  </h2>
                  <span className="text-xs text-slate-400 font-semibold">{items.length} product(s) added</span>
                </div>
                
                {items.length === 0 ? (
                  <div className="p-6 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center bg-slate-50/50 space-y-2">
                    <ShoppingCart className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-bold text-slate-600">Cart is empty</p>
                    <p className="text-[11px] text-slate-400">Scan product barcode or use Product Search above to build customer bill</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items.map((item) => {
                      const isCartSelected = item.id === selectedCartItemId;
                      return (
                        <div 
                          key={item.id} 
                          onClick={() => setSelectedCartItemId(item.id)}
                          className={`p-3 sm:p-4 rounded-xl border flex flex-col sm:flex-row gap-3 items-stretch sm:items-end transition-all cursor-pointer ${
                            isCartSelected 
                              ? 'bg-primary-50/40 border-primary-400 shadow-xs ring-2 ring-primary-200' 
                              : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                          }`}
                        >
                          <div className="flex-grow w-full min-w-0">
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Select Product</label>
                            <select 
                              value={item.productId}
                              onChange={e => handleItemChange(item.id, 'productId', e.target.value)}
                              className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:border-primary-500 truncate"
                            >
                              {activeProducts.map(p => (
                                <option key={p.id} value={p.id}>{p.name} {p.barcode ? `(${p.barcode})` : ''}</option>
                              ))}
                            </select>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:flex items-center gap-3 w-full sm:w-auto">
                            <div className="w-full sm:w-24">
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity</label>
                              <input 
                                type="number" 
                                min="1"
                                value={item.quantity}
                                onChange={e => handleItemChange(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                                className="w-full bg-white border border-slate-200 rounded-xl py-2 px-2 text-xs sm:text-sm font-bold text-center text-slate-800 focus:outline-none focus:border-primary-500"
                              />
                            </div>

                            <div className="w-full sm:w-28">
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Rate (₹)</label>
                              <input 
                                type="number" 
                                min="0"
                                value={item.rate}
                                onChange={e => handleItemChange(item.id, 'rate', Math.max(0, Number(e.target.value)))}
                                className="w-full bg-white border border-slate-200 rounded-xl py-2 px-2 text-xs sm:text-sm font-bold text-center text-slate-800 focus:outline-none focus:border-primary-500"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 w-full sm:w-auto">
                            <div className="text-left sm:text-right">
                              <span className="block text-[10px] text-slate-400 font-bold uppercase">Item Total</span>
                              <span className="text-sm font-black text-slate-800">₹{(item.quantity * item.rate).toLocaleString('en-IN')}</span>
                            </div>

                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveItem(item.id);
                              }}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0 transition-colors"
                              title="Remove product (Delete)"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button 
                    onClick={handleAddItem}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-primary-600 font-bold text-xs hover:bg-primary-50 px-3.5 py-2.5 rounded-xl border border-primary-200 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Product
                  </button>
                  {barcodeEnabled && (
                    <button
                      onClick={() => setIsCameraScannerOpen(true)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-indigo-600 font-bold text-xs hover:bg-indigo-50 px-3.5 py-2.5 rounded-xl border border-indigo-200 transition-colors"
                    >
                      <Camera className="w-4 h-4" /> Camera Scan <span className="text-[10px] bg-indigo-100 px-1 rounded">S</span>
                    </button>
                  )}
                </div>
              </div>
              
              {/* PAYMENT & SUMMARY SECTION */}
              <div className="p-6 border-t border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between gap-6">
                
                {/* Payment Method */}
                <div 
                  ref={paymentMethodContainerRef}
                  tabIndex={0}
                  className="w-full md:w-1/2 space-y-3 focus:outline-none focus:ring-2 focus:ring-primary-400 rounded-xl p-2 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      Payment Method <span className="bg-slate-200 text-slate-700 text-[10px] px-2 py-0.5 rounded font-bold">F8 / P</span>
                    </h2>
                    <span className="text-[10px] text-slate-400 font-medium">Use ↑ ↓ Arrow Keys</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {['Cash', 'UPI', 'Card', 'Other'].map(method => (
                      <button
                        key={method}
                        onClick={() => setPaymentMethod(method)}
                        className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                          paymentMethod === method 
                            ? 'bg-primary-600 border-primary-600 text-white shadow-xs ring-2 ring-primary-300' 
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                {/* CURRENT CUSTOMER BILL SUMMARY */}
                <div className="w-full md:w-1/2 space-y-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">Current Customer Bill</h3>
                  
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                    <span>Subtotal</span>
                    <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  
                  {/* Discount line */}
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
                    <div ref={discountDropdownRef} className="relative flex items-center gap-1">
                      <span className="flex items-center gap-1">
                        Discount <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-bold">D</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDiscountDropdownOpen(!isDiscountDropdownOpen)}
                        className="flex items-center gap-0.5 text-[10px] font-extrabold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg border border-indigo-200 transition-colors"
                      >
                        <span>{discountType === 'percentage' ? '%' : '₹'}</span>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isDiscountDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isDiscountDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg text-xs font-semibold py-1 w-36 text-slate-700 divide-y divide-slate-50">
                          <button
                            type="button"
                            onClick={() => {
                              setDiscountType('percentage');
                              if (discountValue > 100) setDiscountValue(100);
                              setIsDiscountDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-between transition-colors ${
                              discountType === 'percentage' ? 'bg-indigo-50 text-indigo-600 font-bold' : ''
                            }`}
                          >
                            <span>Percentage (%)</span>
                            {discountType === 'percentage' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDiscountType('amount');
                              if (subtotal > 0 && discountValue > subtotal) setDiscountValue(subtotal);
                              setIsDiscountDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-between transition-colors ${
                              discountType === 'amount' ? 'bg-indigo-50 text-indigo-600 font-bold' : ''
                            }`}
                          >
                            <span>Amount (₹)</span>
                            {discountType === 'amount' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input 
                        ref={discountInputRef}
                        type="number" 
                        min="0"
                        max={discountType === 'percentage' ? 100 : subtotal}
                        step="any"
                        value={discountValue === 0 ? '' : discountValue}
                        onChange={e => handleDiscountInputChange(e.target.value)}
                        placeholder="0"
                        className="w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 text-center transition-all"
                      />
                      <span className="font-bold text-slate-600 text-xs">{discountType === 'percentage' ? '%' : '₹'}</span>
                    </div>
                  </div>

                  {discountAmount > 0 && (
                    <div className="flex justify-between items-center text-xs font-bold text-emerald-600">
                      <span>Discount ({discountType === 'percentage' ? `${validatedDiscountValue}%` : `₹${validatedDiscountValue}`}):</span>
                      <span>-₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}

                  {isGstRegistered && (
                    <div className="flex justify-between items-center text-xs font-bold text-indigo-600 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1">
                        GST Amount:
                        {shopGstin && <span className="text-[10px] text-slate-400 font-mono">({shopGstin})</span>}
                      </span>
                      <span>+₹{totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}

                  {/* PROMINENT CURRENT BILL TOTAL */}
                  <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">Total</span>
                    <span className="text-xl font-black text-emerald-600">₹{grandTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* ACTION FOOTER */}
              <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-between gap-4">
                <button 
                  ref={completeSaleBtnRef}
                  onClick={handleCompleteSale}
                  disabled={isSubmitting || items.length === 0 || connectingMsg !== null}
                  className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl shadow-md transition-all flex justify-center items-center gap-2 disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-4 focus:ring-emerald-300"
                >
                  <Receipt className="w-5 h-5" />
                  <span>{connectingMsg ? connectingMsg : (isSubmitting ? 'Completing Sale...' : 'Complete Sale')}</span>
                  <span className="bg-emerald-800/60 text-emerald-100 text-xs px-2 py-0.5 rounded font-mono font-bold">F10</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── KEYBOARD SHORTCUTS HELP MODAL ─── */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 border border-slate-100 animate-fadeIn font-sans">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-indigo-600" /> POS Keyboard Shortcuts
              </h3>
              <button onClick={() => setShowKeyboardHelp(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-medium text-slate-700">
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Product Search</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">F2</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Scan Barcode</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">S</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Focus Customer</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">F4 / C</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Focus Discount</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">D</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Focus Payment</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">F8 / P</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Increase Quantity</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">+</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Decrease Quantity</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">-</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Remove Item</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">Delete</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between col-span-2">
                <span>Complete Sale & View Invoices</span>
                <kbd className="bg-emerald-600 text-white px-2.5 py-1 rounded font-mono font-bold shadow-2xs">F10</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between col-span-2">
                <span>Close Dialog / Cancel</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-slate-600 border border-slate-200">Esc</kbd>
              </div>
            </div>

            <button
              onClick={() => setShowKeyboardHelp(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-colors"
            >
              Close Guide
            </button>
          </div>
        </div>
      )}

      {/* ─── CAMERA BARCODE SCANNER MODAL ─── */}
      {isCameraScannerOpen && (
        <BarcodeScannerModal
          onScanSuccess={(barcodeVal) => {
            processScannedBarcode(barcodeVal);
          }}
          onClose={() => setIsCameraScannerOpen(false)}
        />
      )}

      {/* ─── BARCODE NOT FOUND MODAL ─── */}
      {notFoundBarcode && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4 border border-slate-100 animate-fadeIn">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Product Not Found</h3>
              <p className="text-xs text-slate-500 mt-1">This barcode is not registered in inventory.</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Scanned Barcode</span>
              <span className="font-mono text-sm font-extrabold text-slate-800">{notFoundBarcode}</span>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setNotFoundBarcode(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-colors"
              >
                Close (Esc)
              </button>
              <button
                onClick={() => {
                  setNotFoundBarcode(null);
                  setIsCameraScannerOpen(true);
                }}
                className="flex-1 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-colors border border-indigo-200"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── OUT OF STOCK ALERT MODAL ─── */}
      {outOfStockProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4 border border-slate-100 animate-fadeIn">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Product Out of Stock</h3>
              <p className="text-xs text-slate-500 mt-1 font-semibold">{outOfStockProduct.name}</p>
            </div>
            <p className="text-xs text-slate-600 bg-amber-50 p-3 rounded-xl border border-amber-200 font-medium">
              This product currently has 0 stock units available.
            </p>
            <button
              onClick={() => setOutOfStockProduct(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-colors"
            >
              OK, Got it (Esc)
            </button>
          </div>
        </div>
      )}

      {/* ─── SALE COMPLETED MODAL ─── */}
      {completedSale && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 text-center space-y-5 border border-slate-100 animate-fadeIn font-sans">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-slate-800">SALE COMPLETED</h3>
              <p className="text-xs text-slate-400 font-medium mt-1">Bill #: <span className="font-mono font-bold text-slate-700">{completedSale.invoiceNumber}</span></p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-semibold">Customer:</span>
                <span className="font-bold text-slate-800">{completedSale.customerName || 'Walk-in Customer'}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-slate-700 font-extrabold text-sm">Total:</span>
                <span className="text-xl font-black text-emerald-600">₹{(completedSale.totalAmount || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex gap-2">
                <button
                  onClick={() => printSaleInvoiceWindow(completedSale, shopName)}
                  className="flex-1 py-3 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-2xs transition-colors"
                >
                  <Printer className="w-4 h-4 text-slate-600" /> Print Bill
                </button>

                <button
                  onClick={() => {
                    let phoneToUse = completedSale.customerPhone;
                    if (!phoneToUse && completedSale.customerId) {
                      const foundCust = customers.find(c => c.id === completedSale.customerId);
                      if (foundCust) phoneToUse = foundCust.phone;
                    }
                    if (!phoneToUse) {
                      const manualPhone = prompt('Enter customer 10-digit mobile number for WhatsApp:');
                      if (manualPhone && manualPhone.trim()) phoneToUse = manualPhone.trim();
                    }
                    if (!phoneToUse) {
                      alert('Customer phone number is required to send bill on WhatsApp.');
                      return;
                    }
                    const billMsg = buildWhatsAppBillMessage(shopName, completedSale.customerName || 'Customer', completedSale);
                    openWhatsApp(phoneToUse, billMsg, shopName, completedSale.customerName || 'Customer');
                  }}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-2xs transition-colors"
                >
                  <MessageSquare className="w-4 h-4" /> Send on WhatsApp
                </button>
              </div>

              <button
                onClick={handleStartNewSale}
                className="w-full py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-extrabold text-sm rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> New Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesSession;
