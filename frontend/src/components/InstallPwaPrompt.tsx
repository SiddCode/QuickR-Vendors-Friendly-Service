import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

export const InstallPwaPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowBanner(false);
      console.log('[QuickR PWA] App successfully installed');
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const handleTriggerInstall = () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
      } else {
        alert('To install QuickR on your device:\n\n1. Mobile (Chrome/Edge): Tap (⋮) menu -> "Add to Home screen" or "Install App".\n2. Mobile (Safari iOS): Tap Share icon -> "Add to Home Screen".\n3. Desktop (Chrome/Edge): Click the Install icon on the right side of the address bar.');
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('trigger-pwa-install', handleTriggerInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('trigger-pwa-install', handleTriggerInstall);
    };
  }, [deferredPrompt]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  return (
    <>
      {/* Non-intrusive Offline Indicator Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white px-4 py-1.5 text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm z-50">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>You're offline — reconnecting to QuickR server...</span>
        </div>
      )}

      {/* Non-intrusive PWA Install Banner */}
      {showBanner && deferredPrompt && (
        <div className="bg-slate-900 text-white px-4 py-2.5 text-xs font-medium flex items-center justify-between gap-3 border-b border-slate-800 shadow-md z-40 animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <img src="/pwa-192x192.png" alt="QuickR" className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0 shadow-2xs" />
            <div>
              <p className="font-bold text-white leading-tight">Install QuickR App</p>
              <p className="text-[11px] text-slate-300">Fast, standalone access for your shop</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstallClick}
              className="bg-primary-500 hover:bg-primary-600 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" /> Install QuickR
            </button>
            <button
              onClick={() => setShowBanner(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
