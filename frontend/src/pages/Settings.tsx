import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';
import { Store, Languages, Copy, Check, Loader2, ArrowRightLeft, Edit2, Save, X, Phone, ShieldCheck, ChevronRight, Barcode, MessageCircle, AlertCircle, HelpCircle, LogOut } from 'lucide-react';
import { api } from '../services/api';

interface SettingsProps {
  setCurrentPage?: (page: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({ setCurrentPage }) => {
  const { updateShopProfile, triggerPwaInstall } = useApp();
  const { language, setLanguage, t } = useLanguage();

  const [barcodeScanningEnabled, setBarcodeScanningEnabled] = useState<boolean>(() => {
    return localStorage.getItem('quickr_barcode_scanning_enabled') === 'true';
  });

  // WhatsApp Business Connection State
  const [waStatus, setWaStatus] = useState<{
    connected: boolean;
    status: string;
    businessName: string;
    displayPhoneNumber: string;
    connectedAt?: string;
    metaAppConfigured?: boolean;
  }>({
    connected: false,
    status: 'NOT_CONNECTED',
    businessName: '',
    displayPhoneNumber: ''
  });
  const [loadingWaStatus, setLoadingWaStatus] = useState(true);
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [isDisconnectingWa, setIsDisconnectingWa] = useState(false);
  const [waSuccessMsg, setWaSuccessMsg] = useState<string | null>(null);
  const [waErrMsg, setWaErrMsg] = useState<string | null>(null);
  const [waConfigRequired, setWaConfigRequired] = useState(false);
  const [showWaInstructions, setShowWaInstructions] = useState(false);

  // Translation State
  const [direction, setDirection] = useState<'en-to-ta' | 'ta-to-en'>('en-to-ta');
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Real Shop Profile State
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [shopNameInput, setShopNameInput] = useState('');
  const [contactPhoneInput, setContactPhoneInput] = useState('');
  const [isGstRegisteredInput, setIsGstRegisteredInput] = useState<boolean>(false);
  const [gstinInput, setGstinInput] = useState('');
  const [legalNameInput, setLegalNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [stateInput, setStateInput] = useState('Tamil Nadu');
  const [stateCodeInput, setStateCodeInput] = useState('33');
  const [defaultRateInput, setDefaultRateInput] = useState<number>(0);

  const [originalShopName, setOriginalShopName] = useState('');
  const [originalContactPhone, setOriginalContactPhone] = useState('');
  const [originalIsGstRegistered, setOriginalIsGstRegistered] = useState<boolean>(false);
  const [originalGstin, setOriginalGstin] = useState('');
  const [originalLegalName, setOriginalLegalName] = useState('');
  const [originalAddress, setOriginalAddress] = useState('');
  const [originalState, setOriginalState] = useState('Tamil Nadu');
  const [originalStateCode, setOriginalStateCode] = useState('33');
  const [originalDefaultRate, setOriginalDefaultRate] = useState<number>(0);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrMsg, setProfileErrMsg] = useState<string | null>(null);

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

  useEffect(() => {
    loadProfile();
    loadWhatsAppStatus();
    checkUrlCallbackParams();
  }, []);

  const checkUrlCallbackParams = () => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('whatsapp_status');
    const msg = params.get('msg');

    if (status === 'connected') {
      setWaSuccessMsg('WhatsApp Business connected successfully!');
      setTimeout(() => setWaSuccessMsg(null), 6000);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (status === 'failed') {
      setWaErrMsg(msg || 'We couldn\'t connect WhatsApp Business. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const loadWhatsAppStatus = async () => {
    setLoadingWaStatus(true);
    try {
      const data = await api.getWhatsAppConnectionStatus();
      setWaStatus({
        connected: data.connected,
        status: data.status || (data.connected ? 'CONNECTED' : 'NOT_CONNECTED'),
        businessName: data.businessName || '',
        displayPhoneNumber: data.displayPhoneNumber || '',
        connectedAt: data.connectedAt,
        metaAppConfigured: data.metaAppConfigured
      });
    } catch (err: any) {
      console.error('Failed to load WhatsApp status:', err);
    } finally {
      setLoadingWaStatus(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setIsConnectingWa(true);
    setWaErrMsg(null);
    setWaSuccessMsg(null);
    setWaConfigRequired(false);

    try {
      const res = await api.connectWhatsApp();

      if (res.authUrl) {
        // Redirect to official Meta OAuth onboarding page
        window.location.href = res.authUrl;
        return;
      }

      if (res.metaConfigRequired || res.error) {
        setWaErrMsg(res.error || 'Meta credentials are not configured on the server.');
        setWaConfigRequired(!!res.metaConfigRequired);
      }
    } catch (err: any) {
      setWaErrMsg(err.message || 'We couldn\'t connect WhatsApp Business. Please try again.');
    } finally {
      setIsConnectingWa(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    setIsDisconnectingWa(true);
    setWaErrMsg(null);
    setWaSuccessMsg(null);

    try {
      const res = await api.disconnectWhatsApp();
      if (res.success) {
        setWaStatus({
          connected: false,
          status: 'NOT_CONNECTED',
          businessName: '',
          displayPhoneNumber: ''
        });
        setWaSuccessMsg('WhatsApp Business disconnected.');
        setTimeout(() => setWaSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setWaErrMsg(err.message || 'Failed to disconnect WhatsApp Business.');
    } finally {
      setIsDisconnectingWa(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleStateChange = (stName: string) => {
    setStateInput(stName);
    const match = INDIAN_STATES.find(s => s.name === stName);
    if (match) {
      setStateCodeInput(match.code);
    }
  };

  const loadProfile = async () => {
    setLoadingProfile(true);
    try {
      const data = await api.getShopProfile();
      const gstData = data.gst || {};

      setShopNameInput(data.name || '');
      setContactPhoneInput(data.phone || '');
      setIsGstRegisteredInput(gstData.registered !== undefined ? !!gstData.registered : !!data.isGstRegistered);
      setGstinInput(gstData.gstin || data.gstin || '');
      setLegalNameInput(gstData.legalName || data.name || '');
      setAddressInput(gstData.address || data.address || '');
      setStateInput(gstData.state || 'Tamil Nadu');
      setStateCodeInput(gstData.stateCode || '33');
      setDefaultRateInput(gstData.defaultRate || 0);

      setOriginalShopName(data.name || '');
      setOriginalContactPhone(data.phone || '');
      setOriginalIsGstRegistered(gstData.registered !== undefined ? !!gstData.registered : !!data.isGstRegistered);
      setOriginalGstin(gstData.gstin || data.gstin || '');
      setOriginalLegalName(gstData.legalName || data.name || '');
      setOriginalAddress(gstData.address || data.address || '');
      setOriginalState(gstData.state || 'Tamil Nadu');
      setOriginalStateCode(gstData.stateCode || '33');
      setOriginalDefaultRate(gstData.defaultRate || 0);
    } catch (err: any) {
      console.error('Failed to load shop profile:', err);
      setProfileErrMsg(err.message || 'Unable to load shop profile. Please try again.');
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccessMsg(null);
    setProfileErrMsg(null);

    if (!shopNameInput.trim()) {
      setProfileErrMsg('Shop name cannot be empty.');
      return;
    }

    if (!contactPhoneInput.trim()) {
      setProfileErrMsg('Contact phone number is required.');
      return;
    }

    if (isGstRegisteredInput) {
      const cleanGstin = gstinInput.trim().toUpperCase();
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
      if (!cleanGstin || !gstinRegex.test(cleanGstin)) {
        setProfileErrMsg('Please enter a valid 15-character GSTIN format (e.g. 33AAAAA0000A1Z5).');
        return;
      }
    }

    setSavingProfile(true);
    try {
      await updateShopProfile({
        name: shopNameInput.trim(),
        phone: contactPhoneInput.trim(),
        isGstRegistered: isGstRegisteredInput,
        gstin: isGstRegisteredInput ? gstinInput.trim().toUpperCase() : '',
        legalName: legalNameInput.trim() || shopNameInput.trim(),
        address: addressInput.trim(),
        state: stateInput,
        stateCode: stateCodeInput,
        defaultRate: Number(defaultRateInput) || 0
      });

      setOriginalShopName(shopNameInput.trim());
      setOriginalContactPhone(contactPhoneInput.trim());
      setOriginalIsGstRegistered(isGstRegisteredInput);
      setOriginalGstin(isGstRegisteredInput ? gstinInput.trim().toUpperCase() : '');
      setOriginalLegalName(legalNameInput.trim() || shopNameInput.trim());
      setOriginalAddress(addressInput.trim());
      setOriginalState(stateInput);
      setOriginalStateCode(stateCodeInput);
      setOriginalDefaultRate(Number(defaultRateInput) || 0);

      setIsEditingProfile(false);
      setProfileSuccessMsg('Shop profile updated successfully.');
      setTimeout(() => setProfileSuccessMsg(null), 4000);
    } catch (err: any) {
      setProfileErrMsg(err.message || 'Failed to update shop profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCancelProfileEdit = () => {
    setShopNameInput(originalShopName);
    setContactPhoneInput(originalContactPhone);
    setIsGstRegisteredInput(originalIsGstRegistered);
    setGstinInput(originalGstin);
    setIsEditingProfile(false);
    setProfileErrMsg(null);
  };

  const handleTranslate = async () => {
    const textToTranslate = inputText.trim();
    if (!textToTranslate) return;

    setIsTranslating(true);
    setErrorMessage(null);
    setTranslatedText('');

    try {
      const res = await api.translateText({ text: textToTranslate, direction });
      if (res.success && res.translatedText) {
        setTranslatedText(res.translatedText);
      } else {
        setErrorMessage(res.error || 'Unable to translate right now. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to translate right now. Please check network connection.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = () => {
    if (!translatedText) return;
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-grow p-4 sm:p-8 space-y-6 overflow-y-auto max-w-7xl mx-auto w-full font-sans animate-fadeIn">
      <div>
        <h2 className="text-xl font-bold text-slate-800">{t('nav.settings')}</h2>
        <p className="text-xs text-slate-400">Manage your authenticated shop profile and language preferences</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-100 shadow-soft max-w-2xl space-y-6">
        {/* Real Shop Profile Section */}
        <div className="flex items-start gap-4 pb-6 border-b border-slate-100">
          <Store className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-4 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Shop Profile</h3>
                <p className="text-xs text-slate-400">Your official store identity used across QuickR & WhatsApp messaging</p>
              </div>
              {!isEditingProfile && (
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-primary-50 text-slate-700 hover:text-primary-600 text-xs font-bold rounded-xl transition-all border border-slate-200"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit Profile
                </button>
              )}
            </div>

            {profileSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl">
                {profileSuccessMsg}
              </div>
            )}

            {profileErrMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold rounded-xl">
                {profileErrMsg}
              </div>
            )}

            {loadingProfile ? (
              <div className="py-4 text-center text-xs text-slate-400 font-semibold flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary-600" /> Loading shop profile...
              </div>
            ) : isEditingProfile ? (
              <form onSubmit={handleSaveProfile} className="space-y-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Shop Name *</label>
                    <input
                      type="text"
                      required
                      value={shopNameInput}
                      onChange={e => setShopNameInput(e.target.value)}
                      placeholder="Sidd Clothes"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone *</label>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={contactPhoneInput}
                        onChange={e => setContactPhoneInput(e.target.value)}
                        placeholder="9876543210"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-8 pr-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-bold text-slate-800">GST Registered?</label>
                      <p className="text-[11px] text-slate-500">Enable if your shop collects GST on sales</p>
                    </div>
                    <div className="flex bg-slate-200 p-0.5 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setIsGstRegisteredInput(true)}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${isGstRegisteredInput ? 'bg-primary-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsGstRegisteredInput(false)}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${!isGstRegisteredInput ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        No
                      </button>
                    </div>
                  </div>

                  {isGstRegisteredInput && (
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">GSTIN *</label>
                        <input
                          type="text"
                          value={gstinInput}
                          onChange={e => setGstinInput(e.target.value.toUpperCase())}
                          placeholder="e.g. 33AAAAA0000A1Z5"
                          maxLength={15}
                          className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-primary-500 transition-all uppercase tracking-wider"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">15-character GSTIN format (e.g. 33AAAAA0000A1Z5)</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">Legal Business Name</label>
                          <input
                            type="text"
                            value={legalNameInput}
                            onChange={e => setLegalNameInput(e.target.value)}
                            placeholder="e.g. Sidd Clothing Pvt Ltd"
                            className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-primary-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">Default GST Rate</label>
                          <select
                            value={defaultRateInput}
                            onChange={e => setDefaultRateInput(Number(e.target.value))}
                            className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs font-bold text-slate-800 focus:outline-none focus:border-primary-500 transition-all"
                          >
                            <option value={0}>0% (Exempt)</option>
                            <option value={5}>5% (Standard Apparel)</option>
                            <option value={12}>12% (Apparel & Textiles)</option>
                            <option value={18}>18% (Standard Rate)</option>
                            <option value={28}>28% (Luxury Items)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Business Address</label>
                        <input
                          type="text"
                          value={addressInput}
                          onChange={e => setAddressInput(e.target.value)}
                          placeholder="e.g. 123 Main Street, T. Nagar, Chennai"
                          className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-primary-500 transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">State</label>
                          <select
                            value={stateInput}
                            onChange={e => handleStateChange(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-xl py-2 px-3 text-xs font-bold text-slate-800 focus:outline-none focus:border-primary-500 transition-all"
                          >
                            {INDIAN_STATES.map(st => (
                              <option key={st.code} value={st.name}>{st.name} ({st.code})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">State Code</label>
                          <input
                            type="text"
                            readOnly
                            value={stateCodeInput}
                            className="w-full bg-slate-100 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-bold text-slate-600 focus:outline-none cursor-not-allowed"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors disabled:opacity-50"
                  >
                    {savingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {savingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelProfileEdit}
                    className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Shop Name</label>
                  <p className="text-sm font-bold text-slate-800">{originalShopName || '—'}</p>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Contact Phone</label>
                  <p className="text-sm font-mono font-bold text-slate-700">{originalContactPhone || '—'}</p>
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-slate-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">GST Status</label>
                      <p className="text-xs font-bold text-slate-700">
                        {originalIsGstRegistered ? (
                          <span className="text-emerald-600 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> GST Registered
                          </span>
                        ) : (
                          <span className="text-slate-500">Not GST Registered (Standard Billing)</span>
                        )}
                      </p>
                    </div>
                    {originalIsGstRegistered && (
                      <div className="text-right">
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">GSTIN</label>
                        <p className="text-xs font-mono font-bold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200 inline-block">{originalGstin || '—'}</p>
                      </div>
                    )}
                  </div>

                  {originalIsGstRegistered && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 text-xs">
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Legal Name</span>
                        <span className="font-semibold text-slate-700">{originalLegalName || '—'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">State (Code)</span>
                        <span className="font-semibold text-slate-700">{originalState} ({originalStateCode})</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Address</span>
                        <span className="font-semibold text-slate-700 truncate block">{originalAddress || '—'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400 font-bold uppercase">Default Rate</span>
                        <span className="font-bold text-indigo-600">{originalDefaultRate}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Language & Translation Section */}
        <div className="flex items-start gap-3 sm:gap-4">
          <Languages className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-4 min-w-0">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Language & Translation</h3>
              <p className="text-xs text-slate-400">Translate messages between English and Tamil.</p>
            </div>

            {/* Interface Language Preference */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
              <label className="block text-xs font-bold text-slate-700">Interface Language</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLanguage('en')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${language === 'en' ? 'bg-primary-600 text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                  English
                </button>
                <button
                  onClick={() => setLanguage('ta')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${language === 'ta' ? 'bg-primary-600 text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                  தமிழ் (Tamil)
                </button>
              </div>
            </div>

            {/* Translator Tool */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">Translation Direction</label>
                <button
                  onClick={() => {
                    setDirection(prev => prev === 'en-to-ta' ? 'ta-to-en' : 'en-to-ta');
                    setInputText('');
                    setTranslatedText('');
                  }}
                  className="text-xs font-bold text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Switch
                </button>
              </div>

              {/* Direction Selector */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDirection('en-to-ta')}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${direction === 'en-to-ta' ? 'bg-primary-50 text-primary-700 border-primary-200 shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                >
                  English → Tamil
                </button>
                <button
                  onClick={() => setDirection('ta-to-en')}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${direction === 'ta-to-en' ? 'bg-primary-50 text-primary-700 border-primary-200 shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                >
                  Tamil → English
                </button>
              </div>

              {/* Text Input */}
              <div>
                <textarea
                  rows={3}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={direction === 'en-to-ta' ? 'Enter English text...' : 'Enter Tamil text...'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-medium text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all resize-none"
                />
              </div>

              {/* Translate Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleTranslate}
                  disabled={isTranslating || !inputText.trim()}
                  className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    'Translate'
                  )}
                </button>
              </div>

              {/* Error Message */}
              {errorMessage && (
                <div className="p-3 bg-danger-50 border border-danger-100 rounded-xl text-xs font-semibold text-danger-600">
                  {errorMessage}
                </div>
              )}

              {/* Translated Result Box */}
              {translatedText && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Translated Text</span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs font-semibold text-slate-800 whitespace-pre-wrap select-all">
                    {translatedText}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Product Barcode Scanning Setting */}
        <div className="flex items-start gap-4 pt-6 border-t border-slate-100">
          <Barcode className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Product Barcode Scanning</h3>
                <p className="text-xs text-slate-400">Enable camera scanning and USB/Bluetooth hardware barcode scanner during billing</p>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('quickr_barcode_scanning_enabled', 'true');
                    setBarcodeScanningEnabled(true);
                  }}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${barcodeScanningEnabled ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('quickr_barcode_scanning_enabled', 'false');
                    setBarcodeScanningEnabled(false);
                  }}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${!barcodeScanningEnabled ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  OFF
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-medium">
              {barcodeScanningEnabled 
                ? '📷 Barcode scanning is ACTIVE on Billing. You can scan products with camera or USB/Bluetooth barcode scanner.'
                : '🔒 Barcode scanning is OFF on Billing. Normal product search continues working as usual.'}
            </p>
          </div>
        </div>

        {/* WhatsApp Business Connection Section */}
        <div className="flex items-start gap-4 pt-6 border-t border-slate-100">
          <MessageCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-4 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">WhatsApp Business</h3>
                <p className="text-xs text-slate-400">Connect your business WhatsApp to send customer offers and campaigns from QuickR.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowWaInstructions(prev => !prev)}
                className="text-xs font-bold text-primary-600 hover:text-primary-700 flex items-center gap-1 bg-primary-50 px-2.5 py-1 rounded-lg border border-primary-100 transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {showWaInstructions ? 'Hide setup instructions' : 'How to connect?'}
              </button>
            </div>

            {/* Instruction Accordion */}
            {showWaInstructions && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2.5 animate-fadeIn">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-emerald-600" />
                  Official Meta WhatsApp Business Setup Instructions
                </h4>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-600 font-medium pl-1">
                  <li>Tap <strong>"Connect WhatsApp"</strong> below.</li>
                  <li>Sign in to Meta (Facebook) when prompted.</li>
                  <li>Select or create your Meta Business Account.</li>
                  <li>Select your WhatsApp Business account.</li>
                  <li>Select and verify your official business phone number.</li>
                  <li>Approve permissions for QuickR.</li>
                  <li>Return to QuickR — your status will automatically update to <strong>Connected</strong>.</li>
                </ol>
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-lg font-medium flex items-center gap-2 mt-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span><strong>Important:</strong> WhatsApp connection is completely optional. QuickR billing, barcode scanning, and inventory work normally without WhatsApp.</span>
                </div>
              </div>
            )}

            {/* Success / Error Banners */}
            {waSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{waSuccessMsg}</span>
              </div>
            )}

            {waErrMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{waErrMsg}</span>
                </div>
                {waConfigRequired && (
                  <p className="text-[11px] text-rose-600 pl-6">
                    Administrators need to add <code className="bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-mono">META_APP_ID</code> and <code className="bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-mono">META_APP_SECRET</code> to server environment variables on Render.
                  </p>
                )}
              </div>
            )}

            {/* Connection Status Card */}
            {loadingWaStatus ? (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-400 font-semibold flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>Checking WhatsApp connection status...</span>
              </div>
            ) : waStatus.connected ? (
              /* CONNECTED STATE */
              <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-xs font-extrabold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                      <Check className="w-4 h-4 text-emerald-600" /> Connected
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">
                    Connected: {waStatus.connectedAt ? new Date(waStatus.connectedAt).toLocaleDateString() : 'Active'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3.5 rounded-xl border border-emerald-100">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Business</label>
                    <p className="text-xs font-bold text-slate-800">{waStatus.businessName || 'WhatsApp Business'}</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Number</label>
                    <p className="text-xs font-mono font-bold text-slate-800">{waStatus.displayPhoneNumber || '—'}</p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 font-medium">
                  Your WhatsApp Business account is ready to be used with QuickR campaigns.
                </p>

                <div className="pt-2 border-t border-emerald-200/60 flex justify-end">
                  <button
                    type="button"
                    onClick={handleDisconnectWhatsApp}
                    disabled={isDisconnectingWa}
                    className="px-4 py-2 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isDisconnectingWa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                    {isDisconnectingWa ? 'Disconnecting...' : 'Disconnect WhatsApp'}
                  </button>
                </div>
              </div>
            ) : (
              /* NOT CONNECTED STATE */
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Status: {waStatus.status === 'CONNECTING' ? 'Connecting...' : waStatus.status === 'FAILED' ? 'Connection Failed' : 'Not connected'}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 font-medium">
                  Connect your business WhatsApp to use WhatsApp campaigns in QuickR.
                </p>

                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleConnectWhatsApp}
                    disabled={isConnectingWa}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2"
                  >
                    {isConnectingWa ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                    {isConnectingWa ? 'Initializing Meta Authorization...' : 'Connect WhatsApp'}
                  </button>

                  <span className="text-[11px] text-slate-400 font-medium">
                    Uses Meta Official Business Authorization Flow
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Privacy & Data Protection Card */}
        <div className="flex items-start gap-4 pt-6 border-t border-slate-100">
          <ShieldCheck className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3 min-w-0">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Privacy & Data Controls</h3>
              <p className="text-xs text-slate-400">Manage consent preferences, download personal data JSON, and submit privacy requests</p>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                onClick={() => setCurrentPage && setCurrentPage('privacy')}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
              >
                <span>Open Privacy Dashboard</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCurrentPage && setCurrentPage('privacy-notice')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
              >
                Privacy Notice
              </button>
            </div>
          </div>
        </div>

        {/* App & Device Installation Section */}
        <div className="flex items-start gap-4 pt-6 border-t border-slate-100">
          <Store className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3 min-w-0">
            <div>
              <h3 className="text-sm font-bold text-slate-800">QuickR Mobile & Desktop App</h3>
              <p className="text-xs text-slate-400">Install QuickR directly on your phone or computer for fast, standalone access</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) ? (
                <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-xs rounded-xl flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>QuickR is already installed</span>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    if (triggerPwaInstall) {
                      await triggerPwaInstall();
                    }
                    const event = new CustomEvent('trigger-pwa-install');
                    window.dispatchEvent(event);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                >
                  <span>Install QuickR App</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl">
                Supported on Chrome, Edge & Safari
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
