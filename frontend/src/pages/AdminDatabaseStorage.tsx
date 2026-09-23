import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { 
  Database, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  HardDrive, 
  Layers, 
  FileText, 
  Package, 
  Users, 
  IndianRupee, 
  MessageSquare, 
  ClipboardList, 
  Activity, 
  ArrowRight,
  ShieldCheck,
  Barcode
} from 'lucide-react';

interface AdminDatabaseStorageProps {
  setCurrentPage?: (page: string) => void;
}

export const AdminDatabaseStorage: React.FC<AdminDatabaseStorageProps> = ({ setCurrentPage }) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    checkedAt: string;
    database: {
      dataSizeBytes: number;
      storageSizeBytes: number;
      indexSizeBytes: number;
      totalSizeBytes: number;
      collections: number;
    };
    limits: {
      configured: boolean;
      limitMb: number | null;
      limitBytes: number | null;
      usedPercentage: number;
      remainingBytes: number | null;
      warningLevel: 'NORMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    };
    collections: Array<{
      name: string;
      documents: number;
      dataSizeBytes: number;
      storageSizeBytes: number;
      indexSizeBytes: number;
      totalSizeBytes: number;
    }>;
    shop: {
      shopId: string;
      products: number;
      customers: number;
      sales: number;
      enquiries: number;
      followUps: number;
      activities: number;
    };
    productCatalog: {
      totalProducts: number;
      activeProducts: number;
      inactiveProducts: number;
      withBarcode: number;
      withoutBarcode: number;
    };
  } | null>(null);

  const fetchStorageData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await api.adminGetDatabaseStorage();
      if (res.success) {
        setData(res);
      } else {
        setError(t('storage.unableToLoad') || 'Unable to load database storage information.');
      }
    } catch (err: any) {
      console.error('Failed to load database storage stats:', err);
      setError(err.message || t('storage.unableToLoad') || 'Unable to load database storage information.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStorageData();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (isoString?: string): string => {
    if (!isoString) return 'N/A';
    try {
      return new Date(isoString).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'medium'
      });
    } catch {
      return isoString;
    }
  };

  if (loading && !data) {
    return (
      <div className="flex-grow p-4 lg:p-8 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-primary-600" />
          <p className="text-sm font-semibold">{t('common.loading') || 'Loading database storage metrics...'}</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex-grow p-4 lg:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto bg-white p-8 rounded-2xl border border-red-200 text-center shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">{t('storage.unableToLoad') || 'Unable to load database storage information.'}</h2>
          <p className="text-sm text-slate-500 mb-6">{error}</p>
          <button
            onClick={() => fetchStorageData(true)}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            {t('storage.refresh') || 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const { database, limits, collections, shop, productCatalog, checkedAt } = data!;

  const getStatusBadge = () => {
    if (!limits.configured) {
      return (
        <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1 rounded-full border border-slate-200">
          <HardDrive className="w-3.5 h-3.5 text-slate-500" />
          {t('storage.limitNotConfigured') || 'Storage limit not configured'}
        </span>
      );
    }

    switch (limits.warningLevel) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-800 text-xs font-bold px-3 py-1 rounded-full border border-red-200">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
            {t('storage.criticalUsage') || 'Critical Usage'} ({limits.usedPercentage}%)
          </span>
        );
      case 'HIGH':
        return (
          <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full border border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            {t('storage.highUsage') || 'High Usage'} ({limits.usedPercentage}%)
          </span>
        );
      case 'MODERATE':
        return (
          <span className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full border border-blue-200">
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            {t('storage.moderateUsage') || 'Moderate Usage'} ({limits.usedPercentage}%)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {t('storage.normal') || 'Normal Usage'} ({limits.usedPercentage}%)
          </span>
        );
    }
  };

  return (
    <div className="flex-grow p-4 lg:p-8 space-y-6 bg-slate-50 min-h-screen font-sans">
      {/* Page Header */}
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary-100 text-primary-700 rounded-xl">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{t('storage.title') || 'Database Storage Monitor'}</h1>
              <p className="text-xs text-slate-500 font-medium">
                {t('storage.subtitle') || 'Real MongoDB collection & storage breakdown'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500 hidden sm:inline-block">
            {t('storage.lastChecked') || 'Last checked'}: {formatDate(checkedAt)}
          </span>
          <button
            onClick={() => fetchStorageData(true)}
            disabled={refreshing}
            aria-label="Refresh database storage"
            className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2 rounded-xl font-bold text-sm shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-primary-600' : 'text-slate-500'}`} />
            <span>{refreshing ? (t('storage.refreshing') || 'Refreshing...') : (t('storage.refresh') || 'Refresh')}</span>
          </button>
        </div>
      </div>

      {/* Main Storage Metric Cards */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Total Storage Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('storage.totalStorage') || 'Database Storage'}</span>
            {getStatusBadge()}
          </div>
          <div>
            <p className="text-3xl font-black text-slate-800">{formatBytes(database.totalSizeBytes)}</p>
            {limits.configured && (
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Configured Limit: {limits.limitMb} MB ({formatBytes(limits.remainingBytes || 0)} free)
              </p>
            )}
          </div>
          {limits.configured && (
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-4">
              <div 
                className={`h-full transition-all duration-500 ${
                  limits.warningLevel === 'CRITICAL' ? 'bg-red-500' :
                  limits.warningLevel === 'HIGH' ? 'bg-amber-500' :
                  limits.warningLevel === 'MODERATE' ? 'bg-blue-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, limits.usedPercentage)}%` }}
              />
            </div>
          )}
        </div>

        {/* Data Storage Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('storage.dataStorage') || 'Data Storage'}</span>
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <FileText className="w-4 h-4" />
            </span>
          </div>
          <div>
            <p className="text-3xl font-black text-slate-800">{formatBytes(database.storageSizeBytes)}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Raw Data Size: {formatBytes(database.dataSizeBytes)}
            </p>
          </div>
          <div className="text-[11px] text-slate-400 font-medium mt-4">
            Actual BSON data documents stored on disk
          </div>
        </div>

        {/* Index Storage Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('storage.indexStorage') || 'Index Storage'}</span>
            <span className="p-2 bg-purple-50 text-purple-600 rounded-lg">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <div>
            <p className="text-3xl font-black text-slate-800">{formatBytes(database.indexSizeBytes)}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Collections: {database.collections}
            </p>
          </div>
          <div className="text-[11px] text-slate-400 font-medium mt-4">
            RAM & Disk memory consumed by query indexes
          </div>
        </div>
      </div>

      {/* Your Shop Data Breakdown */}
      <div className="max-w-7xl mx-auto bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary-600" />
            {t('storage.yourShopData') || 'Your Shop Data Summary'}
          </h2>
          <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
            Shop ID: {shop.shopId}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <Package className="w-5 h-5 text-amber-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">{t('common.products') || 'Products'}</span>
            <span className="text-lg font-black text-slate-800">{shop.products.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <Users className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">{t('common.customers') || 'Customers'}</span>
            <span className="text-lg font-black text-slate-800">{shop.customers.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <IndianRupee className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">{t('common.sales') || 'Sales'}</span>
            <span className="text-lg font-black text-slate-800">{shop.sales.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <MessageSquare className="w-5 h-5 text-pink-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">{t('common.enquiries') || 'Enquiries'}</span>
            <span className="text-lg font-black text-slate-800">{shop.enquiries.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <ClipboardList className="w-5 h-5 text-orange-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">{t('common.followUps') || 'Follow-ups'}</span>
            <span className="text-lg font-black text-slate-800">{shop.followUps.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-center">
            <Activity className="w-5 h-5 text-teal-600 mx-auto mb-1" />
            <span className="text-xs text-slate-500 font-semibold block">Activities</span>
            <span className="text-lg font-black text-slate-800">{shop.activities.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Product Catalog Stats */}
      <div className="max-w-7xl mx-auto bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Barcode className="w-5 h-5 text-primary-600" />
            {t('storage.productCatalog') || 'Product Catalog Breakdown'}
          </h2>
          <span className="text-xs font-medium text-slate-500">
            Multi-Tenant Catalog Safety Validated
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <span className="text-xs text-slate-500 font-semibold block">Total Catalog</span>
            <span className="text-lg font-black text-slate-800">{productCatalog.totalProducts.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-100">
            <span className="text-xs text-emerald-700 font-semibold block">Active Products</span>
            <span className="text-lg font-black text-emerald-900">{productCatalog.activeProducts.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-200">
            <span className="text-xs text-slate-600 font-semibold block">Inactive / Soft Deleted</span>
            <span className="text-lg font-black text-slate-700">{productCatalog.inactiveProducts.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100">
            <span className="text-xs text-blue-700 font-semibold block">With Barcode</span>
            <span className="text-lg font-black text-blue-900">{productCatalog.withBarcode.toLocaleString('en-IN')}</span>
          </div>

          <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-100">
            <span className="text-xs text-amber-700 font-semibold block">Without Barcode</span>
            <span className="text-lg font-black text-amber-900">{productCatalog.withoutBarcode.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Storage Breakdown Collection Table */}
      <div className="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{t('storage.storageBreakdown') || 'MongoDB Collection Breakdown'}</h2>
            <p className="text-xs text-slate-500 font-medium">Real collection metrics sorted by total storage size</p>
          </div>
          {setCurrentPage && (
            <button
              onClick={() => setCurrentPage('settings')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-700 hover:underline"
            >
              Storage Cleanup Settings
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-5">Collection</th>
                <th className="py-3 px-5 text-right">Documents</th>
                <th className="py-3 px-5 text-right">Data Size</th>
                <th className="py-3 px-5 text-right">Index Size</th>
                <th className="py-3 px-5 text-right">Total Storage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-700">
              {collections.map((coll) => (
                <tr key={coll.name} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-5 font-bold text-slate-800 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-400" />
                    <span>{coll.name}</span>
                  </td>
                  <td className="py-3.5 px-5 text-right font-mono text-slate-600">{coll.documents.toLocaleString('en-IN')}</td>
                  <td className="py-3.5 px-5 text-right font-mono text-slate-600">{formatBytes(coll.storageSizeBytes)}</td>
                  <td className="py-3.5 px-5 text-right font-mono text-slate-600">{formatBytes(coll.indexSizeBytes)}</td>
                  <td className="py-3.5 px-5 text-right font-mono font-bold text-slate-900">{formatBytes(coll.totalSizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Storage Limit Disclaimer */}
      <div className="max-w-7xl mx-auto bg-slate-100 p-4 rounded-xl text-xs text-slate-500 font-medium leading-relaxed border border-slate-200">
        📌 <span className="font-bold text-slate-700">Disclaimer:</span> Actual database usage is calculated directly from MongoDB <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800">dbStats</code> and <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800">collStats</code>. The storage limit shown here is the QuickR monitoring limit configured by the server environment (<code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800">QUICKR_STORAGE_LIMIT_MB</code>).
      </div>
    </div>
  );
};
