import React, { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { X, Camera, AlertCircle } from 'lucide-react';

interface BarcodeScannerModalProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ onScanSuccess, onClose }) => {
  const [permissionError] = useState<string | null>(null);

  useEffect(() => {
    // Instantiate Html5QrcodeScanner
    const scanner = new Html5QrcodeScanner(
      'quickr-barcode-reader',
      {
        fps: 10,
        qrbox: { width: 260, height: 160 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true,
        showZoomSliderIfSupported: false,
        rememberLastUsedCamera: true
      },
      /* verbose= */ false
    );

    scanner.render(
      (decodedText) => {
        // Play scan beep feedback
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1046.5, audioCtx.currentTime); // C6 tone
          gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.12);
        } catch (_) {}

        onScanSuccess(decodedText);
        scanner.clear().catch(() => {});
        onClose();
      },
      () => {
        // Scan attempt framing - ignore per-frame failures
      }
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [onScanSuccess, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-fadeIn font-sans">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary-600" />
            <h3 className="text-base font-bold text-slate-800">Scan Product Barcode</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport Container */}
        <div className="p-6 flex flex-col items-center">
          {permissionError ? (
            <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <p className="text-xs font-bold text-rose-800">{permissionError}</p>
              <p className="text-[11px] text-rose-600">Camera permission is required to scan products. Please allow access or use a USB/Bluetooth scanner.</p>
            </div>
          ) : (
            <div className="w-full relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-inner">
              <div id="quickr-barcode-reader" className="w-full"></div>
            </div>
          )}

          <p className="text-xs text-slate-400 font-medium text-center mt-4">
            Point camera at QuickR product barcode (Code 128)
          </p>
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <span className="text-[11px] text-slate-400 font-medium">QuickR Scanner Mode</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
