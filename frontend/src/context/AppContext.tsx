import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Customer, Product, Enquiry, FollowUp, Sale, Activity, Note, Message } from '../types';
import { api, setApiUnauthorizedHandler, type UserSession } from '../services/api';

interface AppContextType {
  currentUser: UserSession | null;
  isAuthenticated: boolean;
  customers: Customer[];
  products: Product[];
  enquiries: Enquiry[];
  followUps: FollowUp[];
  sales: Sale[];
  activities: Activity[];
  notes: Note[];
  messages: Message[];
  todayWork: {
    totalTasks: number;
    dueToday: any[];
    overdue: any[];
    upcoming: any[];
    highPriority: any[];
    summary: {
      todayWorkCount: number;
      overdueCount: number;
      enquiriesCount: number;
      recoveredSalesAmount: number;
      convertedCount: number;
    };
  } | null;
  shopProfile: { name?: string; phone?: string; isGstRegistered: boolean; gstin: string; stateCode?: string; gst?: { registered?: boolean; defaultRate?: number }; lengthBasedBillingEnabled?: boolean } | null;
  shopName: string;
  salesSessionActive: boolean;
  startSalesSession: () => void;
  endSalesSession: () => void;
  isLoading: boolean;
  error: string | null;
  login: (email: string, pass: string) => Promise<boolean>;
  register: (ownerName: string, shopName: string, email: string, pass: string) => Promise<boolean>;
  logout: () => Promise<void>;
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<Product | null>;
  generateProductBarcode: (productId: string) => Promise<Product | null>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<Product | null>;

  deleteProduct: (id: string) => Promise<boolean>;
  bulkDeleteProducts: (ids: string[]) => Promise<{ success: boolean; message: string }>;
  importProducts: (products: any[], gstSettings?: any) => Promise<{
    success: boolean;
    summary: {
      totalRows: number;
      imported: number;
      skipped: number;
      duplicates: number;
      validationErrors: number;
      generatedBarcodes: number;
    };
    issues: Array<{
      row: number;
      productName: string;
      barcode: string;
      issue: string;
      suggestedFix: string;
    }>;
  }>;
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt'>) => Promise<Customer | null>;
  deleteCustomer: (id: string) => Promise<boolean>;
  bulkDeleteCustomers: (ids: string[]) => Promise<{ success: boolean; message: string }>;
  addEnquiry: (enquiry: Omit<Enquiry, 'id' | 'createdAt'>) => Promise<Enquiry | null>;
  deleteEnquiry: (id: string) => Promise<boolean>;
  bulkDeleteEnquiries: (ids: string[]) => Promise<{ success: boolean; message: string }>;
  updateEnquiry: (id: string, updates: Partial<Enquiry>) => Promise<void>;
  updateFollowUpStatus: (id: string, status: FollowUp['status'], outcome?: FollowUp['outcome']) => Promise<void>;
  sendWhatsAppMock: (followUpId: string, customMessage: string) => Promise<boolean>;
  createSale: (
    saleData: Omit<Sale, 'id' | 'createdAt' | 'shopId' | 'invoiceNumber'> & { requestId?: string },
    options?: { rethrow?: boolean }
  ) => Promise<Sale | null>;
  reconcileSale: (sale: Sale) => void;
  deleteSales: (ids: string[]) => Promise<boolean>;


  handleOutcomeStillInterested: (followUpId: string, nextDateStr: string) => Promise<void>;
  handleOutcomeNotInterested: (followUpId: string) => Promise<void>;
  handleOutcomeNoResponse: (followUpId: string, scheduleNext: boolean) => Promise<void>;
  addNote: (customerId: string, content: string) => void;
  updateShopProfile: (data: { name?: string; phone?: string; isGstRegistered?: boolean; gstin?: string; legalName?: string; address?: string; state?: string; stateCode?: string; defaultRate?: number; lengthBasedBillingEnabled?: boolean }) => Promise<boolean>;
  connectionState: 'checking' | 'ready' | 'offline';
  checkHealth: () => Promise<boolean>;
  refreshTodayWork: () => Promise<void>;
  refreshData: () => Promise<void>;
  resetData: () => void;
  pwaInstallPrompt: any;
  triggerPwaInstall: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<'checking' | 'ready' | 'offline'>('checking');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const committedSaleIdsRef = useRef<Set<string>>(new Set());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [todayWork, setTodayWork] = useState<any>(null);
  const [shopProfile, setShopProfile] = useState<{ name?: string; phone?: string; isGstRegistered: boolean; gstin: string; stateCode?: string; gst?: { registered?: boolean; defaultRate?: number; stateCode?: string }; lengthBasedBillingEnabled?: boolean } | null>(null);
  
