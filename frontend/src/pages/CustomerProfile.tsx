import React, { useState, useEffect, useMemo } from 'react';
import { formatDateTimeIST, formatDateIST, formatTimeIST } from '../utils/date';
import { StatusBadge } from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import { 
  ArrowLeft, 
  MapPin, 
  Phone, 
  Plus, 
  FileText, 
  MessageSquare,
  Heart,
  Clock,
  Trash2,
  AlertTriangle,
  Loader2,
  Megaphone,
  Edit2,
  Check,
  X
} from 'lucide-react';
import { api } from '../services/api';
import { messageGenerationService } from '../services/messageGenerationService';
import { openWhatsApp } from '../utils/whatsapp';

interface CustomerProfileProps {
  customerId: string;
  setCurrentPage: (page: string) => void;
  setSelectedCustomerId: (id: string) => void;
}

type TimelineFilter = 'ALL' | 'ENQUIRIES' | 'PURCHASES' | 'FOLLOWUPS' | 'CAMPAIGNS';

interface TimelineEntry {
  id: string;
  type: 'enquiry' | 'purchase' | 'followup' | 'campaign' | 'activity';
  date: Date;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'blue' | 'rose' | 'slate' | 'indigo';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const CustomerProfile: React.FC<CustomerProfileProps> = ({ 
  customerId, 
  setCurrentPage,
  setSelectedCustomerId
}) => {
  const { 
    customers, 
    enquiries, 
    sales,
    followUps, 
    notes, 
    activities, 
    products,
    addNote,
    updateCustomer,
    deleteCustomer,
    shopName
  } = useApp();

  const customer = customers.find(c => c.id === customerId);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Notes state
  const [noteContent, setNoteContent] = useState('');

  // Timeline filter state
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('ALL');

  // Customer Campaign History State
  const [campaignHistory, setCampaignHistory] = useState<any[]>([]);
  const [, setLoadingCampaignHistory] = useState(false);

  // WhatsApp Offer Permission State
  const [offerPermissionEnabled, setOfferPermissionEnabled] = useState(false);
  const [loadingPermission, setLoadingPermission] = useState(false);
  const [confirmPermissionModal, setConfirmPermissionModal] = useState<'enable' | 'disable' | null>(null);

  // Preferences editing state
  const [isEditingPreferences, setIsEditingPreferences] = useState(false);
  const [prefInterestedIn, setPrefInterestedIn] = useState('');
  const [prefSize, setPrefSize] = useState('');
  const [prefColors, setPrefColors] = useState('');
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  // Load campaign history and WhatsApp offer permission
  useEffect(() => {
    if (customer?.id) {
      setLoadingCampaignHistory(true);
      api.getCustomerCampaignHistory(customer.id)
        .then(res => {
          if (res.success && Array.isArray(res.history)) {
            setCampaignHistory(res.history);
          }
        })
        .catch(err => console.error('Failed to load campaign history:', err))
        .finally(() => setLoadingCampaignHistory(false));

      setLoadingPermission(true);
      api.getCustomerOfferPermission(customer.id)
        .then(res => {
          if (res.success) {
            setOfferPermissionEnabled(Boolean(res.allowWhatsAppOffers));
          }
        })
        .catch(err => console.error('Failed to load offer permission:', err))
        .finally(() => setLoadingPermission(false));
    }
  }, [customer?.id]);

  // Sync preference editing state when opening modal or customer changes
  useEffect(() => {
    if (customer) {
      setPrefInterestedIn(customer.preferences?.interestedIn || '');
      setPrefSize(customer.preferences?.preferredSize || '');
      const colors = customer.preferences?.preferredColors;
      setPrefColors(Array.isArray(colors) ? colors.join(', ') : (colors || ''));
    }
  }, [customer]);

  if (!customer) {
    return (
      <div className="flex-grow p-8 text-center font-sans">
        <p className="text-slate-400">Customer not found</p>
        <button 
          onClick={() => setCurrentPage('customers')} 
          className="text-primary-600 font-bold mt-4 flex items-center gap-1 mx-auto hover:underline text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Customers
        </button>
      </div>
    );
  }

  const customerEnquiries = enquiries.filter(e => e.customerId === customer.id);
  const customerFollowUps = followUps.filter(f => f.customerId === customer.id);
  const customerSales = sales.filter(s => s.customerId === customer.id);
  const customerNotes = notes.filter(n => n.customerId === customer.id);
  const customerActivities = activities.filter(a => a.customerId === customer.id);

  // Generate default WhatsApp message
  const pendingFollowUp = customerFollowUps.find(f => f.status === 'ready');
  const defaultWhatsAppMessage = pendingFollowUp?.message || messageGenerationService.generateFollowUpQuickMessage(
    customer.name,
    customerEnquiries[0]?.productName || 'our collection',
    customer.preferences?.preferredSize
  );

  const handleSendWhatsApp = (customMsg?: string) => {
    const textToSend = customMsg || defaultWhatsAppMessage;
    openWhatsApp(customer.phone, textToSend, shopName, customer.name);
  };

  const handleTogglePermission = async (enable: boolean) => {
    if (!customer?.id) return;
    setLoadingPermission(true);
    try {
      const res = await api.setCustomerOfferPermission(customer.id, enable);
      if (res.success) {
        setOfferPermissionEnabled(res.allowWhatsAppOffers);
        setConfirmPermissionModal(null);
      }
    } catch (err) {
      console.error('Failed to update offer permission:', err);
    } finally {
      setLoadingPermission(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPreferences(true);
    try {
      const cleanedColors = prefColors
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);

      const updatedPrefs = {
        interestedIn: prefInterestedIn.trim(),
        preferredSize: prefSize.trim(),
        preferredColors: cleanedColors
      };

      await updateCustomer(customer.id, { preferences: updatedPrefs });
      setIsEditingPreferences(false);
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const handleAddNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    addNote(customer.id, noteContent.trim());
    setNoteContent('');
  };

  // Build unified chronological activity timeline
  const timelineEntries: TimelineEntry[] = useMemo(() => {
    const list: TimelineEntry[] = [];

    // 1. Enquiries
    customerEnquiries.forEach(enq => {
      const prod = products.find(p => p.id === enq.productId);
      const prodName = enq.productName || prod?.name || 'Product';
      const sizeText = enq.size && enq.size !== 'N/A' ? ` (${enq.size})` : '';
      const priceText = enq.priceAtEnquiry || prod?.sellingPrice ? `₹${(enq.priceAtEnquiry || prod?.sellingPrice || 0).toLocaleString('en-IN')}` : '';

      list.push({
        id: `enq-${enq.id}`,
        type: 'enquiry',
        date: new Date(enq.createdAt),
        title: `Enquiry: ${prodName}${sizeText}`,
        description: [
          priceText ? `Price: ${priceText}` : '',
          enq.color && enq.color !== 'Standard' && enq.color !== 'N/A' ? `Colour: ${enq.color}` : '',
          enq.quantity > 1 ? `Qty: ${enq.quantity}` : '',
          enq.notes ? `"${enq.notes}"` : ''
        ].filter(Boolean).join(' • ') || 'Customer enquired about this product.',
        badge: enq.purchaseStatus === 'Purchased' ? 'Purchased' : enq.purchaseStatus || 'Pending',
        badgeColor: enq.purchaseStatus === 'Purchased' ? 'emerald' : 'amber'
      });
    });

    // 2. Purchases (Sales)
    customerSales.forEach(sale => {
      const itemCount = (sale.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
      const itemNames = (sale.items || []).map(i => i.productName).filter(Boolean).slice(0, 3).join(', ');
      const extraItems = (sale.items?.length || 0) > 3 ? ` +${sale.items.length - 3} more` : '';

      list.push({
        id: `sale-${sale.id}`,
        type: 'purchase',
        date: new Date(sale.createdAt),
        title: `Purchase Completed • Invoice ${sale.invoiceNumber || sale.id}`,
        description: `${itemNames || 'Items'}${extraItems} (${itemCount} item${itemCount === 1 ? '' : 's'}) • ₹${(sale.totalAmount || 0).toLocaleString('en-IN')} via ${sale.paymentMethod || 'Cash'}`,
        badge: `₹${(sale.totalAmount || 0).toLocaleString('en-IN')}`,
        badgeColor: 'emerald'
      });
    });

    // 3. Follow-ups
    customerFollowUps.forEach(fw => {
      const isReady = fw.status === 'ready';
      const isCompleted = fw.status === 'completed';
      const isClosed = fw.status === 'closed';

      list.push({
        id: `fw-${fw.id}`,
        type: 'followup',
        date: new Date(fw.scheduledAt || fw.createdAt),
        title: `Follow-up ${isReady ? '(Due Today)' : isCompleted ? '(Completed)' : isClosed ? '(Closed)' : '(Scheduled)'}`,
        description: fw.reason || fw.message || 'Follow-up regarding customer enquiry.',
        badge: isReady ? 'Due Today' : isCompleted ? 'Completed' : fw.status,
        badgeColor: isReady ? 'rose' : isCompleted ? 'emerald' : 'blue',
        action: isReady ? {
          label: 'Open WhatsApp',
          onClick: () => handleSendWhatsApp(fw.message)
        } : undefined
      });
    });

    // 4. Campaign History
    campaignHistory.forEach((camp, idx) => {
      list.push({
        id: `camp-${idx}-${camp.campaignTitle}`,
        type: 'campaign',
        date: new Date(camp.sentAt || Date.now()),
        title: `Campaign: ${camp.campaignTitle}`,
        description: [
          camp.discount ? `Offer: ${camp.discount}` : '',
          camp.responseType ? `Customer response: ${camp.responseType}` : '',
          camp.responseNotes ? `"${camp.responseNotes}"` : ''
        ].filter(Boolean).join(' • ') || `Sent status: ${camp.sentStatus}`,
        badge: camp.sentStatus || 'Sent',
        badgeColor: camp.sentStatus === 'DELIVERED' || camp.sentStatus === 'READ' ? 'emerald' : 'indigo'
      });
    });

    // 5. Activity log (excluding duplicate enquiry/followup logs)
    customerActivities.forEach(act => {
      if (act.type === 'enquiry_created' || act.type === 'followup_created') {
        return; // Avoid duplicating already captured enquiries and follow-ups
      }
      list.push({
        id: `act-${act.id}`,
        type: 'activity',
        date: new Date(act.createdAt),
        title: act.type === 'message_sent' ? 'WhatsApp Message Sent' : 'Customer Activity',
        description: act.description,
        badge: act.type === 'message_sent' ? 'Message' : 'Activity',
        badgeColor: 'slate'
      });
    });

    // Sort newest first
    return list.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [customerEnquiries, customerSales, customerFollowUps, campaignHistory, customerActivities, products]);

  // Filtered timeline
  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'ALL') return timelineEntries;
    if (timelineFilter === 'ENQUIRIES') return timelineEntries.filter(t => t.type === 'enquiry');
    if (timelineFilter === 'PURCHASES') return timelineEntries.filter(t => t.type === 'purchase');
    if (timelineFilter === 'FOLLOWUPS') return timelineEntries.filter(t => t.type === 'followup');
    if (timelineFilter === 'CAMPAIGNS') return timelineEntries.filter(t => t.type === 'campaign');
    return timelineEntries;
  }, [timelineEntries, timelineFilter]);

  // Preferences existence check
  const hasInterestedIn = Boolean(customer.preferences?.interestedIn && customer.preferences.interestedIn.trim());
  const hasSize = Boolean(customer.preferences?.preferredSize && customer.preferences.preferredSize.trim());
  const rawColors = customer.preferences?.preferredColors as any;
  const hasColors = Boolean(
    (Array.isArray(rawColors) && rawColors.length > 0) ||
    (typeof rawColors === 'string' && rawColors.trim())
  );
  const hasAnyPreferences = hasInterestedIn || hasSize || hasColors;

  return (
    <div className="flex-grow p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full font-sans space-y-6 animate-fadeIn">
      
      {/* Top Navigation Row */}
      <div className="flex items-center justify-between">
        <button 
          onClick={() => setCurrentPage('customers')} 
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 font-bold text-xs sm:text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Customers
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          title="Delete Customer"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete Customer
        </button>
      </div>

      {/* A. Customer Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary-50 text-primary-600 font-black text-xl flex items-center justify-center shrink-0 border border-primary-100">
            {customer.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'C'}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">{customer.name}</h1>
              <StatusBadge status={customer.status || 'Active'} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
              <a 
                href={`tel:${customer.phone}`} 
                className="flex items-center gap-1.5 text-slate-700 hover:text-primary-600 font-semibold transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-slate-400" /> {customer.phone}
              </a>

              {/* Location only if available */}
              {customer.location && customer.location.trim() && (
                <span className="flex items-center gap-1 text-slate-500">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" /> {customer.location}
                </span>
              )}

              {/* Subtle Customer ID */}
              <span className="text-[11px] text-slate-400 font-mono">
                ID: {customer.id}
              </span>
            </div>

            {/* Subtle WhatsApp Offers Consent status */}
            <div className="flex items-center gap-2 pt-0.5 text-[11px]">
              <span className="text-slate-400 font-medium">WhatsApp Offers:</span>
              <span className={`font-bold ${offerPermissionEnabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                {offerPermissionEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={() => setConfirmPermissionModal(offerPermissionEnabled ? 'disable' : 'enable')}
                disabled={loadingPermission}
                className="text-primary-600 hover:text-primary-800 underline font-semibold disabled:opacity-50"
              >
                {offerPermissionEnabled ? 'Change' : 'Enable'}
              </button>
            </div>
          </div>
        </div>

        {/* Primary Actions: New Enquiry & WhatsApp */}
        <div className="flex items-center gap-2.5 sm:self-center shrink-0">
          <button
            onClick={() => {
              setSelectedCustomerId(customer.id);
              setCurrentPage('new-enquiry');
            }}
            className="flex-1 sm:flex-initial bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Enquiry
          </button>

          <button
            onClick={() => handleSendWhatsApp()}
            className="flex-1 sm:flex-initial bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <MessageSquare className="w-4 h-4" /> WhatsApp
          </button>
        </div>
      </div>

      {/* B. Customer Preferences Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <Heart className="w-4 h-4 text-rose-500" />
            <span>Customer Preferences</span>
          </div>

          <button
            onClick={() => setIsEditingPreferences(true)}
            className="text-xs font-bold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Edit2 className="w-3 h-3" /> {hasAnyPreferences ? 'Edit' : '+ Add Preferences'}
          </button>
        </div>

        {hasAnyPreferences ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1 text-xs">
            {/* Interested products/categories */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Interested In</span>
              <p className="font-bold text-slate-800 text-sm">
                {customer.preferences?.interestedIn || '—'}
              </p>
            </div>

            {/* Preferred size */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Preferred Size</span>
              <p className="font-bold text-slate-800 text-sm">
                {customer.preferences?.preferredSize || '—'}
              </p>
            </div>

            {/* Preferred colours */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Preferred Colours</span>
              <p className="font-bold text-slate-800 text-sm">
                {Array.isArray(customer.preferences?.preferredColors) 
                  ? customer.preferences.preferredColors.join(', ') || '—'
                  : customer.preferences?.preferredColors || '—'}
              </p>
            </div>
          </div>
        ) : (
          <div className="py-2 text-xs text-slate-400 font-medium">
            No preferences recorded yet. Tap <span className="font-bold text-slate-600">"+ Add Preferences"</span> to save size, color, or item interests for customer recommendations.
          </div>
        )}
      </div>

      {/* C. Customer Activity Timeline Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <Clock className="w-4 h-4 text-primary-500" />
            <span>Customer Activity Timeline</span>
            <span className="text-xs text-slate-400 font-normal">({timelineEntries.length})</span>
          </div>

          {/* Simple compact filter pills */}
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            {[
              { id: 'ALL' as const, label: 'All' },
              { id: 'ENQUIRIES' as const, label: `Enquiries (${customerEnquiries.length})` },
              { id: 'PURCHASES' as const, label: `Purchases (${customerSales.length})` },
              { id: 'FOLLOWUPS' as const, label: `Follow-ups (${customerFollowUps.length})` },
              ...(campaignHistory.length > 0 ? [{ id: 'CAMPAIGNS' as const, label: `Campaigns (${campaignHistory.length})` }] : [])
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setTimelineFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  timelineFilter === f.id
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline list */}
        {filteredTimeline.length > 0 ? (
          <div className="space-y-3 pt-1">
            {filteredTimeline.map(entry => (
              <div 
                key={entry.id} 
                className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-800 text-sm">{entry.title}</span>
                    
                    {entry.badge && (
                      <span className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                        entry.badgeColor === 'emerald' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        entry.badgeColor === 'amber' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                        entry.badgeColor === 'rose' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                        entry.badgeColor === 'indigo' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                        entry.badgeColor === 'blue' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {entry.badge}
                      </span>
                    )}
                  </div>

                  <p className="text-slate-600 leading-relaxed font-medium">{entry.description}</p>
                  
                  <p className="text-[11px] text-slate-400 font-medium">
                    {formatDateIST(entry.date)} • {formatTimeIST(entry.date)}
                  </p>
                </div>

                {/* Inline Action (e.g. Open WhatsApp on ready follow-up) */}
                {entry.action && (
                  <button
                    onClick={entry.action.onClick}
                    className="self-start sm:self-center shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{entry.action.label}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-500">No activity matching filter</p>
            <p>New enquiries, purchases, and follow-ups will appear here chronologically.</p>
          </div>
        )}
      </div>

      {/* D. Notes Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <FileText className="w-4 h-4 text-slate-400" />
            <span>Customer Notes</span>
            <span className="text-xs text-slate-400 font-normal">({customerNotes.length})</span>
          </div>
        </div>

        {/* Add Note Form */}
        <form onSubmit={handleAddNoteSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Write a quick customer note..."
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            className="flex-grow bg-slate-50 border border-slate-200 rounded-xl py-2 px-3.5 text-xs sm:text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white transition-all"
          />
          <button 
            type="submit"
            disabled={!noteContent.trim()}
            className="bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors shrink-0 shadow-2xs"
          >
            + Add Note
          </button>
        </form>

        {/* Notes List */}
        {customerNotes.length > 0 ? (
          <div className="space-y-2 pt-1">
            {customerNotes.map(note => (
              <div key={note.id} className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 text-xs text-slate-700">
                <p className="leading-relaxed font-medium">{note.content}</p>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">
                  {formatDateTimeIST(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic py-1">No notes recorded yet.</p>
        )}
      </div>

      {/* Edit Preferences Modal */}
      {isEditingPreferences && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Heart className="w-4 h-4 text-rose-500" />
                Edit Preferences
              </h3>
              <button 
                onClick={() => setIsEditingPreferences(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePreferences} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Interested Categories / Products</label>
                <input
                  type="text"
                  placeholder="e.g. Shirts, Denim, Kurtis"
                  value={prefInterestedIn}
                  onChange={(e) => setPrefInterestedIn(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Preferred Size</label>
                <input
                  type="text"
                  placeholder="e.g. M, L, XL, 32, Free Size"
                  value={prefSize}
                  onChange={(e) => setPrefSize(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Preferred Colours</label>
                <input
                  type="text"
                  placeholder="e.g. Black, Navy Blue, White (comma separated)"
                  value={prefColors}
                  onChange={(e) => setPrefColors(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:outline-none focus:border-primary-500 focus:bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSavingPreferences}
                  onClick={() => setIsEditingPreferences(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPreferences}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
                >
                  {isSavingPreferences ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{isSavingPreferences ? 'Saving...' : 'Save Preferences'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 font-sans">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-100">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Delete customer?</h3>
                <p className="text-xs text-slate-400 font-medium">Customer: <strong className="text-slate-700">{customer.name}</strong></p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              This will permanently remove this customer, their enquiries, follow-ups, and notes. Historical sales invoices are strictly preserved.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (isDeleting) return;
                  setIsDeleting(true);
                  try {
                    const success = await deleteCustomer(customer.id);
                    if (success) {
                      setShowDeleteModal(false);
                      setCurrentPage('customers');
                    }
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isDeleting ? 'Deleting...' : 'Delete Customer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Offer Permission Modal */}
      {confirmPermissionModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4 text-center font-sans">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-100">
              <Megaphone className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-800">
                {confirmPermissionModal === 'enable' ? 'Enable WhatsApp Offers?' : 'Disable WhatsApp Offers?'}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed font-medium">
                {confirmPermissionModal === 'enable'
                  ? `Confirm that ${customer.name} agreed to receive order updates and occasional offers on WhatsApp.`
                  : `Stop sending promotional WhatsApp offers to ${customer.name}? Customer details and billing history remain intact.`}
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={loadingPermission}
                onClick={() => setConfirmPermissionModal(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingPermission}
                onClick={() => handleTogglePermission(confirmPermissionModal === 'enable')}
                className={`flex-1 py-2.5 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1 ${
                  confirmPermissionModal === 'enable' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'
                }`}
              >
                {loadingPermission ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{confirmPermissionModal === 'enable' ? 'Confirm Enable' : 'Disable'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
