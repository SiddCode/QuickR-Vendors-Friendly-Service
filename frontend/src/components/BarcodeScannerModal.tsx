import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Laptop, Keyboard, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

interface BarcodeScannerModalProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ onScanSuccess, onClose }) => {
  // Mobile / Tablet Detection
  const [isMobileDevice] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || '';
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= 768;
    return isMobileUA || (isTouchScreen && isSmallScreen);
  });

  // Mode: 'desktop_hardware' | 'mobile_camera' | 'camera_override' | 'manual_entry'
  const [scanMode, setScanMode] = useState<'desktop_hardware' | 'mobile_camera' | 'camera_override' | 'manual_entry'>(
    isMobileDevice ? 'mobile_camera' : 'desktop_hardware'
  );

  const [manualCodeInput, setManualCodeInput] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  const manualInputRef = useRef<HTMLInputElement>(null);
  const hardwareBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const isScanLockedRef = useRef<boolean>(false);

  // Focus manual input when manual_entry mode opens
  useEffect(() => {
    if (scanMode === 'manual_entry' && manualInputRef.current) {
      manualInputRef.current.focus();
    }
  }, [scanMode]);

  // Hardware Scanner Listener (Active in desktop_hardware mode)
  useEffect(() => {
    if (scanMode !== 'desktop_hardware') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastKeyTimeRef.current > 100) {
        hardwareBufferRef.current = '';
      }
      lastKeyTimeRef.current = currentTime;

      if (e.key === 'Enter') {
        const scannedVal = hardwareBufferRef.current.trim();
        if (scannedVal && !isScanLockedRef.current) {
          isScanLockedRef.current = true;
          e.preventDefault();
          onScanSuccess(scannedVal);
          onClose();
        }
        hardwareBufferRef.current = '';
      } else if (e.key.length === 1) {
        hardwareBufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scanMode, onScanSuccess, onClose]);

  // Direct Html5Qrcode initialization & camera lifecycle management
  useEffect(() => {
    if (scanMode !== 'mobile_camera' && scanMode !== 'camera_override') return;

    setPermissionError(null);
    setIsInitializing(true);
    isScanLockedRef.current = false;

    // Check secure context requirement (HTTPS or localhost)
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setPermissionError("Camera access requires HTTPS. Please access QuickR over a secure connection.");
      setIsInitializing(false);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionError("Camera barcode scanning isn't supported in this browser. Please use manual entry.");
      setIsInitializing(false);
      return;
    }

    let isMounted = true;
    const scannerId = 'quickr-camera-viewport';
    const html5Qrcode = new Html5Qrcode(scannerId);
    html5QrcodeRef.current = html5Qrcode;

    const startCamera = async () => {
      try {
        // Request camera with preference for environment / rear camera
        await html5Qrcode.start(
          { facingMode: { ideal: "environment" } },
          {
            fps: 15,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            if (isScanLockedRef.current) return;
            isScanLockedRef.current = true;

            // Audio beep feedback
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(1046.5, audioCtx.currentTime);
              gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.12);
            } catch (_) {}

            if (import.meta.env.DEV) {
              setDebugInfo(`Barcode: ${decodedText}`);
            }

            // Immediately stop camera and trigger success handler
            html5Qrcode.stop().catch(() => {}).finally(() => {
              onScanSuccess(decodedText.trim());
              onClose();
            });
          },
          () => {
            // Per-frame scan miss - expected
          }
        );

        if (isMounted) {
          setIsInitializing(false);
          if (import.meta.env.DEV) {
            setDebugInfo('Camera: READY | Scanner: RUNNING');
          }
        }
      } catch (err: any) {
        console.error('Camera start failure:', err);
        if (isMounted) {
          setIsInitializing(false);
          const errStr = err?.name || err?.toString() || '';
          if (errStr.includes('NotAllowedError') || errStr.includes('Permission')) {
            setPermissionError("Camera permission was denied. Please allow camera access in your browser settings and try again.");
          } else if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError')) {
            setPermissionError("No camera was found on this device.");
          } else if (errStr.includes('NotReadableError') || errStr.includes('TrackStartError')) {
            setPermissionError("The camera is currently being used by another application. Close it and try again.");
          } else {
            setPermissionError("Unable to start barcode scanner. Please try again or enter barcode manually.");
          }
        }
      }
    };

    // Small delay to ensure container element ID is in DOM
    const initTimer = setTimeout(() => {
      startCamera();
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(initTimer);

      if (html5QrcodeRef.current) {
        if (html5QrcodeRef.current.isScanning) {
          html5QrcodeRef.current.stop().catch(() => {});
        }
      }

      // Explicitly stop all media tracks to turn off camera hardware LED indicator
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => stream.getTracks().forEach(track => track.stop()))
          .catch(() => {});
      }
    };
  }, [scanMode, onScanSuccess, onClose]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = manualCodeInput.trim();
    if (!cleanCode) return;
    onScanSuccess(cleanCode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-fadeIn font-sans">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            {scanMode === 'desktop_hardware' ? (
              <Laptop className="w-5 h-5 text-indigo-600" />
            ) : (
              <Camera className="w-5 h-5 text-primary-600" />
            )}
            <h3 className="text-base font-bold text-slate-800">Scan Product Barcode</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close barcode scanner modal"
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {/* Mode 1: Desktop / Laptop Hardware POS Scanner */}
          {scanMode === 'desktop_hardware' && (
            <div className="space-y-5 text-center">
              <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                <Laptop className="w-8 h-8" />
              </div>

              <div>
                <h4 className="text-base font-bold text-slate-800">Using a laptop or PC?</h4>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Connect a USB or Bluetooth barcode scanner and scan the product.
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold text-slate-700">Scanner ready — scan a barcode</span>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setScanMode('manual_entry')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Keyboard className="w-4 h-4 text-slate-500" /> Enter barcode manually
                </button>

                <button
                  type="button"
                  onClick={() => setScanMode('camera_override')}
                  className="w-full py-2 px-4 text-slate-500 hover:text-indigo-600 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" /> Use camera instead
                </button>
              </div>
            </div>
          )}

          {/* Mode 2: Mobile / Camera Scanner (or Desktop Camera Override) */}
          {(scanMode === 'mobile_camera' || scanMode === 'camera_override') && (
            <div className="flex flex-col items-center">
              {permissionError ? (
                <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3 w-full">
                  <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                  <p className="text-xs font-bold text-rose-800">{permissionError}</p>
                  <button
                    type="button"
                    onClick={() => setScanMode('manual_entry')}
                    className="mt-2 w-full py-2.5 bg-white border border-rose-200 text-rose-700 text-xs font-bold rounded-xl hover:bg-rose-100 transition-colors shadow-2xs"
                  >
                    Enter barcode manually
                  </button>
                </div>
              ) : (
                <div className="w-full relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-inner min-h-[240px] flex items-center justify-center">
                  {isInitializing && (
                    <div className="absolute inset-0 bg-slate-900/90 z-10 flex flex-col items-center justify-center text-white space-y-2">
                      <Loader2 className="w-7 h-7 animate-spin text-primary-400" />
                      <span className="text-xs font-bold">Starting camera...</span>
                    </div>
                  )}
                  <div id="quickr-camera-viewport" className="w-full h-full min-h-[240px]"></div>
                </div>
              )}

              <p className="text-xs text-slate-500 font-bold text-center mt-4">
                Align the barcode inside the box
              </p>

              {import.meta.env.DEV && debugInfo && (
                <div className="mt-2 p-2 bg-slate-100 rounded text-[10px] font-mono text-slate-600 w-full text-center">
                  {debugInfo}
                </div>
              )}

              <div className="pt-4 w-full flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setScanMode('manual_entry')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Keyboard className="w-4 h-4 text-slate-500" /> Enter barcode manually
                </button>

                {!isMobileDevice && scanMode === 'camera_override' && (
                  <button
                    type="button"
                    onClick={() => setScanMode('desktop_hardware')}
                    className="w-full py-2 text-slate-500 hover:text-indigo-600 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Laptop className="w-3.5 h-3.5" /> Back to USB/Bluetooth scanner
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mode 3: Manual Barcode Entry Fallback */}
          {scanMode === 'manual_entry' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 bg-slate-100 text-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Keyboard className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">Enter Barcode Manually</h4>
                <p className="text-xs text-slate-400">Type the QuickR product barcode</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Barcode Code</label>
                <input
                  ref={manualInputRef}
                  type="text"
                  required
                  value={manualCodeInput}
                  onChange={(e) => setManualCodeInput(e.target.value.trim())}
                  placeholder="e.g. QKR-7F3A92K1"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-indigo-500 uppercase tracking-wider"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScanMode(isMobileDevice ? 'mobile_camera' : 'desktop_hardware')}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!manualCodeInput.trim()}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>Submit</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs">
          <span className="text-[11px] text-slate-400 font-medium">
            {isMobileDevice ? 'Mobile Camera Scanner' : 'Desktop POS Scanner'}
          </span>
          <button
            onClick={onClose}
            aria-label="Cancel scanner modal"
            className="px-4 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
