import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Plus, 
  Minus,
  X, 
  Trash2,
  Receipt, 
  Search, 
  Check, 
  ChevronDown, 
  Camera, 
  AlertTriangle, 
  Printer, 
  MessageSquare, 
  CheckCircle2, 
  Play, 
  Power, 
  User as UserIcon,
  ShoppingCart,
  Keyboard,
  Banknote,
  Smartphone,
  CreditCard,
  MoreHorizontal
} from 'lucide-react';
import { api } from '../services/api';
import { openWhatsApp, buildWhatsAppBillMessage } from '../utils/whatsapp';
import { printSaleInvoiceWindow } from '../utils/printInvoice';
import { InlineProductSearch, type InlineProductSearchRef } from '../components/InlineProductSearch';
import type { Product } from '../types';

const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal').then(m => ({ default: m.BarcodeScannerModal })));

interface SalesSessionProps {
  setCurrentPage: (page: string) => void;
  billingInitialData?: {
    customerId?: string;
    enquiryId?: string;
    followUpId?: string;
    productId?: string;
    rate?: number;
  } | null;
  onClearBillingInitialData?: () => void;
}

interface BillItem {
  id: string; // temp id for UI
  productId: string;
  quantity: number;
  rate: number;
  measurementType?: 'piece' | 'length';
  sellingUnit?: 'piece' | 'm' | 'cm';
}

