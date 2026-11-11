import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { LanguageProvider } from './context/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { InstallPwaPrompt } from './components/InstallPwaPrompt';
import { X, Loader2 } from 'lucide-react';

// Lazy-load all route views for fast initial bundle load
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile').then(m => ({ default: m.CustomerProfile })));
const NewEnquiry = lazy(() => import('./pages/NewEnquiry').then(m => ({ default: m.NewEnquiry })));
const SmartFollowUp = lazy(() => import('./pages/SmartFollowUp').then(m => ({ default: m.SmartFollowUp })));
const WorkMode = lazy(() => import('./pages/WorkMode').then(m => ({ default: m.WorkMode })));
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const Sales = lazy(() => import('./pages/Sales').then(m => ({ default: m.Sales })));
const Automation = lazy(() => import('./pages/Automation').then(m => ({ default: m.Automation })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Campaigns = lazy(() => import('./pages/Campaigns').then(m => ({ default: m.Campaigns })));
const Enquiries = lazy(() => import('./pages/Enquiries').then(m => ({ default: m.Enquiries })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Register').then(m => ({ default: m.Register })));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminShops = lazy(() => import('./pages/AdminShops').then(m => ({ default: m.AdminShops })));
const AdminShopDetails = lazy(() => import('./pages/AdminShopDetails').then(m => ({ default: m.AdminShopDetails })));
const AdminUsers = lazy(() => import('./pages/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminActivity = lazy(() => import('./pages/AdminActivity').then(m => ({ default: m.AdminActivity })));
const AdminCustomers = lazy(() => import('./pages/AdminCustomers').then(m => ({ default: m.AdminCustomers })));
const AdminProducts = lazy(() => import('./pages/AdminProducts').then(m => ({ default: m.AdminProducts })));
const AdminEnquiries = lazy(() => import('./pages/AdminEnquiries').then(m => ({ default: m.AdminEnquiries })));
const AdminFollowUps = lazy(() => import('./pages/AdminFollowUps').then(m => ({ default: m.AdminFollowUps })));
const AdminSales = lazy(() => import('./pages/AdminSales').then(m => ({ default: m.AdminSales })));
const AdminBilling = lazy(() => import('./pages/AdminBilling').then(m => ({ default: m.AdminBilling })));
const AdminReports = lazy(() => import('./pages/AdminReports').then(m => ({ default: m.AdminReports })));
const PrivacyNotice = lazy(() => import('./pages/PrivacyNotice').then(m => ({ default: m.PrivacyNotice })));
const PrivacyDashboard = lazy(() => import('./pages/PrivacyDashboard').then(m => ({ default: m.PrivacyDashboard })));
const AdminPrivacy = lazy(() => import('./pages/AdminPrivacy').then(m => ({ default: m.AdminPrivacy })));
const AdminDatabaseStorage = lazy(() => import('./pages/AdminDatabaseStorage').then(m => ({ default: m.AdminDatabaseStorage })));
const CustomerReengagement = lazy(() => import('./pages/CustomerReengagement').then(m => ({ default: m.CustomerReengagement })));
const SalesSession = lazy(() => import('./pages/SalesSession').then(m => ({ default: m.SalesSession })));

const PageFallback: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-10 text-slate-500">
    <Loader2 className="w-7 h-7 text-primary-500 animate-spin mb-2" />
    <span className="text-xs font-semibold">Loading view...</span>
  </div>
);

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, currentUser, login, shopName } = useApp();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [billingInitialData, setBillingInitialData] = useState<any>(null);
  const [reengagementCustomerIds, setReengagementCustomerIds] = useState<string[]>([]);
  const [adminSelectedShopId, setAdminSelectedShopId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Set the correct default page based on role after authentication, or resume pending uncertain bill after refresh
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      if (currentUser.role === 'admin' && !currentPage.startsWith('admin-')) {
        setCurrentPage('admin-dashboard');
        return;
      }
      if (currentUser.role !== 'admin') {
        try {
          const pendingKey = `quickr_pending_sale_${currentUser.shopId || 'shop'}_${currentUser.id}`;
          const rawPending = sessionStorage.getItem(pendingKey);
          if (rawPending) {
            const parsed = JSON.parse(rawPending);
            if (parsed?.requestId && parsed?.submissionUncertain && Array.isArray(parsed?.items) && parsed.items.length > 0) {
              setCurrentPage('sales-session');
            }
          }
        } catch {
          // Ignore sessionStorage errors
        }
      }
    }
  }, [isAuthenticated, currentUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center font-sans text-slate-100">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-300">Loading QuickR...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (authMode === 'register') {
      return (
        <Suspense fallback={<PageFallback />}>
          <Register
            onSwitchToLogin={() => setAuthMode('login')}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<PageFallback />}>
        <Login
          onLogin={login}
          onSwitchToRegister={() => setAuthMode('register')}
        />
      </Suspense>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      // ─── Admin Pages ───
      case 'admin-dashboard':
        return <AdminDashboard setCurrentPage={setCurrentPage} />;
      case 'admin-shops':
        return <AdminShops setCurrentPage={setCurrentPage} setAdminSelectedShopId={setAdminSelectedShopId} />;
      case 'admin-shop-details':
        return <AdminShopDetails shopId={adminSelectedShopId} setCurrentPage={setCurrentPage} />;
      case 'admin-users':
        return <AdminUsers setCurrentPage={setCurrentPage} />;
      case 'admin-activity':
        return <AdminActivity setCurrentPage={setCurrentPage} />;
      case 'admin-customers':
        return <AdminCustomers setCurrentPage={setCurrentPage} />;
      case 'admin-products':
        return <AdminProducts setCurrentPage={setCurrentPage} />;
      case 'admin-enquiries':
        return <AdminEnquiries setCurrentPage={setCurrentPage} />;
      case 'admin-followups':
        return <AdminFollowUps setCurrentPage={setCurrentPage} />;
      case 'admin-sales':
        return <AdminSales setCurrentPage={setCurrentPage} />;
      case 'admin-billing':
        return <AdminBilling setCurrentPage={setCurrentPage} />;
      case 'admin-reports':
        return <AdminReports setCurrentPage={setCurrentPage} />;
      case 'admin-privacy':
        return <AdminPrivacy />;
      case 'admin-storage':
        return <AdminDatabaseStorage setCurrentPage={setCurrentPage} />;

      // ─── Business Pages ───
      case 'dashboard':
        return <Dashboard setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
      case 'customers':
        return <Customers setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
      case 'customer-profile':
        return (
          <CustomerProfile 
            customerId={selectedCustomerId || ''} 
            setCurrentPage={setCurrentPage} 
            setSelectedCustomerId={setSelectedCustomerId} 
          />
        );
      case 'new-enquiry':
        return (
          <NewEnquiry 
            setCurrentPage={setCurrentPage} 
            setSelectedCustomerId={setSelectedCustomerId} 
            initialCustomerId={selectedCustomerId || undefined}
          />
        );
      case 'smart-followup':
        return <SmartFollowUp setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
      case 'work-mode':
        return <WorkMode setCurrentPage={setCurrentPage} setBillingInitialData={setBillingInitialData} />;
      case 'sales-session':
        return (
          <SalesSession
            setCurrentPage={setCurrentPage}
            billingInitialData={billingInitialData}
            onClearBillingInitialData={() => setBillingInitialData(null)}
          />
        );
      case 'products':
        return <Products />;
      case 'billing':
        return (
          <SalesSession
            setCurrentPage={setCurrentPage}
            billingInitialData={billingInitialData}
            onClearBillingInitialData={() => setBillingInitialData(null)}
          />
        );
      case 'enquiries':
        return <Enquiries setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
      case 'sales':
        return <Sales setCurrentPage={setCurrentPage} />;
      case 'automation':
        return <Automation />;
      case 'reports':
        if (currentUser?.role === 'staff') {
          return <Dashboard setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
        }
        return <Reports />;
      case 'campaigns':
        return <Campaigns setCurrentPage={setCurrentPage} initialSelectedCustomerIds={reengagementCustomerIds} />;
      case 'reengagement':
        return (
          <CustomerReengagement 
            setCurrentPage={setCurrentPage} 
            setReengagementCustomerIdsForCampaign={setReengagementCustomerIds} 
          />
        );
      case 'privacy':
        return <PrivacyDashboard setCurrentPage={setCurrentPage} />;
      case 'privacy-notice':
        return <PrivacyNotice setCurrentPage={setCurrentPage} />;
      case 'settings':
        return <Settings setCurrentPage={setCurrentPage} />;
      default:
        return <Dashboard setCurrentPage={setCurrentPage} setSelectedCustomerId={setSelectedCustomerId} />;
    }
  };

  const pageTitles: Record<string, string> = {
    dashboard: shopName ? `Welcome, ${shopName}` : 'Welcome',
    customers: 'Customers',
    'customer-profile': 'Customer Profile',
    'new-enquiry': 'New Enquiry',
    'smart-followup': 'Smart Follow-up',
    'work-mode': 'Focused Work Mode',
    products: 'Products',
    billing: 'New Bill',
    'sales-session': 'Sales Session',
    enquiries: 'Enquiries',
    sales: 'Sales',
    automation: 'Automation',
    reports: 'Reports',
    campaigns: 'Offers & Campaigns',
    reengagement: 'Customer Re-Engagement',
    privacy: 'Privacy & Data Controls',
    'privacy-notice': 'Privacy & Data Protection Notice',
    settings: 'Settings',
    'admin-dashboard': 'Admin Dashboard',
    'admin-shops': 'Shop Management',
    'admin-shop-details': 'Shop Details',
    'admin-users': 'User Management',
    'admin-activity': 'Activity Log',
    'admin-customers': 'Global Customer Directory',
    'admin-products': 'Global Product Inventory',
    'admin-enquiries': 'Global Enquiries',
    'admin-followups': 'Global Follow-ups',
    'admin-sales': 'Global Sales Registry',
    'admin-billing': 'Global Billing Records',
    'admin-reports': 'Admin Reports & Analytics',
    'admin-privacy': 'Admin Privacy & Compliance Dashboard',
    'admin-storage': 'Database Storage Monitor'
  };

  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full min-w-0 bg-slate-50 font-sans">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block shrink-0">
        <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white">
            <div className="absolute right-4 top-4">
              <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-slate-500 rounded-lg hover:bg-slate-50">
                <X className="w-6 h-6" />
              </button>
            </div>
            <Sidebar currentPage={currentPage} setCurrentPage={(p) => { setCurrentPage(p); setMobileMenuOpen(false); }} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-grow flex flex-col min-w-0 min-h-screen overflow-x-clip">
        {/* PWA Install & Offline Banner */}
        <InstallPwaPrompt />

        {/* Top Header */}
        <Header 
          title={pageTitles[currentPage] || 'Dashboard'} 
          setCurrentPage={setCurrentPage}
          setSelectedCustomerId={setSelectedCustomerId}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        {/* Page Content */}
        <main className={`flex-1 flex flex-col w-full min-w-0 min-h-0 bg-slate-50 pt-safe ${!currentUser?.role?.includes('admin') ? 'pb-mobile-nav' : 'pb-6'}`}>
          <Suspense fallback={<PageFallback />}>
            {renderPage()}
          </Suspense>
        </main>

        {/* Mobile Bottom Navigation */}
        {!currentUser?.role?.includes('admin') && (
          <BottomNav 
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
          />
        )}
      </div>
    </div>
  );
};

export function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;

