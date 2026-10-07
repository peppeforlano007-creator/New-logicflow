import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export interface ScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  hint?: string;
}

const SCANNER_ID = 'html5qr-scanner-web';
const VIEWFINDER_SIZE = 260;
const CORNER_SIZE = 28;
const CORNER_THICKNESS = 4;

export function ScannerModal({
  visible,
  onClose,
  onScanned,
  hint = 'Inquadra il barcode',
}: ScannerModalProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const debounceRef = useRef(false);
  const isRunningRef = useRef(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      stopScanner();
      return;
    }

    setCameraError(null);

    const timer = setTimeout(() => {
      startScanner();
    }, 100);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function startScanner() {
    try {
      const element = document.getElementById(SCANNER_ID);
      if (!element) return;

      if (scannerRef.current) {
        try {
          if (isRunningRef.current) {
            await scannerRef.current.stop();
            isRunningRef.current = false;
          }
          scannerRef.current.clear();
        } catch {
          // ignore
        }
        scannerRef.current = null;
      }

      const html5Qrcode = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = html5Qrcode;

      console.log('[ScannerModal.web] Starting camera scanner');

      await html5Qrcode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE },
        },
        (decodedText) => {
          if (debounceRef.current) return;
          debounceRef.current = true;
          console.log('[ScannerModal.web] Barcode scanned:', decodedText);
          onScanned(decodedText);
          setTimeout(() => {
            debounceRef.current = false;
          }, 1500);
        },
        () => {
          // scan failure — ignore per-frame errors
        },
      );

      isRunningRef.current = true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Impossibile accedere alla fotocamera';
      console.error('[ScannerModal.web] Camera error:', message);
      setCameraError(message);
    }
  }

  async function stopScanner() {
    if (!scannerRef.current) return;
    try {
      if (isRunningRef.current) {
        console.log('[ScannerModal.web] Stopping camera scanner');
        await scannerRef.current.stop();
        isRunningRef.current = false;
      }
      scannerRef.current.clear();
    } catch {
      // ignore cleanup errors
    }
    scannerRef.current = null;
  }

  if (!visible) return null;

  return (
    <div style={styles.overlay}>
      {/* Scanner target div */}
      <div id={SCANNER_ID} style={styles.scannerTarget} />

      {/* Dark overlay with viewfinder cutout */}
      <div style={styles.overlayTop} />
      <div style={styles.overlayMiddleRow}>
        <div style={styles.overlaySide} />
        <div style={styles.viewfinder}>
          {/* Corners */}
          <div style={{ ...styles.corner, ...styles.cornerTL }} />
          <div style={{ ...styles.corner, ...styles.cornerTR }} />
          <div style={{ ...styles.corner, ...styles.cornerBL }} />
          <div style={{ ...styles.corner, ...styles.cornerBR }} />
        </div>
        <div style={styles.overlaySide} />
      </div>
      <div style={styles.overlayBottom}>
        {cameraError ? (
          <div style={styles.errorContainer}>
            <span style={styles.errorIcon}>⚠️</span>
            <p style={styles.errorTitle}>Fotocamera non disponibile</p>
            <p style={styles.errorSubtitle}>{cameraError}</p>
          </div>
        ) : (
          <p style={styles.hintText}>{hint}</p>
        )}
      </div>

      {/* Close button */}
      <button
        style={styles.closeButton}
        onClick={() => {
          console.log('[ScannerModal.web] Scanner closed by user');
          onClose();
        }}
      >
        ✕  Chiudi
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#000000',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  scannerTarget: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 1,
    pointerEvents: 'none',
  },
  overlayMiddleRow: {
    display: 'flex',
    flexDirection: 'row',
    height: VIEWFINDER_SIZE,
    zIndex: 1,
    pointerEvents: 'none',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
    flexShrink: 0,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#FFFFFF',
    borderStyle: 'solid',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderWidth: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderWidth: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderWidth: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderWidth: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 24,
    pointerEvents: 'none',
  },
  hintText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    margin: 0,
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '0 32px',
  },
  errorIcon: {
    fontSize: 40,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    margin: 0,
  },
  errorSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
    margin: 0,
    lineHeight: '1.5',
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    zIndex: 2,
  },
};