export const SalesSession: React.FC<SalesSessionProps> = ({ setCurrentPage, billingInitialData, onClearBillingInitialData }) => {
  const {
    currentUser,
    customers,
    products,
    createSale,
    reconcileSale,
    shopProfile,
    shopName,
    connectionState,
    checkHealth,
    salesSessionActive,
    startSalesSession,
    endSalesSession,
    refreshTodayWork
  } = useApp();

  const [linkedEnquiryId, setLinkedEnquiryId] = useState<string>('');
  const [linkedFollowUpId, setLinkedFollowUpId] = useState<string>('');
  const handleCompleteSaleRef = useRef<() => void>(() => {});
  const submittingLockRef = useRef<boolean>(false);

  const [connectingMsg, setConnectingMsg] = useState<string | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);

  const activeProducts = useMemo(
    () => products
      .filter(p => p.isActive)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
    [products]
  );

  // Inline Product Search Ref
  const inlineProductSearchRef = useRef<InlineProductSearchRef>(null);

  // Focus Refs for Keyboard Navigation
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
  const [inactiveBarcodeInfo, setInactiveBarcodeInfo] = useState<{ barcode: string; productName?: string } | null>(null);
  const [outOfStockProduct, setOutOfStockProduct] = useState<any | null>(null);

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
  
  // Cart items & Selected Cart Item for Keyboard +/-/Delete
  const [items, setItems] = useState<BillItem[]>([]);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);

  // Shop-scoped Persistent Discount Mode (% vs ₹)
  const discountModeStorageKey = useMemo(() => {
    return currentUser?.shopId 
      ? `quickr_discount_mode_${currentUser.shopId}` 
      : 'quickr_discount_mode_default';
  }, [currentUser?.shopId]);

  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>(() => {
    try {
      const activeShopKey = currentUser?.shopId 
        ? `quickr_discount_mode_${currentUser.shopId}` 
        : 'quickr_discount_mode_default';
      const saved = localStorage.getItem(activeShopKey);
      if (saved === 'amount' || saved === 'percentage') {
        return saved;
      }
    } catch {
      // Storage unavailable fallback
    }
    return 'percentage';
  });

  // Re-sync discount mode if currentUser.shopId updates
  useEffect(() => {
    if (!currentUser?.shopId) return;
    try {
      const saved = localStorage.getItem(`quickr_discount_mode_${currentUser.shopId}`);
      if (saved === 'amount' || saved === 'percentage') {
        setDiscountType(saved);
      }
    } catch {
      // Storage read error ignored
    }
  }, [currentUser?.shopId]);

  const handleSetDiscountType = (newType: 'percentage' | 'amount') => {
    setDiscountType(newType);
    try {
      localStorage.setItem(discountModeStorageKey, newType);
    } catch {
      // Storage write error ignored
    }
  };

  const [discountValue, setDiscountValue] = useState<number>(0);
  const [isDiscountDropdownOpen, setIsDiscountDropdownOpen] = useState(false);
  const discountDropdownRef = useRef<HTMLDivElement>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');

  // Filtered Customers for Search Dropdown
  const trimmedQuery = customerSearchQuery.trim().toLowerCase();
  const filteredCustomers = customers.filter(c => {
    if (!trimmedQuery) return true;
    const nameMatch = c.name ? c.name.toLowerCase().includes(trimmedQuery) : false;
    const phoneMatch = c.phone ? c.phone.toLowerCase().includes(trimmedQuery) : false;
    return nameMatch || phoneMatch;
  });

  const selectedCustomerObj = customers.find(c => c.id === selectedCustomerId);

  // Hydrate initial customer/enquiry/followUp/product when navigated from WorkMode
  useEffect(() => {
    if (!billingInitialData) return;

    if (!salesSessionActive) {
      startSalesSession();
    }
    if (billingInitialData.customerId) {
      setIsWalkIn(false);
      setSelectedCustomerId(billingInitialData.customerId);
    }
    if (billingInitialData.enquiryId) {
      setLinkedEnquiryId(billingInitialData.enquiryId);
    }
    if (billingInitialData.followUpId) {
      setLinkedFollowUpId(billingInitialData.followUpId);
    }
    if (billingInitialData.productId) {
      const prod = products.find(p => p.id === billingInitialData.productId);
      if (prod && (prod.availability === undefined || prod.availability > 0)) {
        const isLen = prod.measurementType === 'length';
        setItems([{
          id: `${Date.now()}-prefill`,
          productId: prod.id,
          quantity: 1,
          rate: Number(billingInitialData.rate) || prod.sellingPrice,
          measurementType: isLen ? 'length' : 'piece',
          sellingUnit: isLen ? 'm' : 'piece'
        }]);
      }
    }
    onClearBillingInitialData?.();
  }, [billingInitialData, products, salesSessionActive, startSalesSession, onClearBillingInitialData]);

  // 1. DEFAULT FOCUS: Automatically focus Customer Name/Search when session is active
  useEffect(() => {
    if (salesSessionActive) {
      const timer = setTimeout(() => {
        if (isWalkIn) {
          walkinCustomerNameRef.current?.focus();
        } else {
          customerSearchInputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [salesSessionActive, isWalkIn]);

  // Helper: Add or increment product in cart by product object with stock limit check
  const addScannedProductToCart = (prod: any) => {
    if (!prod) return;
    if (!prod.isActive) {
      setInactiveBarcodeInfo({ barcode: prod.barcode || '', productName: prod.name });
      return;
    }
    const avail = prod.availability ?? Infinity;
    if (avail <= 0) {
      setOutOfStockProduct(prod);
      return;
    }

    const existingIdx = items.findIndex(i => i.productId === prod.id);
    if (existingIdx >= 0) {
      const currentBaseTotal = items
        .filter(i => i.productId === prod.id)
        .reduce((sum, i) => sum + ((i.measurementType === 'length' && i.sellingUnit === 'cm') ? i.quantity / 100 : i.quantity), 0);
      const existingItem = items[existingIdx];
      const deltaBase = (existingItem.measurementType === 'length' && existingItem.sellingUnit === 'cm') ? 0.01 : 1;
      if (currentBaseTotal + deltaBase > avail) {
        setOutOfStockProduct(prod);
        return;
      }
      setSelectedCartItemId(existingItem.id);
      setItems(prevItems => prevItems.map((item, idx) => idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      const newItemId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const isLen = prod.measurementType === 'length';
      setSelectedCartItemId(newItemId);
      setItems(prevItems => [
        ...prevItems,
        {
          id: newItemId,
          productId: prod.id,
          quantity: 1,
          rate: prod.sellingPrice,
          measurementType: isLen ? 'length' : 'piece',
          sellingUnit: isLen ? 'm' : 'piece'
        }
      ]);
    }
  };

  // Helper: Process scanned barcode string
  const processScannedBarcode = async (scannedCode: string) => {
    const cleanCode = scannedCode.trim().toUpperCase();
    if (!cleanCode) return;

    setNotFoundBarcode(null);
    setInactiveBarcodeInfo(null);

    try {
      // First check local products list for fast instant exact barcode lookup
      const localMatch = products.find(p => p.barcode && p.barcode.trim().toUpperCase() === cleanCode);
      if (localMatch) {
        if (!localMatch.isActive) {
          setInactiveBarcodeInfo({ barcode: cleanCode, productName: localMatch.name });
          return;
        }
        addScannedProductToCart(localMatch);
        return;
      }

      // Backend fast indexed lookup strictly scoped to authenticated shop
      const foundProduct = await api.getProductByBarcode(cleanCode);
      if (foundProduct && foundProduct.id) {
        if (!foundProduct.isActive) {
          setInactiveBarcodeInfo({ barcode: cleanCode, productName: foundProduct.name });
          return;
        }
        addScannedProductToCart(foundProduct);
      } else {
        setNotFoundBarcode(cleanCode);
      }
    } catch (err: any) {
      if (err?.status === 400 && (err?.inactive || err?.message?.includes('inactive') || err?.errorBody?.inactive)) {
        setInactiveBarcodeInfo({
          barcode: cleanCode,
          productName: err?.errorBody?.productName || err?.productName
        });
        return;
      }
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
        inlineProductSearchRef.current?.close();
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
        if (inactiveBarcodeInfo) {
          e.preventDefault();
          setInactiveBarcodeInfo(null);
          return;
        }
        if (outOfStockProduct) {
          e.preventDefault();
          setOutOfStockProduct(null);
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
      if (e.key === 'F2') {
        e.preventDefault();
        inlineProductSearchRef.current?.focus();
        return;
      }
      if (e.key === 'F10' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault();
        handleCompleteSaleRef.current();
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
            setItems(prev => {
              const target = prev.find(i => i.id === selectedCartItemId);
              if (!target) return prev;
              const prod = products.find(p => p.id === target.productId);
              if (prod && prod.availability !== undefined) {
                const currentTotalBase = prev
                  .filter(i => i.productId === prod.id)
                  .reduce((sum, i) => sum + ((i.measurementType === 'length' && i.sellingUnit === 'cm') ? i.quantity / 100 : i.quantity), 0);
                const stepBase = (target.measurementType === 'length' && target.sellingUnit === 'cm') ? 0.01 : 1;
                if (currentTotalBase + stepBase > prod.availability) {
                  setOutOfStockProduct(prod);
                  return prev;
                }
              }
              return prev.map(item => item.id === selectedCartItemId ? { ...item, quantity: item.quantity + 1 } : item);
            });
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
  }, [salesSessionActive, products, isWalkIn, showKeyboardHelp, isCameraScannerOpen, notFoundBarcode, inactiveBarcodeInfo, outOfStockProduct, isDropdownOpen, isDiscountDropdownOpen, selectedCartItemId, paymentMethod, barcodeEnabled]);

  // Handle outside click to close customer dropdown and discount dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (discountDropdownRef.current && !discountDropdownRef.current.contains(e.target as Node)) {
        setIsDiscountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddItem = () => {
    inlineProductSearchRef.current?.focus();
  };

  const handleSelectProductFromInline = (prod: Product) => {
    if (!prod || !prod.isActive) return;

    const isLen = prod.measurementType === 'length';
    const newItemId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSelectedCartItemId(newItemId);
    setItems(prevItems => [
      ...prevItems,
      {
        id: newItemId,
        productId: prod.id,
        quantity: 1,
        rate: prod.sellingPrice,
        measurementType: isLen ? 'length' : 'piece',
        sellingUnit: isLen ? 'm' : 'piece'
      }
    ]);
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
          if (prod) {
            updated.rate = prod.sellingPrice;
            const isLen = prod.measurementType === 'length';
            updated.measurementType = isLen ? 'length' : 'piece';
            updated.sellingUnit = isLen ? 'm' : 'piece';
          }
        }
        return updated;
      }
      return item;
    }));
  };

  // Current customer bill calculations
  const isGstRegistered = !!shopProfile?.isGstRegistered;
  const shopGstin = shopProfile?.gstin || '';

  const getItemBaseQuantity = (item: BillItem) => {
    const isLen = item.measurementType === 'length';
    const rawQty = Number(item.quantity) || 0;
    if (isLen && item.sellingUnit === 'cm') {
      return Math.round((rawQty / 100) * 10000) / 10000;
    }
    return rawQty;
  };

  const getItemLineTotal = (item: BillItem) => {
    const baseQty = getItemBaseQuantity(item);
    const rate = Number(item.rate) || 0;
    return Math.round((baseQty * rate) * 100) / 100;
  };

  const rawSubtotal = items.reduce((acc, i) => acc + getItemLineTotal(i), 0);
  
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
    const lineTotal = getItemLineTotal(item);
    const baseQuantity = getItemBaseQuantity(item);
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
      baseQuantity,
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

  const applicableGstRates = useMemo(() => {
    return Array.from(new Set(enrichedItems.filter(i => i.gstRate > 0).map(i => `${i.gstRate}%`))).join(', ');
  }, [enrichedItems]);

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
  const [submittedBillSignature, setSubmittedBillSignature] = useState<string | null>(null);
  const [submissionUncertain, setSubmissionUncertain] = useState<boolean>(false);
  const [submissionWarning, setSubmissionWarning] = useState<string | null>(null);
  const [previousUnresolved, setPreviousUnresolved] = useState<{
    requestId: string;
    totalAmount: number;
    timestamp: number;
  } | null>(null);
  const [isVerifyingPrevious, setIsVerifyingPrevious] = useState<boolean>(false);
  const hydratedPendingKeyRef = useRef<string | null>(null);

  const pendingStorageKey = currentUser?.id
    ? `quickr_pending_sale_${currentUser.shopId || 'shop'}_${currentUser.id}`
    : null;

  const billSignature = JSON.stringify({
    isWalkIn,
    selectedCustomerId,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerState,
    customerStateCode,
    customerGstin: customerGstin.trim().toUpperCase(),
    allowWhatsAppOffers,
    linkedEnquiryId,
    linkedFollowUpId,
    discountType,
    discountValue,
    paymentMethod,
    items: items.map(i => ({
      productId: i.productId,
      quantity: Number(i.quantity) || 0,
      rate: Number(i.rate) || 0,
      measurementType: i.measurementType || 'piece',
      sellingUnit: i.sellingUnit || (i.measurementType === 'length' ? 'm' : 'piece')
    }))
  });

  const persistPendingBill = (overrides: {
    requestId?: string | null;
    payloadSignature?: string | null;
    submissionUncertain?: boolean;
  } = {}) => {
    if (!pendingStorageKey) return;
    try {
      sessionStorage.setItem(
        pendingStorageKey,
        JSON.stringify({
          items,
          isWalkIn,
          selectedCustomerId,
          customerName,
          customerPhone,
          customerState,
          customerStateCode,
          customerGstin,
          allowWhatsAppOffers,
          linkedEnquiryId,
          linkedFollowUpId,
          discountType,
          discountValue,
          paymentMethod,
          requestId: overrides.requestId ?? null,
          payloadSignature: overrides.payloadSignature ?? null,
          submissionUncertain: Boolean(overrides.submissionUncertain),
          updatedAt: Date.now()
        })
      );
    } catch {
      // Ignore storage quota / privacy mode restrictions
    }
  };

  const clearPendingBillStorage = () => {
    if (!pendingStorageKey) return;
    try {
      sessionStorage.removeItem(pendingStorageKey);
    } catch {
      // Ignore storage access errors
    }
  };

  const finalizeCommittedSale = (sale: any, fallbackItems?: any[]) => {
    const normalizedSale = (!sale?.items || sale.items.length === 0) && fallbackItems
      ? { ...sale, items: fallbackItems }
      : sale;
    reconcileSale(normalizedSale);
    clearPendingBillStorage();
    setActiveRequestId(null);
    setSubmittedBillSignature(null);
    setSubmissionUncertain(false);
    setSubmissionWarning(null);
    setPreviousUnresolved(null);
    setLinkedEnquiryId('');
    setLinkedFollowUpId('');
    setItems([]);
    setDiscountValue(0);
    setCustomerName('');
    setCustomerPhone('');
    setSelectedCustomerId('');
    setIsWalkIn(true);
    refreshTodayWork().catch(() => {});
    setCurrentPage('sales');
  };

  // Recover unresolved pending sale across browser refreshes (no auth tokens persisted)
  useEffect(() => {
    if (!pendingStorageKey || hydratedPendingKeyRef.current === pendingStorageKey) return;
    hydratedPendingKeyRef.current = pendingStorageKey;

    try {
      const raw = sessionStorage.getItem(pendingStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.items) || saved.items.length === 0) return;

      const restoreSavedDraft = (uncertain: boolean, warningText: string | null) => {
        if (!salesSessionActive) startSalesSession();
        setItems(saved.items);
        if (typeof saved.isWalkIn === 'boolean') setIsWalkIn(saved.isWalkIn);
        if (typeof saved.selectedCustomerId === 'string') setSelectedCustomerId(saved.selectedCustomerId);
        if (typeof saved.customerName === 'string') setCustomerName(saved.customerName);
        if (typeof saved.customerPhone === 'string') setCustomerPhone(saved.customerPhone);
        if (typeof saved.customerState === 'string') setCustomerState(saved.customerState);
        if (typeof saved.customerStateCode === 'string') setCustomerStateCode(saved.customerStateCode);
        if (typeof saved.customerGstin === 'string') setCustomerGstin(saved.customerGstin);
        if (typeof saved.allowWhatsAppOffers === 'boolean') setAllowWhatsAppOffers(saved.allowWhatsAppOffers);
        if (typeof saved.linkedEnquiryId === 'string') setLinkedEnquiryId(saved.linkedEnquiryId);
        if (typeof saved.linkedFollowUpId === 'string') setLinkedFollowUpId(saved.linkedFollowUpId);
        if (saved.discountType === 'amount' || saved.discountType === 'percentage') setDiscountType(saved.discountType);
        if (typeof saved.discountValue === 'number') setDiscountValue(saved.discountValue);
        if (typeof saved.paymentMethod === 'string') setPaymentMethod(saved.paymentMethod);
        setActiveRequestId(uncertain && saved.requestId ? saved.requestId : null);
        setSubmittedBillSignature(uncertain && saved.payloadSignature ? saved.payloadSignature : null);
        setSubmissionUncertain(uncertain);
        setSubmissionWarning(warningText);
      };

      if (saved.requestId && saved.submissionUncertain) {
        api.getSaleByRequestId(saved.requestId)
          .then((statusRes) => {
            if (statusRes?.found && statusRes.sale) {
              reconcileSale(statusRes.sale);
              clearPendingBillStorage();
              refreshTodayWork().catch(() => {});
              setSubmissionWarning(
                `Previous interrupted bill (${statusRes.sale.invoiceNumber}) was already saved safely on the server. Ready for next bill.`
              );
            } else {
              restoreSavedDraft(
                true,
                'A previous bill submission was interrupted before confirmation. Click "Complete Sale" to check status and retry safely without duplicate billing.'
              );
            }
          })
          .catch(() => {
            restoreSavedDraft(
              true,
              'A previous bill submission could not be confirmed due to connection loss. Your bill request ID is preserved for safe retry.'
            );
          });
      }
    } catch {
      // Ignore corrupt storage JSON
    }
  }, [pendingStorageKey]);

  // If the bill changes after an unresolved submission, never silently reuse the old incompatible requestId
  useEffect(() => {
    if (activeRequestId && submittedBillSignature && billSignature !== submittedBillSignature) {
      if (submissionUncertain) {
        setPreviousUnresolved({
          requestId: activeRequestId,
          totalAmount: grandTotalAmount,
          timestamp: Date.now()
        });
        setSubmissionWarning(
          'Bill items or customer changed after a timed-out submission. A fresh request ID will be generated for the modified bill. Verify the earlier attempt if needed.'
        );
      }
      setActiveRequestId(null);
      setSubmittedBillSignature(null);
      setSubmissionUncertain(false);
    }
  }, [billSignature, activeRequestId, submittedBillSignature, submissionUncertain, grandTotalAmount]);

  const handleVerifyPreviousUnresolved = async () => {
    if (!previousUnresolved || isVerifyingPrevious) return;
    setIsVerifyingPrevious(true);
    try {
      const res = await api.getSaleByRequestId(previousUnresolved.requestId);
      if (res?.found && res.sale) {
        reconcileSale(res.sale);
        refreshTodayWork().catch(() => {});
        setPreviousUnresolved(null);
        setSubmissionWarning(`Confirmed: earlier bill was completed as Invoice ${res.sale.invoiceNumber} (₹${res.sale.totalAmount}).`);
      } else {
        setSubmissionWarning('Verified with server: the earlier timed-out submission was NOT created on the server.');
        setPreviousUnresolved(null);
      }
    } catch (err: any) {
      alert(err?.message || 'Unable to verify previous submission right now. Please try again.');
    } finally {
      setIsVerifyingPrevious(false);
    }
  };

  const handleDiscardPendingBill = () => {
    clearPendingBillStorage();
    setActiveRequestId(null);
    setSubmittedBillSignature(null);
    setSubmissionUncertain(false);
    setSubmissionWarning(null);
    setPreviousUnresolved(null);
    setItems([]);
    setDiscountValue(0);
    setLinkedEnquiryId('');
    setLinkedFollowUpId('');
    setCustomerName('');
    setCustomerPhone('');
    setSelectedCustomerId('');
    setIsWalkIn(true);
  };

  const handleCompleteSale = async () => {
    if (items.length === 0) return alert('Please add at least one product to the sale.');
    if (isSubmitting || submittingLockRef.current) return;

    submittingLockRef.current = true;
    setIsSubmitting(true);

    try {
      // If retrying an uncertain submission for the exact same bill, check server status FIRST
      const isMatchingUnresolved =
        submissionUncertain &&
        Boolean(activeRequestId) &&
        submittedBillSignature === billSignature;

      if (isMatchingUnresolved && activeRequestId) {
        try {
          const checkRes = await api.getSaleByRequestId(activeRequestId);
          if (checkRes?.found && checkRes.sale) {
            finalizeCommittedSale(checkRes.sale);
            return;
          }
        } catch (probeErr: any) {
          const isProbeTransient =
            probeErr?.isTransient ||
            !probeErr?.status ||
            [408, 429, 500, 502, 503, 504].includes(probeErr?.status);
          if (isProbeTransient) {
            setSubmissionWarning(
              'Still unable to reach server to verify your pending bill. Your request ID remains locked to prevent duplicate billing.'
            );
            return;
          }
        }
      }

      // Pre-validate that no inactive product is in the bill
      for (const item of enrichedItems) {
        if (item.productId) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isActive) {
            return alert(`Cannot bill "${prod.name}" because it is inactive. Please activate it before billing.`);
          }
        }
      }

      // Pre-validate positive quantities and available stock per product
      const reqByProduct = new Map<string, number>();
      for (const item of enrichedItems) {
        if ((Number(item.quantity) || 0) <= 0) {
          return alert(`Quantity must be greater than 0 for ${item.productName}.`);
        }
        if (item.productId) {
          reqByProduct.set(item.productId, (reqByProduct.get(item.productId) || 0) + (item.baseQuantity || 0));
        }
      }
      for (const [prodId, reqQty] of reqByProduct.entries()) {
        const prod = products.find(p => p.id === prodId);
        if (prod && prod.availability !== undefined && reqQty > prod.availability + 1e-6) {
          return alert(`Insufficient stock for ${prod.name}. Available: ${prod.availability}, Requested: ${reqQty}`);
        }
      }

      if (connectionState !== 'ready') {
        setConnectingMsg('Connecting to server...');
        const isAlive = await checkHealth();
        setConnectingMsg(null);
        if (!isAlive) {
          setSubmissionWarning('Server is currently waking up or unreachable. Please wait a moment and click Complete Sale again.');
          return;
        }
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

      const canReuseRequestId = Boolean(activeRequestId && submittedBillSignature === billSignature);
      const requestIdToUse = canReuseRequestId && activeRequestId
        ? activeRequestId
        : (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

      setActiveRequestId(requestIdToUse);
      setSubmittedBillSignature(billSignature);
      setSubmissionWarning(null);
      persistPendingBill({
        requestId: requestIdToUse,
        payloadSignature: billSignature,
        submissionUncertain: true
      });

      const payload = {
        customerId: finalCustomerId,
        customerName: finalCustomerName,
        customerPhone: isWalkIn && customerPhone.trim() ? customerPhone.trim() : undefined,
        customerState: isGstRegistered ? customerState : undefined,
        customerStateCode: isGstRegistered ? customerStateCode : undefined,
        customerGstin: isGstRegistered && customerGstin.trim() ? customerGstin.trim().toUpperCase() : undefined,
        allowWhatsAppOffers: isWalkIn && customerPhone.trim() ? allowWhatsAppOffers : undefined,
        enquiryId: linkedEnquiryId || undefined,
        followUpId: linkedFollowUpId || undefined,
        items: enrichedItems.map(i => ({
          productId: i.productId,
          productName: i.productName,
          category: i.category,
          measurementType: i.measurementType || 'piece',
          sellingUnit: i.sellingUnit || (i.measurementType === 'length' ? 'm' : 'piece'),
          baseQuantity: i.baseQuantity,
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
        source: linkedFollowUpId ? 'quickr_followup' : 'direct',
        requestId: requestIdToUse
      };

      try {
        const sale = await createSale(payload, { rethrow: true });
        if (sale) {
          finalizeCommittedSale(sale, payload.items);
        } else {
          // Unexpected null response without exception: treat as uncertain and preserve requestId
          setSubmissionUncertain(true);
          setSubmissionWarning(
            'Sale confirmation response was incomplete. Click "Complete Sale" again to safely verify or retry without duplicating the invoice.'
          );
        }
      } catch (err: any) {
        const status = err?.status;
        const isTransient = Boolean(
          err?.isTransient ||
          !status ||
          [408, 429, 500, 502, 503, 504].includes(status)
        );

        if (isTransient) {
          // Immediately probe whether server already committed the sale before timeout/disconnect
          try {
            const verifyRes = await api.getSaleByRequestId(requestIdToUse);
            if (verifyRes?.found && verifyRes.sale) {
              finalizeCommittedSale(verifyRes.sale, payload.items);
              return;
            }
          } catch {
            // Probe also failed transiently — preserve requestId & draft cleanly
          }

          setSubmissionUncertain(true);
          persistPendingBill({
            requestId: requestIdToUse,
            payloadSignature: billSignature,
            submissionUncertain: true
          });
          setSubmissionWarning(
            `${err?.message || 'Connection interrupted during checkout.'} Your bill request ID (${requestIdToUse.slice(0, 8)}...) is preserved — click "Complete Sale" to check status and retry safely.`
          );
        } else {
          // Definitive 4xx rejection from server: no sale created; clear uncertain lock so user can adjust & retry cleanly
          clearPendingBillStorage();
          setActiveRequestId(null);
          setSubmittedBillSignature(null);
          setSubmissionUncertain(false);
          alert(`Unable to generate bill: ${err?.message || 'Validation error'}`);
        }
      }
    } finally {
      submittingLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  handleCompleteSaleRef.current = handleCompleteSale;

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
      walkinCustomerNameRef.current?.focus();
    }, 50);
  };

  return (
    <div className="flex-grow p-4 lg:p-6 space-y-6 bg-[#f4f7fb] min-h-screen font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

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

            {(submissionWarning || previousUnresolved) && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-900">
                      {submissionUncertain ? 'Submission Pending Confirmation' : 'Previous Submission Notice'}
                    </p>
                    <p className="text-xs text-amber-800">
                      {submissionWarning || 'Your previous timed-out submission has not yet been confirmed on the server.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {previousUnresolved && (
                    <button
                      type="button"
                      onClick={handleVerifyPreviousUnresolved}
                      disabled={isVerifyingPrevious}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      {isVerifyingPrevious ? 'Checking...' : 'Verify Previous Attempt'}
                    </button>
                  )}
                  {submissionUncertain && (
                    <button
                      type="button"
                      onClick={handleDiscardPendingBill}
                      className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-colors"
                    >
                      Start New Bill
                    </button>
                  )}
                  {!submissionUncertain && !previousUnresolved && (
                    <button
                      type="button"
                      onClick={() => setSubmissionWarning(null)}
                      className="px-2.5 py-1.5 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-bold"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ─── TWO-COLUMN ACTIVE BILLING WORKSPACE ─── */}
            <div className="flex flex-col lg:flex-row gap-6 items-start">

              {/* ─── LEFT COLUMN (approx. 62% width on desktop) ─── */}
              <div className="w-full lg:w-[62%] space-y-6">

                {/* 2. LEFT TOP — CUSTOMER DETAILS */}
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-blue-600" /> Customer Details
                    </h2>
                    <span className="text-[11px] text-slate-400 font-medium">Press <kbd className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-mono font-bold text-slate-600">F4 / C</kbd></span>
                  </div>

                  {/* Walk-in vs Existing radio buttons */}
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 cursor-pointer">
                      <input 
                        type="radio" 
                        checked={isWalkIn} 
                        onChange={() => setIsWalkIn(true)} 
                        className="text-blue-600 focus:ring-blue-500 w-4 h-4 accent-blue-600 cursor-pointer"
                      />
                      Walk-in Customer
                    </label>
                    <label className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 cursor-pointer">
                      <input 
                        type="radio" 
                        checked={!isWalkIn} 
                        onChange={() => setIsWalkIn(false)} 
                        className="text-blue-600 focus:ring-blue-500 w-4 h-4 accent-blue-600 cursor-pointer"
                      />
                      Existing Customer
                    </label>
                  </div>

                  {isWalkIn ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Customer Name</label>
                        <input 
                          ref={walkinCustomerNameRef}
                          type="text" 
                          placeholder="e.g. Ramesh"
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number</label>
                        <input 
                          ref={walkinCustomerPhoneRef}
                          type="tel" 
                          placeholder="e.g. 9876543210"
                          value={customerPhone}
                          onChange={e => setCustomerPhone(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-semibold font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div ref={dropdownRef} className="relative">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Search & Select Customer *</label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <Search className="w-4 h-4" />
                          </div>
                          <input
                            ref={customerSearchInputRef}
                            type="text"
                            placeholder="Search by customer name or phone..."
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
                                  }
                                }
                              }
                            }}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-9 pr-10 text-xs sm:text-sm font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-2xs"
                          />
                          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                          </div>
                        </div>

                        {isDropdownOpen && (
                          <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto py-1 text-sm divide-y divide-slate-50">
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
                                    }}
                                    onMouseEnter={() => setHighlightedCustomerIndex(idx)}
                                    className={`px-3.5 py-2.5 cursor-pointer flex items-center justify-between transition-colors ${
                                      isHighlighted ? 'bg-blue-50 font-bold border-l-4 border-blue-600' : ''
                                    } ${isSelected ? 'text-blue-700' : ''}`}
                                  >
                                    <div className="flex flex-col">
                                      <span className={`font-bold ${isSelected ? 'text-blue-600' : 'text-slate-800'}`}>
                                        {c.name}
                                      </span>
                                      <span className="text-xs text-slate-400 font-mono">
                                        {c.phone}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <Check className="w-4 h-4 text-blue-600 shrink-0" />
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

                      {selectedCustomerObj && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Customer Name</label>
                            <input
                              type="text"
                              readOnly
                              value={selectedCustomerObj.name}
                              className="w-full bg-slate-100/70 border border-slate-200 rounded-xl py-2 px-3 text-xs sm:text-sm font-semibold text-slate-700 cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Phone Number</label>
                            <input
                              type="text"
                              readOnly
                              value={selectedCustomerObj.phone}
                              className="w-full bg-slate-100/70 border border-slate-200 rounded-xl py-2 px-3 text-xs sm:text-sm font-semibold font-mono text-slate-700 cursor-not-allowed"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. LEFT MIDDLE — PRODUCTS IN CART */}
                <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-4">
                  {/* Cart Header */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base sm:text-lg font-bold text-slate-800">
                        Products in Cart
                      </h2>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                        {items.length} {items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        title="Focus product search (/)"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Product</span>
                      </button>
                      {barcodeEnabled && (
                        <button
                          type="button"
                          onClick={() => setIsCameraScannerOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                          title="Scan Barcode (S)"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Scan Barcode</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline Product Search */}
                  <InlineProductSearch
                    ref={inlineProductSearchRef}
                    products={products}
                    onSelectProduct={handleSelectProductFromInline}
                    placeholder="Search product name or barcode (F2)..."
                  />

                  {/* Cart Product Rows (TEXT ONLY) */}
                  {items.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center bg-slate-50/50 space-y-1.5">
                      <ShoppingCart className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-xs font-bold text-slate-600">Cart is empty</p>
                      <p className="text-[11px] text-slate-400">Search products above or scan a barcode to add items</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {items.map((item) => {
                        const prod = products.find(p => p.id === item.productId);
                        const isLen = item.measurementType === 'length';
                        const itemLineTotal = getItemLineTotal(item);
                        const isCartSelected = item.id === selectedCartItemId;

                        // Extract color and size
                        const colorList = prod?.colors?.filter(c => c && c.trim() && c !== 'N/A') || [];
                        const sizeList = prod?.sizes?.filter(s => s && s.trim() && s !== 'N/A') || [];

                        let variantText = '';
                        if (colorList.length > 0 && sizeList.length > 0) {
                          variantText = `Colour: ${colorList.join(', ')} • Size: ${sizeList.join(', ')}`;
                        } else if (colorList.length > 0) {
                          variantText = `Colour: ${colorList.join(', ')}`;
                        } else if (sizeList.length > 0) {
                          variantText = `Size: ${sizeList.join(', ')}`;
                        } else if (isLen) {
                          variantText = `Fabric / Length (${item.sellingUnit || 'm'})`;
                        } else if (prod?.category) {
                          variantText = prod.category;
                        }

                        return (
                          <div
                            key={item.id}
                            onClick={() => setSelectedCartItemId(item.id)}
                            className={`p-3.5 sm:p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all cursor-pointer ${
                              isCartSelected
                                ? 'bg-blue-50/40 border-blue-400 shadow-2xs ring-1 ring-blue-300'
                                : 'bg-white border-slate-200/80 hover:bg-slate-50/80'
                            }`}
                          >
                            {/* Left side: Product Name & Colour/Size (TEXT ONLY) */}
                            <div className="min-w-0 flex-1">
                              <h4 className="text-[16px] font-semibold text-slate-800 leading-snug truncate">
                                {prod?.name || 'Selected Product'}
                              </h4>
                              {variantText && (
                                <p className="text-[13px] text-slate-500 font-normal mt-0.5 truncate">
                                  {variantText}
                                </p>
                              )}
                            </div>

                            {/* Right side: Quantity Controls, Item Price, Remove button */}
                            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0">
                              {isLen && (
                                <div className="flex bg-slate-200 p-0.5 rounded-lg text-xs font-bold">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleItemChange(item.id, 'sellingUnit', 'm');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${item.sellingUnit === 'm' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                                  >
                                    m
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleItemChange(item.id, 'sellingUnit', 'cm');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${item.sellingUnit === 'cm' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                                  >
                                    cm
                                  </button>
                                </div>
                              )}

                              {/* Quantity Controls */}
                              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const step = isLen && item.sellingUnit === 'cm' ? 10 : 1;
                                    const minVal = isLen ? 0.01 : 1;
                                    const newQty = Math.max(minVal, Math.round(((Number(item.quantity) || 1) - step) * 100) / 100);
                                    handleItemChange(item.id, 'quantity', newQty);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors font-bold cursor-pointer"
                                  title="Decrease quantity (-)"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>

                                <input
                                  type="number"
                                  min={isLen ? "0.01" : "1"}
                                  step={isLen ? (item.sellingUnit === 'cm' ? "1" : "0.01") : "1"}
                                  value={item.quantity}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    handleItemChange(item.id, 'quantity', isNaN(val) ? '' : Math.max(isLen ? 0.01 : 1, val));
                                  }}
                                  className="w-12 text-center text-[16px] font-semibold text-slate-800 bg-transparent border-0 focus:outline-none p-0"
                                />

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const step = isLen && item.sellingUnit === 'cm' ? 10 : 1;
                                    const newQty = Math.round(((Number(item.quantity) || 0) + step) * 100) / 100;
                                    handleItemChange(item.id, 'quantity', newQty);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors font-bold cursor-pointer"
                                  title="Increase quantity (+)"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Item Price */}
                              <div className="w-24 text-right">
                                <span className="text-[17px] font-bold text-slate-900 block">
                                  ₹{itemLineTotal.toLocaleString('en-IN')}
                                </span>
                              </div>

                              {/* Remove Item Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveItem(item.id);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                title="Remove product"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Cart Summary (At the bottom of Cart card) */}
                  {items.length > 0 && (
                    <div className="pt-4 border-t border-slate-200 space-y-2 bg-slate-50/60 -mx-5 -mb-5 p-5 rounded-b-2xl">
                      <div className="flex justify-between items-center text-[14px] text-slate-600 font-medium">
                        <span>Subtotal</span>
                        <span className="font-semibold text-slate-800">
                          ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

                      {isGstRegistered && (
                        <div className="flex justify-between items-center text-[14px] text-slate-600 font-medium">
                          <span>
                            GST {applicableGstRates ? `(${applicableGstRates})` : ''} {shopGstin ? `(${shopGstin})` : ''}
                          </span>
                          <span className="font-semibold text-slate-800">
                            +₹{totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-2 border-t border-slate-200/80">
                        <span className="text-[18px] font-bold text-slate-900">Cart Total</span>
                        <span className="text-[18px] font-bold text-blue-700">
                          ₹{grandTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. LEFT BOTTOM — PAYMENT METHOD */}
                <div 
                  ref={paymentMethodContainerRef}
                  tabIndex={0}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                      Payment Method
                    </h3>
                    <span className="text-[11px] text-slate-400 font-medium">F8 / P</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { id: 'Cash', label: 'Cash', icon: Banknote },
                      { id: 'UPI', label: 'UPI', icon: Smartphone },
                      { id: 'Card', label: 'Card', icon: CreditCard },
                      { id: 'Other', label: 'Other', icon: MoreHorizontal }
                    ].map(({ id, label, icon: Icon }) => {
                      const isSelected = paymentMethod === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setPaymentMethod(id)}
                          className={`py-3 px-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 border-2 border-blue-600 text-blue-700 shadow-xs ring-2 ring-blue-100 font-extrabold'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${isSelected ? 'text-blue-600' : 'text-slate-500'}`} />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* ─── RIGHT COLUMN (approx. 38% width on desktop) ─── */}
              <div className="w-full lg:w-[38%] space-y-6 lg:sticky lg:top-6">

                {/* 5. RIGHT TOP — LARGE TOTAL AMOUNT */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl sm:rounded-3xl p-6 sm:p-7 text-white shadow-md shadow-blue-500/15">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-100 block">
                    Total Amount
                  </span>
                  <div className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white mt-1.5 flex items-baseline">
                    ₹{grandTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-[12px] text-blue-100/80 mt-1 font-medium">
                    {items.length === 0 ? 'No items in cart' : `${items.length} product(s) in cart • ${paymentMethod} selected`}
                  </p>
                </div>

                {/* 6. RIGHT BOTTOM — PAYMENT SUMMARY & ACTIONS */}
                <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-2xs p-6 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                      Payment Summary
                    </h3>
                    <span className="text-xs text-slate-400 font-semibold">{items.length} product(s)</span>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center text-slate-600 font-medium">
                      <span>Subtotal</span>
                      <span className="font-semibold text-slate-800">
                        ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Discount Selector */}
                    <div className="flex justify-between items-center text-slate-600 font-medium">
                      <div ref={discountDropdownRef} className="relative flex items-center gap-1.5">
                        <span>Discount</span>
                        <button
                          type="button"
                          onClick={() => setIsDiscountDropdownOpen(!isDiscountDropdownOpen)}
                          className="flex items-center gap-0.5 text-[11px] font-extrabold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-lg border border-blue-200 transition-colors cursor-pointer"
                        >
                          <span>{discountType === 'percentage' ? '%' : '₹'}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isDiscountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isDiscountDropdownOpen && (
                          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg text-xs font-semibold py-1 w-36 text-slate-700 divide-y divide-slate-50">
                            <button
                              type="button"
                              onClick={() => {
                                handleSetDiscountType('percentage');
                                if (discountValue > 100) setDiscountValue(100);
                                setIsDiscountDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-between transition-colors ${
                                discountType === 'percentage' ? 'bg-blue-50 text-blue-600 font-bold' : ''
                              }`}
                            >
                              <span>Percentage (%)</span>
                              {discountType === 'percentage' && <Check className="w-3.5 h-3.5 text-blue-600" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleSetDiscountType('amount');
                                if (subtotal > 0 && discountValue > subtotal) setDiscountValue(subtotal);
                                setIsDiscountDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-between transition-colors ${
                                discountType === 'amount' ? 'bg-blue-50 text-blue-600 font-bold' : ''
                              }`}
                            >
                              <span>Amount (₹)</span>
                              {discountType === 'amount' && <Check className="w-3.5 h-3.5 text-blue-600" />}
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
                          className="w-16 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-center transition-all"
                        />
                        <span className="font-bold text-slate-600 text-xs">{discountType === 'percentage' ? '%' : '₹'}</span>
                      </div>
                    </div>

                    {discountAmount > 0 && (
                      <div className="flex justify-between items-center text-xs font-bold text-emerald-600">
                        <span>Discount applied ({discountType === 'percentage' ? `${validatedDiscountValue}%` : `₹${validatedDiscountValue}`}):</span>
                        <span>-₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}

                    {isGstRegistered && (
                      <div className="flex justify-between items-center text-slate-600 font-medium pt-1">
                        <span className="flex items-center gap-1">
                          GST
                          {applicableGstRates && <span className="text-xs text-slate-400">({applicableGstRates})</span>}
                          {shopGstin && <span className="text-xs text-slate-400">({shopGstin})</span>}
                        </span>
                        <span className="font-semibold text-slate-800">
                          +₹{totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    {/* Visually Prominent Grand Total */}
                    <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline">
                      <span className="text-base font-extrabold text-slate-900 uppercase">Grand Total</span>
                      <span className="text-2xl font-black text-emerald-600">
                        ₹{grandTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Large Green Complete Sale Button */}
                  <div className="pt-2 space-y-3">
                    <button
                      ref={completeSaleBtnRef}
                      onClick={handleCompleteSale}
                      disabled={isSubmitting || items.length === 0 || connectingMsg !== null}
                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-base rounded-xl shadow-md shadow-emerald-600/20 transition-all flex justify-center items-center gap-2 disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-4 focus:ring-emerald-200"
                    >
                      <Receipt className="w-5 h-5" />
                      <span>
                        {connectingMsg
                          ? connectingMsg
                          : isSubmitting
                            ? 'Completing Sale...'
                            : submissionUncertain
                              ? 'Verify & Complete Sale'
                              : 'Complete Sale'}
                      </span>
                      <span className="bg-emerald-800/60 text-emerald-100 text-xs px-2 py-0.5 rounded font-mono font-bold">F10</span>
                    </button>

                    {/* Print Bill & WhatsApp Sharing */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (items.length === 0 && !completedSale) {
                            alert('Cart is empty. Add products to print.');
                            return;
                          }
                          printSaleInvoiceWindow(
                            completedSale || {
                              invoiceNumber: 'DRAFT',
                              customerName: isWalkIn ? (customerName || 'Walk-in Customer') : (selectedCustomerObj?.name || 'Customer'),
                              customerPhone: isWalkIn ? customerPhone : (selectedCustomerObj?.phone || ''),
                              items: enrichedItems,
                              subtotal,
                              discountAmount,
                              totalAmount: grandTotalAmount,
                              paymentMethod,
                              createdAt: new Date().toISOString()
                            },
                            shopName
                          );
                        }}
                        className="flex-1 py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                      >
                        <Printer className="w-4 h-4 text-slate-600" />
                        <span>Print Bill</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const phone = isWalkIn ? customerPhone : (selectedCustomerObj?.phone || '');
                          if (!phone || !phone.trim()) {
                            alert('Customer phone number is required to share bill on WhatsApp.');
                            return;
                          }
                          const saleToShare = completedSale || {
                            invoiceNumber: 'DRAFT',
                            customerName: isWalkIn ? (customerName || 'Customer') : (selectedCustomerObj?.name || 'Customer'),
                            customerPhone: phone,
                            items: enrichedItems,
                            subtotal,
                            discountAmount,
                            totalAmount: grandTotalAmount,
                            paymentMethod,
                            createdAt: new Date().toISOString()
                          };
                          const billMsg = buildWhatsAppBillMessage(shopName, saleToShare.customerName || 'Customer', saleToShare);
                          openWhatsApp(phone, billMsg, shopName, saleToShare.customerName || 'Customer');
                        }}
                        className="flex-1 py-2.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4 text-emerald-600" />
                        <span>Share via WhatsApp</span>
                      </button>
                    </div>
                  </div>
                </div>

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
                <span>Focus Product Search</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">F2</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Focus Customer</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">F4 / C</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Navigate Search Results</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">↑ / ↓</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Add Highlighted Product</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">Enter</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Scan Barcode</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">S</kbd>
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
                <span>Next / Prev Field</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-indigo-600 border border-slate-200">Tab / ⇧Tab</kbd>
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
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between">
                <span>Close / Cancel</span>
                <kbd className="bg-white px-2 py-1 rounded shadow-2xs font-mono font-bold text-slate-600 border border-slate-200">Esc</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between col-span-2">
                <span>Complete Sale (Validation checked)</span>
                <kbd className="bg-emerald-600 text-white px-2.5 py-1 rounded font-mono font-bold shadow-2xs">Ctrl + Enter / F10</kbd>
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
        <Suspense fallback={null}>
          <BarcodeScannerModal
            onScanSuccess={(barcodeVal) => {
              processScannedBarcode(barcodeVal);
            }}
            onClose={() => setIsCameraScannerOpen(false)}
          />
        </Suspense>
      )}

      {/* ─── INACTIVE PRODUCT BARCODE ALERT MODAL ─── */}
      {inactiveBarcodeInfo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4 border border-slate-100 animate-fadeIn">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Inactive Product</h3>
              <p className="text-xs text-amber-700 font-bold mt-1">
                This product is inactive. Activate it before billing.
              </p>
              {inactiveBarcodeInfo.productName && (
                <p className="text-xs text-slate-500 mt-1 font-semibold">
                  {inactiveBarcodeInfo.productName}
                </p>
              )}
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="block text-[10px] text-slate-400 font-bold uppercase">Scanned Barcode</span>
              <span className="font-mono text-sm font-extrabold text-slate-800">{inactiveBarcodeInfo.barcode}</span>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setInactiveBarcodeInfo(null)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-colors shadow-xs"
              >
                OK, Got it (Esc)
              </button>
            </div>
          </div>
        </div>
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
              <p className="text-xs text-slate-500 mt-1">Product not found for this barcode.</p>
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
