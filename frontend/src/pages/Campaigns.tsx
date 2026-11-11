import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../services/api';
import type { Campaign, CampaignRecipient, CampaignTemplate } from '../types';
import { 
  Megaphone, 
  Plus, 
  X, 
  CheckCircle, 
  AlertCircle, 
  ChevronRight, 
  Filter,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  ShoppingCart,
  Calendar,
  Clock,
  Search,
  SkipForward,
  RefreshCw,
  Send,
  Download,
  AlertTriangle,
  ShieldCheck,
  Settings as SettingsIcon,
  StopCircle,
  FileText
} from 'lucide-react';

interface CampaignsProps {
  setCurrentPage?: (page: string) => void;
  initialSelectedCustomerIds?: string[];
}

export const Campaigns: React.FC<CampaignsProps> = ({ setCurrentPage, initialSelectedCustomerIds }) => {
  const { products, shopName } = useApp();
  const { language } = useLanguage();
  const isTa = language === 'ta';

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'create'>(
    initialSelectedCustomerIds && initialSelectedCustomerIds.length > 0 ? 'create' : 'list'
  );

  // Dashboard Metrics & Provider Status
  const [dashboardMetrics, setDashboardMetrics] = useState({
    totalCampaigns: 0,
    activeCampaigns: 0,
    completedCampaigns: 0,
    totalDeliveredMessages: 0,
    totalSentMessages: 0
  });
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);

  // Report Modal state
  const [selectedReportCampaign, setSelectedReportCampaign] = useState<Campaign | null>(null);
  const [reportRecipients, setReportRecipients] = useState<CampaignRecipient[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportFilter, setReportFilter] = useState<string>('ALL');
  const [reportSearch, setReportSearch] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Send & Cancel confirmation state
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const [confirmSendCampaign, setConfirmSendCampaign] = useState<Campaign | null>(null);

  // Manual WhatsApp Fallback Modal state
  const [manualModalCampaign, setManualModalCampaign] = useState<any | null>(null);
  const [manualTargets, setManualTargets] = useState<any[]>([]);
  const [manualIndex, setManualIndex] = useState(0);
  const [loadingManualTargets, setLoadingManualTargets] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [skipConfirmTarget, setSkipConfirmTarget] = useState<any | null>(null);

  // Customer Response Recording Modal state
  const [responseModalCampaign, setResponseModalCampaign] = useState<any | null>(null);
  const [responseTargetCustomer, setResponseTargetCustomer] = useState<any | null>(null);
  const [selectedResponseType, setSelectedResponseType] = useState<string>('INTERESTED');
  const [responseNotes, setResponseNotes] = useState<string>('');
  const [scheduledFollowUpDate, setScheduledFollowUpDate] = useState<string>(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().substring(0, 10));
  const [submittingResponse, setSubmittingResponse] = useState(false);

  // Creation Wizard Multi-step State (1: Details, 2: Audience, 3: Template, 4: Preview, 5: Review & Launch)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Offer Details
  const [title, setTitle] = useState(initialSelectedCustomerIds && initialSelectedCustomerIds.length > 0 ? 'Customer Special Offer' : '');
  const [description, setDescription] = useState(initialSelectedCustomerIds && initialSelectedCustomerIds.length > 0 ? 'Exclusive offer for returning customers' : '');
  const [campaignType, setCampaignType] = useState<'discount_offer' | 'new_arrival' | 'clearance' | 'festive_deal' | 'general_announcement'>('discount_offer');
  const [discountType, setDiscountType] = useState<'Percentage' | 'Fixed Amount'>('Percentage');
  const [discountValue, setDiscountValue] = useState<string>('20');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().substring(0, 10));
  const [endDate, setEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().substring(0, 10);
  });

  // Step 2: Customer Targeting
  const [filterType, setFilterType] = useState<string>('all_eligible');
  const [eligibleCustomers, setEligibleCustomers] = useState<any[]>([]);
  const [ineligibleCustomers, setIneligibleCustomers] = useState<any[]>([]);
  const [selectedCustIds, setSelectedCustIds] = useState<string[]>(initialSelectedCustomerIds || []);
  const [loadingTargeting, setLoadingTargeting] = useState(false);
  const [audienceSearch, setAudienceSearch] = useState('');

  // Step 3: Template Selection
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>('quickr_offer_campaign');

  // Feedback Messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submittingCampaign, setSubmittingCampaign] = useState(false);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const [list, pStatus, metricsRes, tplRes] = await Promise.all([
        api.getCampaigns(),
        api.getWhatsAppProviderStatus(),
        api.getCampaignDashboardMetrics(),
        api.getCampaignTemplates()
      ]);
      setCampaigns(list);
      setProviderStatus(pStatus);
      if (metricsRes.success) setDashboardMetrics(metricsRes.metrics);
      if (tplRes.success) setTemplates(tplRes.templates);
    } catch (err: any) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  // Live polling when any campaign is currently SENDING
  useEffect(() => {
    const hasActiveSending = campaigns.some(c => c.status === 'SENDING');
    if (!hasActiveSending) return;

    const interval = setInterval(async () => {
      try {
        const [list, metricsRes] = await Promise.all([
          api.getCampaigns(),
          api.getCampaignDashboardMetrics()
        ]);
        setCampaigns(list);
        if (metricsRes.success) setDashboardMetrics(metricsRes.metrics);

        // Also update report recipients if open
        if (selectedReportCampaign) {
          const updated = list.find((c: any) => c.id === selectedReportCampaign.id);
          if (updated) setSelectedReportCampaign(updated);
          const recs = await api.getCampaignRecipients(selectedReportCampaign.id, reportFilter, reportSearch);
          setReportRecipients(recs);
        }
      } catch (e) {
        console.warn('Polling error:', e);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [campaigns, selectedReportCampaign, reportFilter, reportSearch]);

  const handleOpenReport = async (camp: Campaign) => {
    setSelectedReportCampaign(camp);
    setLoadingReport(true);
    setErrorMsg(null);
    try {
      const recs = await api.getCampaignRecipients(camp.id);
      setReportRecipients(recs);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load campaign recipients.');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleFilterReport = async (status: string) => {
    if (!selectedReportCampaign) return;
    setReportFilter(status);
    setLoadingReport(true);
    try {
      const recs = await api.getCampaignRecipients(selectedReportCampaign.id, status, reportSearch);
      setReportRecipients(recs);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to filter report.');
    } finally {
      setLoadingReport(false);
    }
  };

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearchReport = (searchQuery: string) => {
    if (!selectedReportCampaign) return;
    setReportSearch(searchQuery);
    const campId = selectedReportCampaign.id;
    const activeFilter = reportFilter;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const recs = await api.getCampaignRecipients(campId, activeFilter, searchQuery);
        setReportRecipients(recs);
      } catch (err: any) {
        console.warn('Search report error:', err);
      }
    }, 300);
  };

  const handleExportCSV = async (campId: string) => {
    try {
      await api.exportCampaignReport(campId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to export CSV report.');
    }
  };

  const handleRetryFailed = async (campId: string) => {
    setIsRetrying(true);
    setErrorMsg(null);
    try {
      const res = await api.retryFailedCampaignRecipients(campId);
      if (res.success) {
        setSuccessMsg(isTa ? `தவறிய வாடிக்கையாளர்கள் மீண்டும் அனுப்ப வரிசையில் சேர்க்கப்பட்டனர் (${res.retriedCount}).` : `Queued ${res.retriedCount || 0} failed recipient(s) for retry.`);
        fetchCampaigns();
        if (selectedReportCampaign) {
          const recs = await api.getCampaignRecipients(campId, reportFilter, reportSearch);
          setReportRecipients(recs);
        }
      } else {
        setErrorMsg(res.message || 'No failed recipients found.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to retry recipients.');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancelSending = async (campId: string) => {
    if (!confirm(isTa ? 'பிரச்சாரத்தை ரத்துசெய்ய விரும்புகிறீர்களா?' : 'Are you sure you want to cancel remaining message dispatch for this campaign?')) return;
    setIsCancelling(true);
    setErrorMsg(null);
    try {
      const res = await api.cancelCampaign(campId);
      if (res.success) {
        setSuccessMsg(isTa ? 'பிரச்சாரம் ரத்து செய்யப்பட்டது.' : 'Campaign message dispatch cancelled.');
        fetchCampaigns();
        if (selectedReportCampaign) {
          setSelectedReportCampaign(res.campaign);
          const recs = await api.getCampaignRecipients(campId, reportFilter, reportSearch);
          setReportRecipients(recs);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to cancel campaign.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Launch Campaign via Official Meta WhatsApp Cloud API
  const handleConfirmSend = async (campaign: any) => {
    if (!campaign) return;
    setSendingCampaignId(campaign.id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.sendCampaign(campaign.id);
      if (res.success) {
        setSuccessMsg(isTa ? `அதிகாரப்பூர்வ வாட்ஸ்அப் பிரச்சாரம் தொடங்கப்பட்டது! (${res.summary?.queued || 0} வாடிக்கையாளர்கள் வரிசைப்படுத்தப்பட்டனர்).` : `Campaign dispatch initiated for ${res.summary?.queued || 0} eligible customer(s)!`);
        setConfirmSendCampaign(null);
        fetchCampaigns();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send campaign via WhatsApp.');
    } finally {
      setSendingCampaignId(null);
    }
  };

  // Manual WhatsApp web link fallback
  const handleOpenManualCampaign = async (campaign: any) => {
    setLoadingManualTargets(true);
    setErrorMsg(null);
    try {
      const res = await api.getManualCampaignTargets(campaign.id);
      if (res.success && res.targets.length > 0) {
        setManualTargets(res.targets);
        setManualModalCampaign(campaign);
        setManualNotice(null);
        const firstPendingIdx = res.targets.findIndex((t: any) => t.status === 'PENDING');
        setManualIndex(firstPendingIdx !== -1 ? firstPendingIdx : 0);
      } else {
        setErrorMsg(isTa ? 'அனுப்ப தகுதியான வாடிக்கையாளர்கள் இல்லை.' : 'No eligible customers found with valid phone and marketing consent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load manual targets.');
    } finally {
      setLoadingManualTargets(false);
    }
  };

  const handleOpenWhatsAppLink = (link: string) => {
    window.open(link, '_blank');
    setManualNotice(isTa ? 'வாட்ஸ்அப் திறக்கப்பட்டது. செய்தியை சரிபார்த்து வாட்ஸ்அப்பில் அனுப்பு என்பதை அழுத்தவும்.' : 'WhatsApp opened. Please review the message and press Send in WhatsApp.');
  };

  const handleMarkManualSent = async () => {
    if (!manualModalCampaign || manualTargets.length === 0) return;
    const currentTarget = manualTargets[manualIndex];
    try {
      await api.markManualRecipientSent(manualModalCampaign.id, currentTarget.id);
      const updatedTargets = [...manualTargets];
      updatedTargets[manualIndex] = { ...currentTarget, status: 'MANUAL_SENT' };
      setManualTargets(updatedTargets);

      const nextPendingIdx = updatedTargets.findIndex((t: any, idx: number) => idx > manualIndex && t.status === 'PENDING');
      if (nextPendingIdx !== -1) {
        setManualIndex(nextPendingIdx);
        setManualNotice(null);
        setCopiedMessage(false);
      } else if (manualIndex < updatedTargets.length - 1) {
        setManualIndex(manualIndex + 1);
        setManualNotice(null);
        setCopiedMessage(false);
      } else {
        setSuccessMsg(isTa ? 'கைமுறை வாட்ஸ்அப் பணி முடிந்தது.' : 'Manual WhatsApp campaign workflow completed for all selected customers.');
        setManualModalCampaign(null);
        fetchCampaigns();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to mark recipient as sent.');
    }
  };

  const handleSkipCustomer = async (target: any) => {
    if (!manualModalCampaign || !target) return;
    try {
      await api.skipManualRecipient(manualModalCampaign.id, target.id);
      const updatedTargets = [...manualTargets];
      const targetIdx = updatedTargets.findIndex(t => t.id === target.id);
      if (targetIdx !== -1) {
        updatedTargets[targetIdx] = { ...target, status: 'SKIPPED' };
        setManualTargets(updatedTargets);
      }
      setSkipConfirmTarget(null);
      const nextPendingIdx = updatedTargets.findIndex((t: any, idx: number) => idx > manualIndex && t.status === 'PENDING');
      if (nextPendingIdx !== -1) setManualIndex(nextPendingIdx);
      fetchCampaigns();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to skip recipient.');
    }
  };

  const handleRecordCustomerResponse = async () => {
    if (!responseModalCampaign || !responseTargetCustomer) return;
    setSubmittingResponse(true);
    setErrorMsg(null);
    try {
      if (selectedResponseType === 'PURCHASED') {
        if (typeof setCurrentPage === 'function') setCurrentPage('billing');
        setResponseModalCampaign(null);
        return;
      }
      const res = await api.recordCampaignResponse(
        responseModalCampaign.id,
        responseTargetCustomer.id,
        selectedResponseType,
        responseNotes,
        scheduledFollowUpDate,
        `Campaign follow-up: ${responseModalCampaign.title}`
      );
      if (res.success) {
        setSuccessMsg(isTa ? 'பதில் பதிவு செய்யப்பட்டது.' : `Customer response (${selectedResponseType}) recorded.`);
        setResponseModalCampaign(null);
        setResponseTargetCustomer(null);
        fetchCampaigns();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record customer response.');
    } finally {
      setSubmittingResponse(false);
    }
  };

  // Step Navigation in Wizard
  const handleProceedToAudience = async () => {
    setErrorMsg(null);
    if (!title.trim()) return setErrorMsg(isTa ? 'சலுகைத் தலைப்பு தேவை.' : 'Offer title is required.');
    const val = Number(discountValue);
    if (isNaN(val) || val <= 0) return setErrorMsg(isTa ? 'செல்லுபடியாகும் தள்ளுபடி மதிப்பை உள்ளிடவும்.' : 'Enter a valid positive discount value.');
    if (discountType === 'Percentage' && val > 100) return setErrorMsg(isTa ? 'சதவீத தள்ளுபடி 100% க்கு மேல் இருக்கக்கூடாது.' : 'Percentage discount cannot exceed 100%.');
    if (!startDate || !endDate) return setErrorMsg(isTa ? 'தேதிகள் தேவை.' : 'Start and end dates are required.');
    if (new Date(endDate) < new Date(startDate)) return setErrorMsg(isTa ? 'முடிவு தேதி தொடக்க தேதிக்கு முன் இருக்கக்கூடாது.' : 'End date cannot be before start date.');

    setLoadingTargeting(true);
    try {
      const firstProdId = selectedProductIds.length > 0 ? selectedProductIds[0] : undefined;
      const res = await api.getTargetingCustomers(filterType, firstProdId);
      if (res.success) {
        setEligibleCustomers(res.eligibleCustomers);
        setIneligibleCustomers(res.ineligibleCustomers);
        setSelectedCustIds(res.eligibleCustomers.map(c => c.id));
        setStep(2);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch customer list.');
    } finally {
      setLoadingTargeting(false);
    }
  };

  const handleFilterChange = async (newFilter: string) => {
    setFilterType(newFilter);
    setLoadingTargeting(true);
    try {
      const firstProdId = selectedProductIds.length > 0 ? selectedProductIds[0] : undefined;
      const res = await api.getTargetingCustomers(newFilter, firstProdId);
      if (res.success) {
        setEligibleCustomers(res.eligibleCustomers);
        setIneligibleCustomers(res.ineligibleCustomers);
        setSelectedCustIds(res.eligibleCustomers.map(c => c.id));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update targeting.');
    } finally {
      setLoadingTargeting(false);
    }
  };

  const toggleCustSelection = (id: string) => {
    if (selectedCustIds.includes(id)) {
      setSelectedCustIds(selectedCustIds.filter(x => x !== id));
    } else {
      setSelectedCustIds([...selectedCustIds, id]);
    }
  };

  const selectAllEligible = () => {
    setSelectedCustIds(eligibleCustomers.map(c => c.id));
  };

  // Finalize & Create Campaign (DRAFT or READY)
  const handleSaveCampaign = async (intendedStatus: 'DRAFT' | 'READY') => {
    setSubmittingCampaign(true);
    setErrorMsg(null);
    try {
      const payload = {
        title: title.trim(),
        description: description ? description.trim() : '',
        campaignType,
        templateName: selectedTemplateName,
        templateLanguage: 'en',
        discountType,
        discountValue: Number(discountValue),
        productIds: selectedProductIds,
        startDate,
        endDate,
        selectedCustomerIds: selectedCustIds,
        targetAudienceType: filterType,
        status: intendedStatus
      };

      const res = await api.createCampaign(payload);
      if (res.success) {
        setSuccessMsg(isTa ? `பிரச்சாரம் வெற்றிகரமாக உருவாக்கப்பட்டது (${intendedStatus}).` : `Campaign created successfully with status: ${intendedStatus}.`);
        fetchCampaigns();
        setTimeout(() => {
          setViewMode('list');
          setStep(1);
          setSuccessMsg(null);
        }, 1200);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save campaign.');
    } finally {
      setSubmittingCampaign(false);
    }
  };

  const activeProducts = products.filter(p => p.isActive);
  const selectedProductsNames = activeProducts
    .filter(p => selectedProductIds.includes(p.id))
    .map(p => p.name)
    .join(', ') || (isTa ? 'அனைத்து பொருட்கள்' : 'Special Store Collection');

  const discountFormatted = discountType === 'Percentage' ? `${discountValue}%` : `₹${discountValue}`;
  const isShopWhatsAppConnected = Boolean(providerStatus?.shopConnected);

  const currentTemplate = templates.find(t => t.name === selectedTemplateName) || templates[0];

  return (
    <div className="flex-grow p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans text-left">
      
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-soft flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">
                {isTa ? 'சலுகைகள் மற்றும் பிரச்சாரங்கள்' : 'Offers & Campaigns'}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Meta Cloud API
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isTa ? 'அதிகாரப்பூர்வ வணிக வாட்ஸ்அப் மூலம் இலக்கு பிரச்சாரங்களை உருவாக்குங்கள்' : 'Launch targeted promotions to verified customers through your official WhatsApp Business number'}
            </p>
          </div>
        </div>

        {viewMode === 'list' && (
          <button
            onClick={() => { setViewMode('create'); setStep(1); setErrorMsg(null); }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{isTa ? '+ சலுகையை உருவாக்கு' : '+ Create Campaign Offer'}</span>
          </button>
        )}
      </div>

      {/* WhatsApp Business Connection Status Banner */}
      <div className={`p-4 rounded-2xl border shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
        isShopWhatsAppConnected 
          ? 'bg-emerald-50/70 border-emerald-200' 
          : 'bg-amber-50/70 border-amber-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3.5 h-3.5 rounded-full ${isShopWhatsAppConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">
                {isTa ? 'உங்கள் கடையின் வாட்ஸ்அப் வணிக இணைப்பு:' : 'Shop WhatsApp Business Number:'}
              </span>
              <span className={`font-extrabold uppercase px-2 py-0.5 rounded text-[10px] ${
                isShopWhatsAppConnected 
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {isShopWhatsAppConnected ? 'CONNECTED' : 'NOT CONNECTED'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isShopWhatsAppConnected 
                ? `${providerStatus?.businessName || 'Business'} • Phone: ${providerStatus?.displayPhoneNumber || 'Verified'}`
                : (isTa ? 'அதிகாரப்பூர்வ பிரச்சாரங்களை அனுப்ப உங்கள் வணிக வாட்ஸ்அப்பை அமைப்புகளில் இணைக்கவும்.' : 'Connect your official business WhatsApp in Settings to launch automated Cloud API campaigns.')
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isShopWhatsAppConnected && typeof setCurrentPage === 'function' && (
            <button
              onClick={() => setCurrentPage('settings')}
              className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <SettingsIcon className="w-3.5 h-3.5 text-amber-600" />
              <span>{isTa ? 'அமைப்புகளில் இணைக்கவும்' : 'Connect in Settings'}</span>
            </button>
          )}
        </div>
      </div>

      {/* DASHBOARD METRICS CARDS */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-soft">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {isTa ? 'மொத்த பிரச்சாரங்கள்' : 'Total Campaigns'}
            </span>
            <span className="text-2xl font-extrabold text-slate-800 mt-1 block">
              {dashboardMetrics.totalCampaigns}
            </span>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-soft">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">
              {isTa ? 'செயலில் உள்ளவை' : 'Active / Ready'}
            </span>
            <span className="text-2xl font-extrabold text-indigo-600 mt-1 block">
              {dashboardMetrics.activeCampaigns}
            </span>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-soft">
            <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block">
              {isTa ? 'முடிக்கப்பட்டவை' : 'Completed'}
            </span>
            <span className="text-2xl font-extrabold text-blue-600 mt-1 block">
              {dashboardMetrics.completedCampaigns}
            </span>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-soft">
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">
              {isTa ? 'டெலிவரி செய்யப்பட்டவை' : 'Delivered Messages'}
            </span>
            <span className="text-2xl font-extrabold text-emerald-600 mt-1 block">
              {dashboardMetrics.totalDeliveredMessages}
            </span>
          </div>
        </div>
      )}

      {/* Global Feedback Notifications */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="p-1 text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* VIEW MODE: LIST CAMPAIGNS */}
      {viewMode === 'list' && (
        <div className="space-y-4 font-sans">
          {loading ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-xs text-slate-400">
              Loading campaigns...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center space-y-4 shadow-soft">
              <Megaphone className="w-12 h-12 text-slate-300 mx-auto" />
              <div>
                <h3 className="text-base font-bold text-slate-700">No campaigns created yet</h3>
                <p className="text-xs text-slate-400 mt-1">Design your first promotional offer and launch to verified customers.</p>
              </div>
              <button
                onClick={() => { setViewMode('create'); setStep(1); }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all"
              >
                + Create Campaign Offer
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns.map(c => {
                const total = c.totalRecipients || c.eligibleCustomerCount || 0;
                const sent = c.sentCount || 0;
                const delivered = c.deliveredCount || 0;
                const read = c.readCount || 0;
                const failed = c.failedCount || 0;

                const sentPercent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

                return (
                  <div key={c.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-soft space-y-4 flex flex-col justify-between transition-all hover:border-slate-200">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                          c.status === 'READY' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                          c.status === 'SENDING' ? 'bg-indigo-100 text-indigo-800 animate-pulse border border-indigo-200' :
                          c.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                          c.status === 'PARTIALLY_COMPLETED' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                          c.status === 'FAILED' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                          c.status === 'CANCELLED' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {c.status}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-slate-800">{c.title}</h3>
                        <p className="text-xs font-bold text-indigo-600 mt-0.5">
                          {c.discountType === 'Percentage' ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`}
                        </p>
                        {c.description && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{c.description}</p>
                        )}
                      </div>

                      {/* DELIVERY PROGRESS BAR */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex justify-between text-[10px] font-semibold text-slate-500">
                          <span>Progress ({sent}/{total} sent)</span>
                          <span>{sentPercent}%</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
                          <div 
                            className={`h-full transition-all duration-500 ${c.status === 'SENDING' ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'}`}
                            style={{ width: `${sentPercent}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                          <span>Delivered: <strong className="text-emerald-700">{delivered}</strong></span>
                          <span>Read: <strong className="text-blue-700">{read}</strong></span>
                          <span>Failed: <strong className="text-rose-700">{failed}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      {/* VIEW REPORT BUTTON */}
                      <button
                        onClick={() => handleOpenReport(c)}
                        className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-600" />
                        <span>View Delivery Report</span>
                      </button>

                      {/* ACTIONS BASED ON STATUS */}
                      {c.status === 'READY' && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setConfirmSendCampaign(c)}
                            disabled={!isShopWhatsAppConnected}
                            className="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[11px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
                            title={!isShopWhatsAppConnected ? 'Connect WhatsApp in Settings to send via Cloud API' : 'Launch official Cloud API campaign'}
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Launch via API</span>
                          </button>
                          <button
                            onClick={() => handleOpenManualCampaign(c)}
                            disabled={loadingManualTargets}
                            className="py-2 px-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-[11px] rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Open WhatsApp</span>
                          </button>
                        </div>
                      )}

                      {c.status === 'SENDING' && (
                        <button
                          onClick={() => handleCancelSending(c.id)}
                          disabled={isCancelling}
                          className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          <span>Cancel Sending</span>
                        </button>
                      )}

                      {(c.status === 'COMPLETED' || c.status === 'PARTIALLY_COMPLETED' || c.status === 'FAILED') && failed > 0 && (
                        <button
                          onClick={() => handleRetryFailed(c.id)}
                          disabled={isRetrying}
                          className="w-full py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-xl border border-amber-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                          <span>Retry Failed Recipients ({failed})</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CAMPAIGN RECIPIENTS REPORT MODAL */}
      {selectedReportCampaign && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-4xl w-full border border-slate-100 shadow-2xl space-y-6 text-left font-sans max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-800">
                    Campaign Report: {selectedReportCampaign.title}
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                    {selectedReportCampaign.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Template: <strong className="text-slate-700">{selectedReportCampaign.templateName || 'quickr_offer_campaign'}</strong> • Discount: <strong className="text-indigo-600">{selectedReportCampaign.discountType === 'Percentage' ? `${selectedReportCampaign.discountValue}%` : `₹${selectedReportCampaign.discountValue}`}</strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedReportCampaign(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metrics Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-center">
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Targeted</span>
                <span className="text-base font-extrabold text-slate-800 mt-0.5 block">{selectedReportCampaign.totalRecipients || 0}</span>
              </div>
              <div className="bg-indigo-50/60 p-3 rounded-2xl border border-indigo-100">
                <span className="text-[10px] font-bold text-indigo-500 block uppercase">Queued</span>
                <span className="text-base font-extrabold text-indigo-700 mt-0.5 block">{selectedReportCampaign.queuedCount || 0}</span>
              </div>
              <div className="bg-blue-50/60 p-3 rounded-2xl border border-blue-100">
                <span className="text-[10px] font-bold text-blue-500 block uppercase">Sent</span>
                <span className="text-base font-extrabold text-blue-700 mt-0.5 block">{selectedReportCampaign.sentCount || 0}</span>
              </div>
              <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-600 block uppercase">Delivered</span>
                <span className="text-base font-extrabold text-emerald-700 mt-0.5 block">{selectedReportCampaign.deliveredCount || 0}</span>
              </div>
              <div className="bg-purple-50/60 p-3 rounded-2xl border border-purple-100">
                <span className="text-[10px] font-bold text-purple-600 block uppercase">Read</span>
                <span className="text-base font-extrabold text-purple-700 mt-0.5 block">{selectedReportCampaign.readCount || 0}</span>
              </div>
              <div className="bg-rose-50/60 p-3 rounded-2xl border border-rose-100">
                <span className="text-[10px] font-bold text-rose-500 block uppercase">Failed</span>
                <span className="text-base font-extrabold text-rose-700 mt-0.5 block">{selectedReportCampaign.failedCount || 0}</span>
              </div>
            </div>

            {/* Filter and Action Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-400 font-bold">Filter:</span>
                {['ALL', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED'].map(st => (
                  <button
                    key={st}
                    onClick={() => handleFilterReport(st)}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-colors cursor-pointer ${
                      reportFilter === st 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportCSV(selectedReportCampaign.id)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>

                {(selectedReportCampaign.failedCount || 0) > 0 && (
                  <button
                    onClick={() => handleRetryFailed(selectedReportCampaign.id)}
                    disabled={isRetrying}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    <span>Retry Failures</span>
                  </button>
                )}
              </div>
            </div>

            {/* Recipient Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search recipient by customer name or phone number..."
                value={reportSearch}
                onChange={e => handleSearchReport(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Recipient Table */}
            <div className="border border-slate-100 rounded-2xl overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 border-b border-slate-100">
                  <tr>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Sent At</th>
                    <th className="p-3">Details / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingReport ? (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-400">Loading recipient logs...</td></tr>
                  ) : reportRecipients.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-400">No recipients match this filter.</td></tr>
                  ) : (
                    reportRecipients.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="p-3 font-bold text-slate-800">{r.customerName || 'Customer'}</td>
                        <td className="p-3 font-mono text-slate-500">{r.phone}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            r.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' :
                            r.status === 'READ' ? 'bg-purple-100 text-purple-800' :
                            r.status === 'SENT' ? 'bg-blue-100 text-blue-800' :
                            r.status === 'QUEUED' ? 'bg-indigo-100 text-indigo-800' :
                            r.status === 'FAILED' ? 'bg-rose-100 text-rose-800' :
                            r.status === 'CANCELLED' ? 'bg-slate-200 text-slate-600' :
                            r.status === 'SKIPPED' ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 text-[11px]">
                          {r.sentAt ? new Date(r.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="p-3 text-[11px] text-slate-500">
                          {r.errorMessage ? (
                            <span className="text-rose-600 font-medium">{r.errorMessage}</span>
                          ) : r.status === 'DELIVERED' ? (
                            <span className="text-emerald-700">Delivered to phone</span>
                          ) : r.status === 'READ' ? (
                            <span className="text-purple-700 font-bold">Read by recipient</span>
                          ) : (
                            <span className="text-slate-400">{r.sendingMethod}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedReportCampaign(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM & LAUNCH VIA API MODAL */}
      {confirmSendCampaign && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full border border-slate-100 shadow-2xl space-y-5 text-left font-sans max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Launch WhatsApp Cloud Campaign?
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sends official WhatsApp template messages via your connected business account.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2 text-xs">
              <p><span className="text-slate-400">Campaign:</span> <strong className="text-slate-800">{confirmSendCampaign.title}</strong></p>
              <p><span className="text-slate-400">Target Audience:</span> <strong className="text-emerald-700">{confirmSendCampaign.eligibleCustomerCount || 0} Eligible Customers</strong></p>
              <p><span className="text-slate-400">Discount:</span> <strong className="text-indigo-600">{confirmSendCampaign.discountType === 'Percentage' ? `${confirmSendCampaign.discountValue}%` : `₹${confirmSendCampaign.discountValue}`} OFF</strong></p>
              <p><span className="text-slate-400">Template:</span> <strong className="text-slate-700 font-mono">{confirmSendCampaign.templateName || 'quickr_offer_campaign'}</strong></p>
              <p><span className="text-slate-400">Sender Number:</span> <strong className="text-slate-700">{providerStatus?.displayPhoneNumber || 'Connected WhatsApp Number'}</strong></p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmSendCampaign(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={sendingCampaignId === confirmSendCampaign.id}
                onClick={() => handleConfirmSend(confirmSendCampaign)}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingCampaignId === confirmSendCampaign.id ? 'Launching Queue...' : 'Confirm & Launch Campaign'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE OFFER MULTI-STEP WIZARD */}
      {viewMode === 'create' && (
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-100 shadow-soft space-y-6">
          {/* Progress Indicator */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 text-xs font-bold flex-wrap gap-2">
            <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
              {[
                { s: 1, label: '1. Offer Details' },
                { s: 2, label: '2. Customer Targeting' },
                { s: 3, label: '3. Message Template' },
                { s: 4, label: '4. Message Preview' },
                { s: 5, label: '5. Review & Launch' }
              ].map(item => (
                <span key={item.s} className={`flex items-center gap-1.5 ${step === item.s ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    step === item.s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {item.s}
                  </span>
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
            <button
              onClick={() => setViewMode('list')}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {/* STEP 1: OFFER DETAILS */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-4 max-w-2xl text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Offer Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Weekend Mega Sale 20% OFF"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Campaign Type *</label>
                  <select
                    value={campaignType}
                    onChange={e => setCampaignType(e.target.value as any)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                  >
                    <option value="discount_offer">Promotional Discount Offer</option>
                    <option value="festive_deal">Festive & Special Occasion Deal</option>
                    <option value="clearance">Clearance & End of Season Sale</option>
                    <option value="new_arrival">New Collection Arrival</option>
                    <option value="general_announcement">General Store Announcement</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Description (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Weekend special promotional offer for regular shoppers"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Discount Type *</label>
                    <select
                      value={discountType}
                      onChange={e => setDiscountType(e.target.value as any)}
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    >
                      <option value="Percentage">Percentage (%)</option>
                      <option value="Fixed Amount">Fixed Amount (₹)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Discount Value *</label>
                    <input
                      type="number"
                      placeholder="e.g. 20"
                      value={discountValue}
                      onChange={e => setDiscountValue(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Select Applicable Product(s)</label>
                  <select
                    multiple
                    value={selectedProductIds}
                    onChange={e => {
                      const opts = Array.from(e.target.selectedOptions, option => option.value);
                      setSelectedProductIds(opts);
                    }}
                    className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500 h-24"
                  >
                    {activeProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (₹{p.sellingPrice})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">Leave unselected to apply offer to all store products.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">End Date *</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100">
                <button
                  onClick={handleProceedToAudience}
                  disabled={loadingTargeting}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>{loadingTargeting ? 'Fetching Audience...' : 'Continue to Customer Targeting'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: CUSTOMER TARGETING */}
          {step === 2 && (
            <div className="space-y-6 text-xs font-sans">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-slate-700">Filter Segment:</span>
                  <select
                    value={filterType}
                    onChange={e => handleFilterChange(e.target.value)}
                    className="p-2 bg-white border border-slate-200 rounded-xl font-medium focus:outline-none focus:border-indigo-500"
                  >
                    <option value="all_eligible">All Eligible Customers</option>
                    <option value="product_buyers">Previous Buyers of Selected Products</option>
                    <option value="enquiry_customers">Customers with Past Enquiries</option>
                    <option value="followup_customers">Customers with Active Follow-ups</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllEligible}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    Select All Eligible ({eligibleCustomers.length})
                  </button>
                </div>
              </div>

              {/* Customer Search */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter customers by name or phone..."
                  value={audienceSearch}
                  onChange={e => setAudienceSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Eligible Customers Column */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      Eligible ({eligibleCustomers.length}) • Selected: {selectedCustIds.length}
                    </h4>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50">
                    {eligibleCustomers
                      .filter(c => !audienceSearch.trim() || c.name.toLowerCase().includes(audienceSearch.toLowerCase()) || c.phone.includes(audienceSearch))
                      .map(c => (
                        <label key={c.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100 cursor-pointer hover:bg-slate-50">
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={selectedCustIds.includes(c.id)}
                              onChange={() => toggleCustSelection(c.id)}
                              className="text-indigo-600 focus:ring-indigo-500 rounded w-4 h-4 cursor-pointer"
                            />
                            <div>
                              <span className="font-bold text-slate-800 block">{c.name}</span>
                              <span className="text-[10px] font-mono text-slate-400">{c.maskedPhone}</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                            Consent Verified
                          </span>
                        </label>
                      ))}
                    {eligibleCustomers.length === 0 && (
                      <p className="text-[11px] text-slate-400 py-6 text-center">No eligible customers found with marketing consent.</p>
                    )}
                  </div>
                </div>

                {/* Excluded Customers Column */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <X className="w-4 h-4 text-slate-400" />
                    Excluded / Opted-Out ({ineligibleCustomers.length})
                  </h4>
                  <div className="max-h-72 overflow-y-auto space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50 opacity-80">
                    {ineligibleCustomers.map(c => (
                      <div key={c.id} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-100">
                        <div>
                          <span className="font-bold text-slate-600 block">{c.name}</span>
                          <span className="text-[10px] text-slate-400">{c.reason}</span>
                        </div>
                        <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                          Excluded
                        </span>
                      </div>
                    ))}
                    {ineligibleCustomers.length === 0 && (
                      <p className="text-[11px] text-slate-400 py-6 text-center">No customers excluded.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  onClick={() => setStep(1)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={selectedCustIds.length === 0}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <span>Continue to Template ({selectedCustIds.length})</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: TEMPLATE SELECTION */}
          {step === 3 && (
            <div className="space-y-6 text-xs font-sans">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Select Approved WhatsApp Message Template</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Meta WhatsApp Cloud API requires using approved templates for unsolicited marketing campaigns outside the 24h service window.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map(tpl => {
                  const isSelected = selectedTemplateName === tpl.name;
                  return (
                    <div
                      key={tpl.name}
                      onClick={() => setSelectedTemplateName(tpl.name)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-2 ${
                        isSelected 
                          ? 'border-indigo-600 bg-indigo-50/40 shadow-xs ring-2 ring-indigo-200' 
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 text-xs">{tpl.title}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                          {tpl.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{tpl.description}</p>
                      <div className="p-3 bg-slate-50 rounded-xl font-mono text-[10px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {tpl.sampleText}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  onClick={() => setStep(2)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>Continue to Message Preview</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: MESSAGE PREVIEW */}
          {step === 4 && (
            <div className="space-y-6 text-xs font-sans">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Summary Info */}
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                  <h4 className="font-bold text-slate-800 uppercase tracking-wider">Campaign Overview</h4>
                  <div className="space-y-2.5">
                    <p><span className="text-slate-400">Offer Title:</span> <strong className="text-slate-800">{title}</strong></p>
                    <p><span className="text-slate-400">Type:</span> <strong className="text-slate-700 uppercase">{campaignType.replace(/_/g, ' ')}</strong></p>
                    <p><span className="text-slate-400">Discount:</span> <strong className="text-indigo-600">{discountFormatted} OFF</strong></p>
                    <p><span className="text-slate-400">Products:</span> <span className="text-slate-700">{selectedProductsNames}</span></p>
                    <p><span className="text-slate-400">Validity:</span> <span className="text-slate-700">{startDate} to {endDate}</span></p>
                    <p><span className="text-slate-400">Selected Recipients:</span> <strong className="text-emerald-700">{selectedCustIds.length} Verified Customers</strong></p>
                    <p><span className="text-slate-400">Template Name:</span> <span className="font-mono text-slate-700 font-bold">{selectedTemplateName}</span></p>
                  </div>
                </div>

                {/* WhatsApp Chat Bubble Preview */}
                <div className="bg-emerald-950 p-6 rounded-3xl text-emerald-100 space-y-3 shadow-xl border border-emerald-800 font-sans text-xs">
                  <div className="flex items-center justify-between text-[10px] text-emerald-400 font-bold border-b border-emerald-800/80 pb-2 uppercase tracking-wider">
                    <span>WHATSAPP LIVE PREVIEW</span>
                    <span>OFFICIAL TEMPLATE</span>
                  </div>

                  <div className="bg-emerald-900/90 rounded-2xl p-4 space-y-2 border border-emerald-700/50 shadow-inner">
                    <p className="whitespace-pre-wrap leading-relaxed text-slate-100 text-[11px]">
                      {currentTemplate?.sampleText
                        ? currentTemplate.sampleText
                            .replace(/\{\{ShopName\}\}/g, shopName || 'QuickR Shop')
                            .replace(/\{\{CustomerName\}\}/g, 'Ravi Kumar')
                            .replace(/\{\{DiscountValue\}\}/g, discountFormatted)
                            .replace(/\{\{ProductName\}\}/g, selectedProductsNames)
                            .replace(/\{\{Occasion\}\}/g, title)
                            .replace(/\{\{CollectionName\}\}/g, selectedProductsNames)
                            .replace(/\{\{StartDate\}\}/g, startDate)
                            .replace(/\{\{EndDate\}\}/g, endDate)
                        : 'Preview Text'}
                    </p>
                    <div className="text-right text-[9px] text-emerald-400/80 font-mono">
                      10:30 AM • WhatsApp Business
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-100">
                <button
                  onClick={() => setStep(3)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(5)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>Review & Launch</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & LAUNCH */}
          {step === 5 && (
            <div className="space-y-6 text-xs font-sans">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider">Campaign Pre-Launch Checklist</h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 block text-[10px]">Audience Size</span>
                    <strong className="text-sm text-slate-800 font-extrabold">{selectedCustIds.length} Customers</strong>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 block text-[10px]">Marketing Consent</span>
                    <strong className="text-sm text-emerald-700 font-extrabold flex items-center gap-1">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      100% Opted-In
                    </strong>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 block text-[10px]">QuickR Platform Cost</span>
                    <strong className="text-sm text-indigo-700 font-extrabold">₹0 (Zero Charges)</strong>
                  </div>
                </div>

                {!isShopWhatsAppConnected ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 space-y-2">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Shop WhatsApp is not connected</span>
                    </div>
                    <p className="text-[11px] text-amber-700">
                      You can save this campaign as <strong>READY</strong> or <strong>DRAFT</strong> right now. To dispatch messages automatically via Meta Cloud API, connect your official number in Settings.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold">
                      Connected to <strong>{providerStatus.businessName}</strong> ({providerStatus.displayPhoneNumber}). Ready to launch immediately.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setStep(4)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Back
                </button>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    disabled={submittingCampaign}
                    onClick={() => handleSaveCampaign('DRAFT')}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                  >
                    Save as Draft
                  </button>

                  <button
                    disabled={submittingCampaign}
                    onClick={() => handleSaveCampaign('READY')}
                    className="flex-1 sm:flex-none px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
                  >
                    Mark as READY
                  </button>

                  <button
                    disabled={submittingCampaign || !isShopWhatsAppConnected}
                    onClick={() => handleSaveCampaign('READY')}
                    className="flex-1 sm:flex-none px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    title={!isShopWhatsAppConnected ? 'Connect WhatsApp in Settings to launch' : 'Launch campaign'}
                  >
                    <Send className="w-4 h-4" />
                    <span>Launch Campaign Now</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MANUAL WHATSAPP MODAL FALLBACK */}
      {manualModalCampaign && manualTargets.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-xl w-full border border-slate-100 shadow-2xl space-y-5 text-left font-sans max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <ExternalLink className="w-5 h-5 text-emerald-600" />
                  Manual WhatsApp Dispatch ({manualIndex + 1}/{manualTargets.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Send personalized WhatsApp offers directly using your browser or WhatsApp Desktop.
                </p>
              </div>
              <button
                onClick={() => setManualModalCampaign(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const target = manualTargets[manualIndex];
              if (!target) return null;

              return (
                <div className="space-y-4 text-xs font-sans">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase">Customer</span>
                      <strong className="text-sm text-slate-800 font-bold">{target.name}</strong>
                      <span className="text-xs font-mono text-slate-500 block">{target.phone}</span>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                      target.status === 'MANUAL_SENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {target.status}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-600">
                      <span>Message Preview:</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(target.personalizedMessage);
                          setCopiedMessage(true);
                          setTimeout(() => setCopiedMessage(false), 2000);
                        }}
                        className="text-indigo-600 hover:underline flex items-center gap-1 font-bold text-[11px] cursor-pointer"
                      >
                        {copiedMessage ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedMessage ? 'Copied!' : 'Copy Text'}</span>
                      </button>
                    </div>
                    <div className="bg-emerald-950 p-4 rounded-2xl text-emerald-100 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {target.personalizedMessage}
                    </div>
                  </div>

                  {manualNotice && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{manualNotice}</span>
                    </div>
                  )}

                  <div className="space-y-2.5 pt-2">
                    <button
                      onClick={() => handleOpenWhatsAppLink(target.waDeepLink)}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>1. Open WhatsApp for {target.name}</span>
                    </button>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={handleMarkManualSent}
                        className="py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        <span>Mark Sent & Next</span>
                      </button>

                      <button
                        onClick={() => setSkipConfirmTarget(target)}
                        className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <SkipForward className="w-4 h-4 text-slate-500" />
                        <span>Skip</span>
                      </button>

                      <button
                        onClick={() => {
                          setResponseModalCampaign(manualModalCampaign);
                          setResponseTargetCustomer(target);
                          setSelectedResponseType('INTERESTED');
                        }}
                        className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Responded</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* SKIP CUSTOMER MODAL */}
      {skipConfirmTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-100 shadow-2xl space-y-4 text-center font-sans">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
              <SkipForward className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Skip Customer?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Skip <strong>{skipConfirmTarget.name}</strong> from this campaign?
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setSkipConfirmTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSkipCustomer(skipConfirmTarget)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER RESPONSE MODAL */}
      {responseModalCampaign && responseTargetCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full border border-slate-100 shadow-2xl space-y-5 text-left font-sans max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-indigo-600" />
                  Record Customer Response
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Customer: <strong className="text-slate-700">{responseTargetCustomer.name}</strong>
                </p>
              </div>
              <button
                onClick={() => { setResponseModalCampaign(null); setResponseTargetCustomer(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-sans">
              <label className="block font-bold text-slate-700 mb-2">Outcome / Intent</label>
              <div className="space-y-2">
                {[
                  { id: 'INTERESTED', label: 'Interested (Creates Enquiry)', icon: CheckCircle },
                  { id: 'MORE_INFORMATION', label: 'Wants More Information (Creates Follow-up)', icon: MessageSquare },
                  { id: 'VISIT_SHOP', label: 'Wants to Visit Shop (High-Priority Follow-up)', icon: Calendar },
                  { id: 'NOT_INTERESTED', label: 'Not Interested', icon: X },
                  { id: 'PURCHASED', label: 'Purchased (Opens Billing Flow)', icon: ShoppingCart },
                  { id: 'NO_RESPONSE', label: 'No Response', icon: Clock }
                ].map(item => (
                  <label key={item.id} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedResponseType === item.id ? 'bg-indigo-50/70 border-indigo-500 font-bold text-indigo-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="responseType"
                        value={item.id}
                        checked={selectedResponseType === item.id}
                        onChange={() => setSelectedResponseType(item.id)}
                        className="text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      <span>{item.label}</span>
                    </div>
                    <item.icon className={`w-4 h-4 ${selectedResponseType === item.id ? 'text-indigo-600' : 'text-slate-400'}`} />
                  </label>
                ))}
              </div>

              {['MORE_INFORMATION', 'VISIT_SHOP'].includes(selectedResponseType) && (
                <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <label className="block font-bold text-slate-700">Scheduled Follow-up Date</label>
                  <input
                    type="date"
                    value={scheduledFollowUpDate}
                    onChange={e => setScheduledFollowUpDate(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Customer interested in cotton shirt collection"
                  value={responseNotes}
                  onChange={e => setResponseNotes(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setResponseModalCampaign(null); setResponseTargetCustomer(null); }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={submittingResponse}
                onClick={handleRecordCustomerResponse}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{submittingResponse ? 'Saving...' : (selectedResponseType === 'PURCHASED' ? 'Continue to Billing' : 'Save Response')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
