import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';
import { Store, Languages, Copy, Check, Loader2, ArrowRightLeft, Edit2, Save, X, Phone, ShieldCheck, ChevronRight } from 'lucide-react';
import { api } from '../services/api';

interface SettingsProps {
  setCurrentPage?: (page: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({ setCurrentPage }) => {
  const { updateShopProfile } = useApp();
  const { language, setLanguage, t } = useLanguage();

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
      if (direction === 'en-to-ta') {
        const lower = textToTranslate.toLowerCase();
        let result = textToTranslate;
        
        const dictionary: Record<string, string> = {
          'hello': 'வணக்கம்',
          'welcome': 'நல்வரவு',
          'thank you': 'நன்றி',
          'good morning': 'காலை வணக்கம்',
          'good evening': 'மாலை வணக்கம்',
          'how are you': 'எப்படி இருக்கிறீர்கள்',
          'price': 'விலை',
          'discount': 'தள்ளுபடி',
          'total': 'மொத்தம்',
          'available': 'இருப்பில் உள்ளது',
          'stock': 'இருப்பு',
          'order': 'ஆர்டர்',
          'customer': 'வாடிக்கையாளர்'
        };

        if (dictionary[lower]) {
          result = dictionary[lower];
        } else {
          result = `[தமிழ்] ${textToTranslate}`;
        }
        setTranslatedText(result);
      } else {
        const dictionary: Record<string, string> = {
          'வணக்கம்': 'Hello',
          'நன்றி': 'Thank you',
          'காலை வணக்கம்': 'Good morning',
          'விலை': 'Price',
          'தள்ளுபடி': 'Discount',
          'மொத்தம்': 'Total',
          'ஆர்டர்': 'Order'
        };

        let result = textToTranslate;
        if (dictionary[textToTranslate.trim()]) {
          result = dictionary[textToTranslate.trim()];
        } else {
          result = textToTranslate.replace(/^\[தமிழ்\]\s*/i, '');
        }
        setTranslatedText(result);
      }
    } catch (err: any) {
      setErrorMessage('Unable to translate right now. Please try again.');
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
              <button
                onClick={() => {
                  const event = new CustomEvent('trigger-pwa-install');
                  window.dispatchEvent(event);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
              >
                <span>Install QuickR App</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
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