  const [salesSessionActive, setSalesSessionActive] = useState<boolean>(() => {
    return localStorage.getItem('quickr_sales_session_active') === 'true';
  });

  const startSalesSession = useCallback(() => {
    setSalesSessionActive(true);
    localStorage.setItem('quickr_sales_session_active', 'true');
  }, []);

  const endSalesSession = useCallback(() => {
    setSalesSessionActive(false);
    localStorage.setItem('quickr_sales_session_active', 'false');
  }, []);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error] = useState<string | null>(null);
  const [pwaInstallPrompt, setPwaInstallPrompt] = useState<any>(null);

  // Single Application-level PWA beforeinstallprompt capture
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).deferredPwaPrompt = e;
      setPwaInstallPrompt(e);
      window.dispatchEvent(new CustomEvent('quickr-pwa-prompt-changed'));
    };

    const handleAppInstalled = () => {
      (window as any).deferredPwaPrompt = null;
      setPwaInstallPrompt(null);
      window.dispatchEvent(new CustomEvent('quickr-pwa-prompt-changed'));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerPwaInstall = useCallback(async () => {
    const activePrompt = pwaInstallPrompt || (window as any).deferredPwaPrompt;
    if (activePrompt) {
      try {
        activePrompt.prompt();
        await activePrompt.userChoice;
      } catch (err) {
        console.error('[QuickR PWA] error prompting install:', err);
      } finally {
        (window as any).deferredPwaPrompt = null;
        setPwaInstallPrompt(null);
        window.dispatchEvent(new CustomEvent('quickr-pwa-prompt-changed'));
      }
    }
  }, [pwaInstallPrompt]);

  // Warm-up health check with exponential backoff (2s, 5s, 10s)
  const warmUpBackend = async (attempt = 1): Promise<boolean> => {
    try {
      setConnectionState('checking');
      const res = await api.healthCheck();
      if (res && res.status === 'ok') {
        setConnectionState('ready');
        return true;
      }
      throw new Error('Health check returned non-ok status');
    } catch (err) {
      console.warn(`[Warm-Up] Health check attempt ${attempt} failed.`);
      if (attempt <= 3) {
        const delays = [2000, 5000, 10000];
        const delay = delays[attempt - 1] || 10000;
        setTimeout(() => {
          warmUpBackend(attempt + 1);
        }, delay);
      } else {
        setConnectionState('offline');
      }
      return false;
    }
  };

  const checkHealth = async (): Promise<boolean> => {
    try {
      const res = await api.healthCheck();
      if (res && res.status === 'ok') {
        setConnectionState('ready');
        return true;
      }
      setConnectionState('offline');
      return false;
    } catch (err) {
      setConnectionState('offline');
      return false;
    }
  };

  const clearSessionState = useCallback(() => {
    setCurrentUser(null);
    setIsAuthenticated(false);
    setCustomers([]);
    setProducts([]);
    setEnquiries([]);
    setFollowUps([]);
    setSales([]);
    committedSaleIdsRef.current.clear();
    setActivities([]);
    setNotes([]);
    setMessages([]);
    setTodayWork(null);
    setShopProfile(null);
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('quickr_pending_sale_')) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access restrictions
    }
  }, []);

  // Load user session on mount
  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    warmUpBackend();
    try {
      const res = await api.getMe();
      if (res && res.user) {
        setCurrentUser(res.user);
        setIsAuthenticated(true);
        setConnectionState('ready');
        if (res.user.role !== 'admin') {
          await loadBusinessData();
        }
      } else {
        clearSessionState();
      }
    } catch (err) {
      clearSessionState();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadBusinessData = useCallback(async () => {
    try {
      const [cList, pList, eList, fList, sList, aList, mList, workData, profileData] = await Promise.all([
        api.getCustomers().catch(() => []),
        api.getProducts().catch(() => []),
        api.getEnquiries().catch(() => []),
        api.getFollowUps().catch(() => []),
        api.getSales().catch(() => []),
        api.getActivities().catch(() => []),
        api.getMessages().catch(() => []),
        api.getTodayWork().catch(() => null),
        api.getShopProfile().catch(() => null),
      ]);

      setCustomers(cList);
      setProducts(pList);
      setEnquiries(eList);
      setFollowUps(fList);
      setSales(sList);
      committedSaleIdsRef.current = new Set(sList.map(s => s.id));
      setActivities(aList);
      setMessages(mList);
      if (workData) {
        setTodayWork(workData);
      }
      if (profileData) {
        setShopProfile({
          name: profileData.name || 'QuickR Shop',
          phone: profileData.phone || '',
          isGstRegistered: !!profileData.isGstRegistered,
          gstin: profileData.gstin || '',
          stateCode: profileData.gst?.stateCode || (profileData as any).stateCode || '33',
          gst: profileData.gst,
          lengthBasedBillingEnabled: !!profileData.lengthBasedBillingEnabled
        });
      }
    } catch (err: any) {
      console.error('Failed to load business data:', err);
    }
  }, []);

  useEffect(() => {
    setApiUnauthorizedHandler(() => {
      clearSessionState();
    });
    checkAuth();
    return () => setApiUnauthorizedHandler(null);
  }, [checkAuth, clearSessionState]);

  const login = async (email: string, pass: string): Promise<boolean> => {
    const res = await api.login({ email, password: pass });
    if (res && res.user) {
      setCurrentUser(res.user);
      setIsAuthenticated(true);
      setConnectionState('ready');
      if (res.user.role !== 'admin') {
        await loadBusinessData();
      }
      return true;
    }
    return false;
  };

  const register = async (ownerName: string, shopName: string, email: string, pass: string): Promise<boolean> => {
    const res = await api.register({ ownerName, shopName, email, password: pass });
    if (res && res.user) {
      setCurrentUser(res.user);
      setIsAuthenticated(true);
      if (res.user.role !== 'admin') {
        await loadBusinessData();
      }
      return true;
    }
    return false;
  };

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } catch (err) {
      console.error('Logout request error:', err);
    } finally {
      clearSessionState();
    }
  }, [clearSessionState]);

  const addProduct = async (productData: Omit<Product, 'id' | 'createdAt'>): Promise<Product | null> => {
    try {
      const created = await api.createProduct(productData);
      setProducts(prev => [created, ...prev]);
      return created;
    } catch (err: any) {
      alert(`Unable to save product: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>): Promise<Product | null> => {
    try {
      const updated = await api.updateProduct(id, updates);
      setProducts(prev => prev.map(p => p.id === id ? updated : p));
      return updated;
    } catch (err: any) {
      alert(`Unable to update product: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const deleteProduct = async (id: string): Promise<boolean> => {
    try {
      const res = await api.deleteProduct(id);
      if (res.success) {
        setProducts(prev => prev.filter(p => p.id !== id));
        return true;
      }
      return false;
    } catch (err: any) {
      alert(`Unable to delete product: ${err.message || 'Server error'}`);
      return false;
    }
  };

  const addCustomer = async (customerData: Omit<Customer, 'id' | 'createdAt'>): Promise<Customer | null> => {
    try {
      const created = await api.createCustomer(customerData);
      setCustomers(prev => [created, ...prev]);
      return created;
    } catch (err: any) {
      alert(`Unable to save customer: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const deleteCustomer = async (id: string): Promise<boolean> => {
    try {
      const res = await api.deleteCustomer(id);
      if (res.success) {
        setCustomers(prev => prev.filter(c => c.id !== id));
        setEnquiries(prev => prev.filter(e => e.customerId !== id));
        setFollowUps(prev => prev.filter(f => f.customerId !== id));
        setMessages(prev => prev.filter(m => m.customerId !== id));
        setActivities(prev => prev.filter(a => a.customerId !== id));
        setNotes(prev => prev.filter(n => n.customerId !== id));
        return true;
      }
      return false;
    } catch (err: any) {
      alert(`Unable to delete customer: ${err.message || 'Server error'}`);
      return false;
    }
  };

  const refreshTodayWork = useCallback(async (): Promise<void> => {
    try {
      const workData = await api.getTodayWork().catch(() => null);
      if (workData) {
        setTodayWork(workData);
      }
    } catch (err) {
      console.error('Failed to refresh Today Work queue:', err);
    }
  }, []);

  const addEnquiry = async (enquiryData: Omit<Enquiry, 'id' | 'createdAt'>): Promise<Enquiry | null> => {
    try {
      const res = await api.createEnquiry(enquiryData);
      if (!res || !res.enquiry) {
        throw new Error('Backend did not return a created enquiry.');
      }
      setEnquiries(prev => [res.enquiry, ...prev]);
      if (res.followUp) {
        const newFw = res.followUp;
        setFollowUps(prev => [newFw, ...prev]);
      }

      refreshTodayWork().catch(e => console.error('Background refreshTodayWork error:', e));

      return res.enquiry;
    } catch (err: any) {
      alert(`Failed to create enquiry: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const deleteEnquiry = async (id: string): Promise<boolean> => {
    try {
      const res = await api.deleteEnquiry(id);
      if (res && res.success) {
        setEnquiries(prev => prev.filter(e => e.id !== id));
        setFollowUps(prev => prev.filter(f => f.enquiryId !== id));
        return true;
      }
      return false;
    } catch (err: any) {
      alert(`Failed to delete enquiry: ${err.message || 'Server error'}`);
      return false;
    }
  };

  const bulkDeleteProducts = async (ids: string[]): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await api.bulkDeleteProducts(ids);
      if (res && res.success) {
        await loadBusinessData();
        return { success: true, message: res.message };
      }
      return { success: false, message: 'Bulk product deletion failed.' };
    } catch (err: any) {
      const msg = err.message || 'Failed to delete products';
      alert(`Error: ${msg}`);
      return { success: false, message: msg };
    }
  };

  const importProducts = async (productsData: any[], gstSettings?: any) => {
    try {
      const res = await api.importProducts(productsData, gstSettings);
      if (res && res.success) {
        await loadBusinessData();
      }
      return res;
    } catch (err: any) {
      const msg = err.message || 'Import failed';
      alert(`Error: ${msg}`);
      throw err;
    }
  };

  const bulkDeleteCustomers = async (ids: string[]): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await api.bulkDeleteCustomers(ids);
      if (res && res.success) {
        await loadBusinessData();
        return { success: true, message: res.message };
      }
      return { success: false, message: 'Bulk customer deletion failed.' };
    } catch (err: any) {
      const msg = err.message || 'Failed to delete customers';
      alert(`Error: ${msg}`);
      return { success: false, message: msg };
    }
  };

  const bulkDeleteEnquiries = async (ids: string[]): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await api.bulkDeleteEnquiries(ids);
      if (res && res.success) {
        await loadBusinessData();
        return { success: true, message: res.message };
      }
      return { success: false, message: 'Bulk enquiry deletion failed.' };
    } catch (err: any) {
      const msg = err.message || 'Failed to delete enquiries';
      alert(`Error: ${msg}`);
      return { success: false, message: msg };
    }
  };

  const updateEnquiry = async (id: string, updates: Partial<Enquiry>) => {
    try {
      setEnquiries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    } catch (err) {
      console.error('Update enquiry error', err);
    }
  };

  const updateFollowUpStatus = async (id: string, status: FollowUp['status'], outcome?: FollowUp['outcome']) => {
    try {
      setFollowUps(prev => prev.map(f => f.id === id ? { ...f, status, outcome: outcome || f.outcome } : f));
    } catch (err) {
      console.error('Update followup error', err);
    }
  };

  const sendWhatsAppMock = async (followUpId: string, customMessage: string): Promise<boolean> => {
    try {
      const res = await api.sendFollowUpMessage(followUpId, customMessage);
      if (res.success) {
        setFollowUps(prev => prev.map(f => f.id === followUpId ? res.followUp : f));
        setMessages(prev => [res.message, ...prev]);
        return true;
      }
      return false;
    } catch (err: any) {
      alert(`Failed to send message: ${err.message || 'Server error'}`);
      return false;
    }
  };

  const reconcileSale = useCallback((committedSale: Sale, fallbackItems?: any[]) => {
    if (!committedSale?.id || committedSaleIdsRef.current.has(committedSale.id)) {
      return;
    }
    committedSaleIdsRef.current.add(committedSale.id);

    setSales(prev => (prev.some(s => s.id === committedSale.id) ? prev : [committedSale, ...prev]));

    const sourceItems = Array.isArray(committedSale.items) && committedSale.items.length > 0
      ? committedSale.items
      : fallbackItems;
    if (Array.isArray(sourceItems)) {
      const decByProd = new Map<string, number>();
      for (const soldItem of sourceItems as any[]) {
        if (!soldItem?.productId) continue;
        const isLen = soldItem.measurementType === 'length';
        const decQty = Number(soldItem.baseQuantity) || (isLen && soldItem.sellingUnit === 'cm' ? (Number(soldItem.quantity) || 0) / 100 : (Number(soldItem.quantity) || 1));
        decByProd.set(soldItem.productId, (decByProd.get(soldItem.productId) || 0) + decQty);
      }
      if (decByProd.size > 0) {
        setProducts(prevProducts =>
          prevProducts.map(p => {
            const dec = decByProd.get(p.id);
            return dec ? { ...p, availability: Math.max(0, Math.round(((p.availability || 0) - dec) * 10000) / 10000) } : p;
          })
        );
      }
    }
  }, []);

  const createSale = async (
    saleData: Omit<Sale, 'id' | 'createdAt' | 'shopId' | 'invoiceNumber'> & { requestId?: string },
    options?: { rethrow?: boolean }
  ): Promise<Sale | null> => {
    try {
      const newSale = await api.createSale(saleData);
      if (newSale) {
        reconcileSale(newSale, saleData.items as any[]);
      }
      return newSale;
    } catch (err: any) {
      if (options?.rethrow) {
        throw err;
      }
      alert(`Unable to generate bill: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const deleteSales = async (ids: string[]): Promise<boolean> => {
    try {
      const res = await api.deleteSales(ids);
      if (res && res.success) {
        ids.forEach(id => committedSaleIdsRef.current.delete(id));
        setSales(prev => prev.filter(s => !ids.includes(s.id)));
        api.getProducts().then(setProducts).catch(() => {});
        return true;
      }
      return false;
    } catch (err: any) {
      alert(`Unable to delete sales: ${err.message || 'Server error'}`);
      return false;
    }
  };

  const handleOutcomeStillInterested = async (followUpId: string, nextDateStr: string) => {
    try {
      await api.recordFollowUpOutcome(followUpId, 'Still Interested', nextDateStr);
      setFollowUps(prev =>
        prev.map(f =>
          f.id === followUpId ? { ...f, status: 'completed' as any, outcome: 'Still Interested' as any } : f
        )
      );
    } catch (err: any) {
      alert(`Failed to record outcome: ${err.message || 'Server error'}`);
    }
  };

  const handleOutcomeNotInterested = async (followUpId: string) => {
    try {
      // Update local followUps state optimistically — do NOT reload todayWork so
      // the WorkMode queue snapshot is preserved for the rest of the session.
      await api.recordFollowUpOutcome(followUpId, 'Not Interested');
      setFollowUps(prev =>
        prev.map(f => f.id === followUpId ? { ...f, status: 'completed' as any, outcome: 'Not Interested' as any } : f)
      );
    } catch (err: any) {
      console.error('Failed to record Not Interested outcome:', err);
    }
  };

  const handleOutcomeNoResponse = async (followUpId: string, scheduleNext: boolean) => {
    try {
      // Update local followUps state optimistically — do NOT reload todayWork so
      // the WorkMode queue snapshot is preserved for the rest of the session.
      await api.recordFollowUpOutcome(followUpId, 'No Response', undefined, scheduleNext);
      setFollowUps(prev =>
        prev.map(f => f.id === followUpId ? { ...f, status: 'completed' as any, outcome: 'No Response' as any } : f)
      );
    } catch (err: any) {
      console.error('Failed to record No Response outcome:', err);
    }
  };

  const addNote = (customerId: string, content: string) => {
    const newNote: Note = {
      id: `N-${Date.now()}`,
      customerId,
      content,
      createdAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
  };

  const updateShopProfile = async (data: { name?: string; phone?: string; isGstRegistered?: boolean; gstin?: string; legalName?: string; address?: string; state?: string; stateCode?: string; defaultRate?: number; lengthBasedBillingEnabled?: boolean }): Promise<boolean> => {
    try {
      const res = await api.updateShopProfile(data);
      if (res.success && res.shop) {
        if (currentUser) {
          setCurrentUser({
            ...currentUser,
            shopName: res.shop.name
          });
        }
        setShopProfile({
          name: res.shop.name || 'QuickR Shop',
          phone: res.shop.phone || '',
          isGstRegistered: !!res.shop.isGstRegistered,
          gstin: res.shop.gstin || '',
          stateCode: res.shop.gst?.stateCode || res.shop.stateCode || '33',
          gst: res.shop.gst,
          lengthBasedBillingEnabled: !!res.shop.lengthBasedBillingEnabled
        });
        await loadBusinessData();
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Failed to update shop profile:', err);
      throw err;
    }
  };

  const generateProductBarcode = async (productId: string): Promise<Product | null> => {
    try {
      const updated = await api.generateProductBarcode(productId);
      setProducts(prev => prev.map(p => p.id === productId ? updated : p));
      return updated;
    } catch (err: any) {
      alert(`Unable to generate barcode: ${err.message || 'Server error'}`);
      return null;
    }
  };

  const contextValue = useMemo<AppContextType>(() => ({
    currentUser,
    isAuthenticated,
    customers,
    products,
    enquiries,
    followUps,
    sales,
    activities,
    notes,
    messages,
    todayWork,
    shopProfile,
    shopName: shopProfile?.name || (currentUser?.shopId ? `Shop ${currentUser.shopId}` : 'QuickR Shop'),
    salesSessionActive,
    startSalesSession,
    endSalesSession,
    isLoading,
    error,
    login,
    register,
    logout,
    addProduct,
    generateProductBarcode,
    updateProduct,
    deleteProduct,
    bulkDeleteProducts,
    importProducts,
    addCustomer,
    deleteCustomer,
    bulkDeleteCustomers,
    addEnquiry,
    deleteEnquiry,
    bulkDeleteEnquiries,
    updateEnquiry,
    updateFollowUpStatus,
    sendWhatsAppMock,
    createSale,
    reconcileSale,
    deleteSales,
    handleOutcomeStillInterested,
    handleOutcomeNotInterested,
    handleOutcomeNoResponse,
    addNote,
    updateShopProfile,
    connectionState,
    checkHealth,
    refreshTodayWork,
    refreshData: loadBusinessData,
    resetData: loadBusinessData,
    pwaInstallPrompt,
    triggerPwaInstall
  }), [
    currentUser,
    isAuthenticated,
    customers,
    products,
    enquiries,
    followUps,
    sales,
    activities,
    notes,
    messages,
    todayWork,
    shopProfile,
    salesSessionActive,
    startSalesSession,
    endSalesSession,
    isLoading,
    error,
    logout,
    connectionState,
    refreshTodayWork,
    loadBusinessData,
    pwaInstallPrompt,
    triggerPwaInstall
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
