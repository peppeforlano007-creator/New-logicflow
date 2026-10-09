import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { ScanLine, CheckCircle2, XCircle, Clock, Package } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import type { SupplierFile, SupplierItem } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionLogEntry {
  id: string;
  code: string;
  found: boolean;
  duplicate?: boolean;
  fileNames: string[];
  count: number;
  timestamp: Date;
  quantita_totale?: number;
  quantita_disponibile?: number;
}

// ─── Session Log Row ──────────────────────────────────────────────────────────

function SessionLogRow({ entry }: { entry: SessionLogEntry }) {
  const timeStr = entry.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fileNamesStr = entry.fileNames.join(', ');
  const countLabel = entry.count === 1 ? '1 articolo' : `${entry.count} articoli`;

  const rowStyle = entry.found
    ? styles.logRowFound
    : entry.duplicate
    ? styles.logRowDuplicate
    : styles.logRowNotFound;

  const codeStyle = entry.found
    ? styles.logCodeFound
    : entry.duplicate
    ? styles.logCodeDuplicate
    : styles.logCodeNotFound;

  const icon = entry.found
    ? <CheckCircle2 size={18} color="#16A34A" />
    : entry.duplicate
    ? <Clock size={18} color="#D97706" />
    : <XCircle size={18} color="#DC2626" />;

  const bottomText = entry.found
    ? null
    : entry.duplicate
    ? <Text style={styles.logDuplicateText}>Già scansionato</Text>
    : <Text style={styles.logNotFoundText}>Codice non trovato</Text>;

  const hasQty = entry.found &&
    entry.quantita_totale !== undefined &&
    entry.quantita_disponibile !== undefined;
  const qtaDisp = entry.quantita_disponibile ?? 0;
  const qtaTot = entry.quantita_totale ?? 1;
  const qtaColor = qtaDisp > 0 ? '#16A34A' : '#DC2626';

  return (
    <View style={[styles.logRow, rowStyle]}>
      <View style={styles.logRowIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.logCode, codeStyle]} numberOfLines={1}>{entry.code}</Text>
        {entry.found && <Text style={styles.logMeta} numberOfLines={1}>{countLabel}</Text>}
        {hasQty && (
          <Text style={[styles.logMeta, { color: qtaColor }]}>
            Qtà: {qtaDisp} disponibili su {qtaTot} totali
          </Text>
        )}
        {entry.found && fileNamesStr ? <Text style={styles.logFileName} numberOfLines={1}>{fileNamesStr}</Text> : null}
        {bottomText}
      </View>
      <View style={styles.logTimestamp}>
        <Clock size={11} color={COLORS.textTertiary} />
        <Text style={styles.logTime}>{timeStr}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RicezioneScreen() {
  const { toast, showToast, hideToast } = useToast();

  const [activeFiles, setActiveFiles] = useState<SupplierFile[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [receivedItems, setReceivedItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [processingCode, setProcessingCode] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [bannerType, setBannerType] = useState<'error' | 'warning'>('error');
  const [selectedColumn, setSelectedColumn] = useState<'PkgID' | 'LPN'>('LPN');
  const errorBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  // ── Load active files ──────────────────────────────────────────────────────

  const loadActiveFiles = useCallback(async () => {
    console.log('[Ricezione] loadActiveFiles called');
    setLoading(true);
    try {
      const { data: files, error: filesError } = await db
        .from('supplier_files')
        .select('*')
        .neq('status', 'completed')
        .order('imported_at', { ascending: false });

      if (filesError) {
        console.error('[Ricezione] loadActiveFiles files error:', filesError);
        throw filesError;
      }

      const activeFileList = (files ?? []) as SupplierFile[];
      console.log('[Ricezione] Active files loaded:', activeFileList.length);

      if (activeFileList.length === 0) {
        setActiveFiles([]);
        setTotalItems(0);
        setReceivedItems(0);
        setLoading(false);
        return;
      }

      const fileIds = activeFileList.map(f => f.id);

      // Fetch totals from the view and received count in parallel
      const [progressResult, receivedResult] = await Promise.all([
        db
          .from('supplier_file_progress')
          .select('file_id, total_items, completed_items')
          .in('file_id', fileIds),
        db
          .from('supplier_items')
          .select('id', { count: 'exact', head: true })
          .in('file_id', fileIds)
          .eq('extra_data->>received', 'true'),
      ]);

      if (progressResult.error) {
        console.error('[Ricezione] loadActiveFiles progress error:', progressResult.error);
      }
      if (receivedResult.error) {
        console.error('[Ricezione] loadActiveFiles receivedCount error:', receivedResult.error);
      }

      const progressRows = (progressResult.data ?? []) as { file_id: string; total_items: number; completed_items: number }[];
      const total = progressRows.reduce((sum, r) => sum + (r.total_items ?? 0), 0);
      const received = receivedResult.count ?? 0;

      console.log('[Ricezione] Progress loaded — total:', total, '| received:', received);

      setActiveFiles(activeFileList);
      setTotalItems(total);
      setReceivedItems(received);
    } catch (err) {
      console.error('[Ricezione] loadActiveFiles exception:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log('[Ricezione] Tab focused — reloading active files');
      loadActiveFiles();
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }, [loadActiveFiles]),
  );

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  // ── Error banner ───────────────────────────────────────────────────────────

  const showErrorBanner = useCallback((msg: string) => {
    setBannerType('error');
    setErrorBanner(msg);
    Animated.timing(bannerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (errorBannerTimer.current) clearTimeout(errorBannerTimer.current);
    errorBannerTimer.current = setTimeout(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setErrorBanner(null);
      });
    }, 3000);
  }, [bannerOpacity]);

  const showWarningBanner = useCallback((msg: string) => {
    setBannerType('warning');
    setErrorBanner(msg);
    Animated.timing(bannerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (errorBannerTimer.current) clearTimeout(errorBannerTimer.current);
    errorBannerTimer.current = setTimeout(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setErrorBanner(null);
      });
    }, 3000);
  }, [bannerOpacity]);

  // ── Core scan logic ────────────────────────────────────────────────────────

  const processCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      if (processingCode) return;
      setProcessingCode(true);
      console.log('[Ricezione] processCode start:', trimmed, '| selectedColumn:', selectedColumn);

      try {
        const activeFileIds = activeFiles.map(f => f.id);

        if (activeFileIds.length === 0) {
          console.log('[Ricezione] No active files, skipping search');
          showToast('Nessun file attivo', 'error');
          return;
        }

        // Query DB directly for matching items — include quantita fields
        // Search across standard keys: item_code, LPN, ASIN, PkgID, and extra_data SKU
        console.log('[Ricezione] Querying DB for code:', trimmed, '| column:', selectedColumn, '| fileIds:', activeFileIds.length);
        const { data: matchedRaw, error: searchError } = await db
          .from('supplier_items')
          .select('id, file_id, item_code, original_data, extra_data, status, quantita, quantita_disponibile')
          .in('file_id', activeFileIds)
          .or(`item_code.eq.${trimmed},original_data->>LPN.eq.${trimmed},original_data->>ASIN.eq.${trimmed},original_data->>PkgID.eq.${trimmed},extra_data->>SKU.eq.${trimmed}`);

        if (searchError) {
          console.error('[Ricezione] processCode search error:', searchError);
          throw searchError;
        }

        const matched = (matchedRaw ?? []) as (SupplierItem & { quantita?: number; quantita_disponibile?: number })[];
        console.log('[Ricezione] processCode matched:', matched.length, 'items for code:', trimmed, '| column:', selectedColumn);

        const logId = `${Date.now()}-${Math.random()}`;
        const now = new Date().toISOString();

        if (matched.length === 0) {
          console.log('[Ricezione] Code not found:', trimmed);
          setSessionLog(prev => [
            { id: logId, code: trimmed, found: false, fileNames: [], count: 0, timestamp: new Date() },
            ...prev.slice(0, 19),
          ]);
          showToast(`⚠ Codice non trovato: ${trimmed}`, 'error');
          showErrorBanner(`Codice non trovato: ${trimmed}`);
          return;
        }

        // Check if ALL matched items are already received
        const alreadyReceived = matched.every(item => item.extra_data?.received === 'true');
        if (alreadyReceived) {
          console.log('[Ricezione] Code already received:', trimmed);
          showToast('Codice già scansionato e già in fase di lavorazione', 'warning');
          showWarningBanner('Codice già scansionato e già in fase di lavorazione');
          setSessionLog(prev => [
            { id: logId, code: trimmed, found: false, duplicate: true, fileNames: [], count: 0, timestamp: new Date() },
            ...prev.slice(0, 19),
          ]);
          return;
        }

        // Extract quantita info from first matched item
        const firstItem = matched[0];
        const qtaTotale = firstItem.quantita ?? 1;
        const qtaDisponibile = firstItem.quantita_disponibile ?? 1;
        console.log('[Ricezione] quantita info — totale:', qtaTotale, 'disponibile:', qtaDisponibile);

        // Build a map of file_id -> SupplierFile for involved files
        const activeFileMap = new Map<string, SupplierFile>(activeFiles.map(f => [f.id, f]));

        // Group matched items by file
        const fileMap = new Map<string, { file: SupplierFile; items: (SupplierItem & { quantita?: number; quantita_disponibile?: number })[] }>();
        for (const item of matched) {
          const file = activeFileMap.get(item.file_id);
          if (!file) continue;
          const existing = fileMap.get(item.file_id);
          if (existing) {
            existing.items.push(item);
          } else {
            fileMap.set(item.file_id, { file, items: [item] });
          }
        }

        // Update each matched item in DB
        for (const item of matched) {
          console.log('[Ricezione] Updating item in DB:', item.id, 'clearing AdjReason, setting received');
          const { error: itemErr } = await db
            .from('supplier_items')
            .update({
              status: 'processing',
              original_data: {
                ...item.original_data,
                AdjReason: '',
              },
              extra_data: {
                ...item.extra_data,
                received: 'true',
                received_at: now,
              },
            })
            .eq('id', item.id);
          if (itemErr) console.error('[Ricezione] item update error:', itemErr, item.id);
        }

        // Update extra_columns for each involved file
        for (const [fileId, { file }] of fileMap.entries()) {
          const currentExtraColumns: string[] = file.extra_columns ?? [];
          const newColumns = ['received', 'received_at'].filter(c => !currentExtraColumns.includes(c));
          if (newColumns.length > 0) {
            console.log('[Ricezione] Adding extra_columns to file:', fileId, newColumns);
            const { error: colErr } = await db
              .from('supplier_files')
              .update({ extra_columns: [...currentExtraColumns, ...newColumns] })
              .eq('id', fileId);
            if (colErr) console.error('[Ricezione] extra_columns update error:', colErr);
          }
        }

        // Update file status to 'processing' for each involved file (if not already)
        for (const [fileId, { file }] of fileMap.entries()) {
          if (file.status !== 'processing' && file.status !== 'received' && file.status !== 'completed') {
            console.log('[Ricezione] Updating file status to processing:', fileId);
            const { error: fileStatusErr } = await db
              .from('supplier_files')
              .update({ status: 'processing' })
              .eq('id', fileId);
            if (fileStatusErr) console.error('[Ricezione] file status update error:', fileStatusErr);
          }
        }

        // Optimistic local update — file status only
        const involvedFileIds = new Set(fileMap.keys());
        setActiveFiles(prev =>
          prev.map(file =>
            involvedFileIds.has(file.id) && file.status !== 'processing' && file.status !== 'received' && file.status !== 'completed'
              ? { ...file, status: 'processing' as SupplierFile['status'] }
              : file,
          ),
        );

        // Optimistic progress update
        const newlyReceived = matched.filter(item => item.extra_data?.received !== 'true').length;
        if (newlyReceived > 0) {
          setReceivedItems(prev => prev + newlyReceived);
        }

        const fileNames = Array.from(fileMap.values()).map(v => v.file.file_name);
        const countLabel = matched.length === 1 ? '1 articolo ricevuto' : `${matched.length} articoli ricevuti`;
        const fileLabel = fileNames.length === 1 ? fileNames[0] : `${fileNames.length} file`;

        setSessionLog(prev => [
          {
            id: logId,
            code: trimmed,
            found: true,
            fileNames,
            count: matched.length,
            timestamp: new Date(),
            quantita_totale: qtaTotale,
            quantita_disponibile: qtaDisponibile,
          },
          ...prev.slice(0, 19),
        ]);

        showToast(`${countLabel} — ${fileLabel}`, 'success');
        console.log('[Ricezione] processCode success:', { code: trimmed, count: matched.length, files: fileNames, qtaTotale, qtaDisponibile });
      } catch (err: any) {
        console.error('[Ricezione] processCode error:', err);
        showToast(err?.message ?? 'Errore durante la scansione', 'error');
      } finally {
        setProcessingCode(false);
        // Re-focus input after processing so USB/BT scanner can immediately send next code
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [activeFiles, processingCode, selectedColumn, showToast, showErrorBanner, showWarningBanner],
  );

  const handleScanned = useCallback(
    (code: string) => {
      console.log('[Ricezione] handleScanned from camera:', code);
      setScannerOpen(false);
      processCode(code);
    },
    [processCode],
  );

  const handleManualCodeChange = useCallback((text: string) => {
    // Il lettore barcode invia spesso un newline finale — processa subito
    if (text.endsWith('\n') || text.endsWith('\r')) {
      const finalCode = text.replace(/[\r\n]/g, '').trim();
      if (finalCode) {
        console.log('[Ricezione] Barcode reader newline detected, processing code:', finalCode);
        processCode(finalCode);
        setManualCode('');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return;
    }
    setManualCode(text);
  }, [processCode]);

  const handleManualSearch = useCallback(() => {
    console.log('[Ricezione] handleManualSearch pressed, code:', manualCode);
    if (!manualCode.trim()) return;
    processCode(manualCode.trim());
    setManualCode('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [manualCode, processCode]);

  const handleColumnToggle = useCallback((col: 'PkgID' | 'LPN') => {
    console.log('[Ricezione] Column toggle pressed:', col);
    setSelectedColumn(col);
  }, []);

  // ── Derived: global progress ───────────────────────────────────────────────

  const progressRatio = totalItems > 0 ? receivedItems / totalItems : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const progressLabel = `${receivedItems} articoli ricevuti su ${totalItems} totali`;
  const hasActiveFiles = activeFiles.length > 0;

  const scanButtonSubtext = `Cerca per: ${selectedColumn}`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Ricezione' }} />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : !hasActiveFiles ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <Package size={36} color={COLORS.warning} />
          </View>
          <Text style={styles.emptyTitle}>Nessun file attivo da ricevere</Text>
          <Text style={styles.emptySubtitle}>
            Importa prima un file nella sezione Import per iniziare la ricezione.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Global progress card */}
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>{progressLabel}</Text>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` as any }]} />
            </View>
          </View>

          {/* Column filter */}
          <View style={styles.columnFilterSection}>
            <Text style={styles.columnFilterLabel}>Cerca per:</Text>
            <View style={styles.columnToggleRow}>
              <TouchableOpacity
                style={[styles.columnToggleBtn, selectedColumn === 'PkgID' && styles.columnToggleBtnActive]}
                onPress={() => handleColumnToggle('PkgID')}
                activeOpacity={0.75}
              >
                <Text style={[styles.columnToggleText, selectedColumn === 'PkgID' && styles.columnToggleTextActive]}>
                  PkgID
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.columnToggleBtn, selectedColumn === 'LPN' && styles.columnToggleBtnActive]}
                onPress={() => handleColumnToggle('LPN')}
                activeOpacity={0.75}
              >
                <Text style={[styles.columnToggleText, selectedColumn === 'LPN' && styles.columnToggleTextActive]}>
                  LPN
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Scan button */}
          <AnimatedPressable
            onPress={() => {
              console.log('[Ricezione] Open scanner button pressed');
              setScannerOpen(true);
            }}
            disabled={processingCode}
          >
            <View style={[styles.scanButton, processingCode && { opacity: 0.6 }]}>
              {processingCode ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <ScanLine size={24} color="#FFFFFF" />
              )}
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.scanButtonText}>Scansiona Barcode</Text>
                <Text style={styles.scanButtonSubtext}>{scanButtonSubtext}</Text>
              </View>
            </View>
          </AnimatedPressable>

          {/* Error banner */}
          {errorBanner ? (
            <Animated.View style={[
              styles.errorBanner,
              bannerType === 'warning' ? styles.warningBanner : undefined,
              { opacity: bannerOpacity },
            ]}>
              <XCircle size={16} color={bannerType === 'warning' ? '#D97706' : '#DC2626'} />
              <Text style={[styles.errorBannerText, bannerType === 'warning' ? styles.warningBannerText : undefined]}>
                {errorBanner}
              </Text>
            </Animated.View>
          ) : null}

          {/* Manual input */}
          <View style={styles.manualRow}>
            <TextInput
              ref={inputRef}
              style={styles.manualInput}
              placeholder="Inserisci codice manualmente..."
              placeholderTextColor={COLORS.textTertiary}
              value={manualCode}
              onChangeText={handleManualCodeChange}
              onSubmitEditing={handleManualSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.manualSearchBtn, !manualCode.trim() && { opacity: 0.4 }]}
              onPress={handleManualSearch}
              disabled={!manualCode.trim() || processingCode}
              activeOpacity={0.75}
            >
              <Text style={styles.manualSearchBtnText}>Cerca</Text>
            </TouchableOpacity>
          </View>

          {/* Session log */}
          {sessionLog.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionTitle}>Ricevuti in questa sessione</Text>
              {sessionLog.map(entry => (
                <SessionLogRow key={entry.id} entry={entry} />
              ))}
            </View>
          ) : (
            <View style={styles.logEmptyState}>
              <ScanLine size={28} color={COLORS.textTertiary} />
              <Text style={styles.logEmptyText}>
                Scansiona un barcode per iniziare
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Scanner modal */}
      <ScannerModal
        visible={scannerOpen}
        onClose={() => {
          console.log('[Ricezione] Scanner modal closed');
          setScannerOpen(false);
        }}
        onScanned={handleScanned}
        hint="Inquadra il barcode — cerca in tutti i file attivi"
      />

      <ToastMessage
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onHide={hideToast}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 12,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: COLORS.warningMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Progress card
  progressCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  progressPercent: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 4,
  },

  // Column filter
  columnFilterSection: {
    gap: 8,
  },
  columnFilterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  columnToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  columnToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnToggleBtnActive: {
    backgroundColor: '#1A56DB',
    borderColor: '#1A56DB',
  },
  columnToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  columnToggleTextActive: {
    color: '#FFFFFF',
  },

  // Scan button
  scanButton: {
    backgroundColor: '#1A56DB',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#1A56DB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  scanButtonSubtext: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },

  // Error banner
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  warningBanner: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  warningBannerText: {
    color: '#D97706',
  },

  // Manual input row
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  manualInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: COLORS.text,
  },
  manualSearchBtn: {
    backgroundColor: '#1A56DB',
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSearchBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Section title
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Log rows
  logRow: {
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
  },
  logRowFound: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  logRowNotFound: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  logRowDuplicate: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  logCodeDuplicate: {
    color: '#D97706',
  },
  logDuplicateText: {
    fontSize: 12,
    color: '#D97706',
    fontWeight: '500',
  },
  logRowIcon: {
    marginTop: 1,
  },
  logCode: {
    fontSize: 14,
    fontWeight: '700',
  },
  logCodeFound: {
    color: '#15803D',
  },
  logCodeNotFound: {
    color: '#DC2626',
  },
  logMeta: {
    fontSize: 12,
    color: '#16A34A',
    fontWeight: '500',
  },
  logFileName: {
    fontSize: 11,
    color: '#16A34A',
    opacity: 0.8,
  },
  logNotFoundText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '500',
  },
  logTimestamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  logTime: {
    fontSize: 10,
    color: COLORS.textTertiary,
    fontVariant: ['tabular-nums'],
  },

  // Log empty state
  logEmptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  logEmptyText: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
