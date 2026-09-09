import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Monitor, Share, CheckCircle2 } from 'lucide-react';

export const InstallPwaPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Check if app is already running in standalone display mode (installed)
  const isAlreadyInstalled = (): boolean => {
    if (typeof window === 'undefined') return false;
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
    const isIosStandalone = (window.navigator as any).standalone === true;
    return isStandaloneMode || isIosStandalone;
  };

  // Detect iOS Safari
  const isIosSafari = (): boolean => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isWebKit = /webkit/.test(ua);
    const isSafari = isIos && isWebKit && !/crios|fxios|edgios/.test(ua);
    return isIos || isSafari;
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent browser default mini-infobar prompt
      e.preventDefault();
      (window as any).deferredPwaPrompt = e;
      setDeferredPrompt(e);
      if (!isAlreadyInstalled()) {
        setShowBanner(true);
      }
    };

    const handleAppInstalled = () => {
      (window as any).deferredPwaPrompt = null;
      setDeferredPrompt(null);
      setShowBanner(false);
      console.log('[QuickR PWA] App successfully installed');
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Custom Event Listener triggered from Settings -> Install QuickR App
    const handleTriggerInstall = async () => {
      if (isAlreadyInstalled()) {
        setModalMessage("installed");
        setShowInstallModal(true);
        return;
      }

      const activePrompt = deferredPrompt || (window as any).deferredPwaPrompt;

      if (activePrompt) {
        try {
          // Trigger native browser install prompt
          activePrompt.prompt();
          const choiceResult = await activePrompt.userChoice;
          console.log('[QuickR PWA] User choice outcome:', choiceResult.outcome);
          if (choiceResult.outcome === 'accepted') {
            setShowBanner(false);
          }
        } catch (err) {
          console.error('[QuickR PWA] Install prompt error:', err);
        } finally {
          // Clear consumed one-shot event prompt globally and locally
          (window as any).deferredPwaPrompt = null;
          setDeferredPrompt(null);
        }
      } else {
        // Native prompt unavailable or iOS Safari -> Show friendly instructions modal
        setModalMessage(isIosSafari() ? "ios_instructions" : "general_instructions");
        setShowInstallModal(true);
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
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
      }
    } catch (err) {
      console.error('[QuickR PWA] Banner install click error:', err);
    } finally {
      setDeferredPrompt(null);
    }
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

      {/* Non-intrusive PWA Install Top Banner (when native prompt is available) */}
      {showBanner && deferredPrompt && !isAlreadyInstalled() && (
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

      {/* Structured PWA Installation Modal Dialog */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden font-sans">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary-600" />
                <h3 className="text-base font-bold text-slate-800">Install QuickR App</h3>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                aria-label="Close installation modal"
                className="p-1 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {modalMessage === 'installed' ? (
                <div className="text-center space-y-3 py-2">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-bold text-slate-800">QuickR is already installed</h4>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    QuickR is running or installed as a standalone app on this device. You can launch it directly from your home screen or app launcher.
                  </p>
                </div>
              ) : modalMessage === 'ios_instructions' ? (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex items-start gap-3">
                    <Share className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-indigo-900">Install on iPhone / iPad (Safari)</h4>
                      <p className="text-[11px] text-indigo-700 mt-0.5">Follow these 2 easy steps:</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3 pl-1">
                    <div className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-extrabold text-primary-700">1</span>
                      <p className="text-xs font-semibold text-slate-700 pt-0.5">
                        Tap the <span className="font-extrabold text-slate-900">Share icon</span> at the bottom of Safari's browser bar.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-extrabold text-primary-700">2</span>
                      <p className="text-xs font-semibold text-slate-700 pt-0.5">
                        Scroll down and select <span className="font-extrabold text-slate-900">Add to Home Screen</span>.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                    To install QuickR standalone app on your device:
                  </p>

                  <div className="space-y-3">
                    <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                        <Smartphone className="w-4 h-4 text-emerald-600" />
                        <span>Android Chrome / Edge</span>
                      </div>
                      <p className="text-[11px] text-slate-600 pl-6 font-medium">
                        Tap browser <span className="font-bold text-slate-800">⋮ menu</span> → Choose <span className="font-bold text-slate-800">"Install app"</span> or <span className="font-bold text-slate-800">"Add to Home screen"</span>.
                      </p>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                        <Share className="w-4 h-4 text-indigo-600" />
                        <span>iPhone / iPad Safari</span>
                      </div>
                      <p className="text-[11px] text-slate-600 pl-6 font-medium">
                        Tap <span className="font-bold text-slate-800">Share icon</span> → Select <span className="font-bold text-slate-800">"Add to Home Screen"</span>.
                      </p>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-800">
                        <Monitor className="w-4 h-4 text-indigo-600" />
                        <span>Desktop Chrome / Edge</span>
                      </div>
                      <p className="text-[11px] text-slate-600 pl-6 font-medium">
                        Click the <span className="font-bold text-slate-800">Install icon</span> in the address bar (right side).
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowInstallModal(false)}
                className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

