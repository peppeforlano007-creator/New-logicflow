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
import { Stack, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { ScanLine, CheckCircle2, XCircle, Clock, Package, ArrowLeft } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import type { SupplierFile, SupplierItem } from '@/types';

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
  eanInfo?: string;
}

interface EanItem {
  ean: string;
  item: SupplierItem & { quantita?: number };
  totalQty: number;
}

function SessionLogRow({ entry }: { entry: SessionLogEntry }) {
  const timeStr = entry.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fileNamesStr = entry.fileNames.join(', ');
  const countLabel = entry.count === 1 ? '1 articolo' : `${entry.count} articoli`;

  const rowStyle = entry.found ? styles.logRowFound : entry.duplicate ? styles.logRowDuplicate : styles.logRowNotFound;
  const codeStyle = entry.found ? styles.logCodeFound : entry.duplicate ? styles.logCodeDuplicate : styles.logCodeNotFound;
  const icon = entry.found ? <CheckCircle2 size={18} color="#16A34A" /> : entry.duplicate ? <Clock size={18} color="#D97706" /> : <XCircle size={18} color="#DC2626" />;
  const bottomText = entry.found ? null : entry.duplicate ? <Text style={styles.logDuplicateText}>Già scansionato</Text> : <Text style={styles.logNotFoundText}>Codice non trovato</Text>;

  const hasQty = entry.found && entry.quantita_totale !== undefined && entry.quantita_disponibile !== undefined;
  const qtaDisp = entry.quantita_disponibile ?? 0;
  const qtaTot = entry.quantita_totale ?? 1;
  const qtaColor = qtaDisp > 0 ? '#16A34A' : '#DC2626';

  return (
    <View style={[styles.logRow, rowStyle]}>
      <View style={styles.logRowIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.logCode, codeStyle]} numberOfLines={1}>{entry.code}</Text>
        {entry.found && <Text style={styles.logMeta} numberOfLines={1}>{countLabel}</Text>}
        {hasQty && <Text style={[styles.logMeta, { color: qtaColor }]}>Qtà: {qtaDisp} disponibili su {qtaTot} totali</Text>}
        {entry.eanInfo ? <Text style={[styles.logMeta, { color: '#16A34A' }]}>{entry.eanInfo}</Text> : null}
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

function EanItemRow({ ean, totalQty, received }: { ean: string; totalQty: number; received: number }) {
  const isComplete = received >= totalQty;
  const isPartial = received > 0 && received < totalQty;
  const bgColor = isComplete ? '#DCFCE7' : isPartial ? '#FFF7ED' : COLORS.surfaceSecondary;
  const borderColor = isComplete ? '#BBF7D0' : isPartial ? '#FED7AA' : COLORS.border;
  const textColor = isComplete ? '#15803D' : isPartial ? '#D97706' : COLORS.textSecondary;
  const statusText = isComplete ? '✓' : `${received}/${totalQty}`;
  const statusBg = isComplete ? '#16A34A' : isPartial ? '#D97706' : '#9CA3AF';

  return (
    <View style={[styles.eanItemRow, { backgroundColor: bgColor, borderColor }]}>
      <Text style={[styles.eanItemCode, { color: textColor }]} numberOfLines={1}>{ean}</Text>
      <View style={[styles.eanItemBadge, { backgroundColor: statusBg }]}>
        <Text style={styles.eanItemBadgeText}>{statusText}</Text>
      </View>
    </View>
  );
}

export default function AmazonRicezioneScreen() {
  const router = useRouter();
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
  const [selectedColumn, setSelectedColumn] = useState<'PkgID' | 'LPN' | 'EAN'>('LPN');
  const [eanCounts, setEanCounts] = useState<Record<string, number>>({});
  const [eanItems, setEanItems] = useState<EanItem[]>([]);
  const [loadingEan, setLoadingEan] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [completingRicezione, setCompletingRicezione] = useState(false);
  const errorBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  const loadActiveFiles = useCallback(async () => {
    console.log('[Amazon/Ricezione] loadActiveFiles called');
    setLoading(true);
    try {
      const { data: files, error: filesError } = await db
        .from('supplier_files')
        .select('*')
        .neq('status', 'completed')
        .order('imported_at', { ascending: false });

      if (filesError) { console.error('[Amazon/Ricezione] loadActiveFiles files error:', filesError); throw filesError; }

      const activeFileList = (files ?? []) as SupplierFile[];
      console.log('[Amazon/Ricezione] Active files loaded:', activeFileList.length);

      if (activeFileList.length === 0) {
        setActiveFiles([]); setTotalItems(0); setReceivedItems(0); setLoading(false); return;
      }

      const fileIds = activeFileList.map(f => f.id);
      const [progressResult, receivedResult] = await Promise.all([
        db.from('supplier_file_progress').select('file_id, total_items, completed_items').in('file_id', fileIds),
        db.from('supplier_items').select('id', { count: 'exact', head: true }).in('file_id', fileIds).eq('extra_data->>received', 'true'),
      ]);

      if (progressResult.error) console.error('[Amazon/Ricezione] progress error:', progressResult.error);
      if (receivedResult.error) console.error('[Amazon/Ricezione] receivedCount error:', receivedResult.error);

      const progressRows = (progressResult.data ?? []) as { file_id: string; total_items: number; completed_items: number }[];
      const total = progressRows.reduce((sum, r) => sum + (r.total_items ?? 0), 0);
      const received = receivedResult.count ?? 0;

      console.log('[Amazon/Ricezione] Progress loaded — total:', total, '| received:', received);
      setActiveFiles(activeFileList); setTotalItems(total); setReceivedItems(received);
    } catch (err) {
      console.error('[Amazon/Ricezione] loadActiveFiles exception:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log('[Amazon/Ricezione] Tab focused — reloading active files');
      loadActiveFiles();
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }, [loadActiveFiles]),
  );

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const loadEanItems = useCallback(async (files: SupplierFile[]) => {
    if (files.length === 0) return;
    console.log('[Amazon/Ricezione] loadEanItems called for', files.length, 'files');
    setLoadingEan(true);
    try {
      const fileIds = files.map(f => f.id);
      const { data: rawItems, error } = await db
        .from('supplier_items')
        .select('id, file_id, item_code, original_data, extra_data, status, quantita, quantita_disponibile')
        .in('file_id', fileIds);

      if (error) { console.error('[Amazon/Ricezione] loadEanItems error:', error); return; }

      const items = (rawItems ?? []) as (SupplierItem & { quantita?: number })[];
      const eanMap = new Map<string, EanItem>();
      for (const item of items) {
        const od = item.original_data as Record<string, unknown> | null | undefined;
        if (!od) continue;
        let eanValue: string | null = null;
        for (const key of Object.keys(od)) {
          const lk = key.toLowerCase();
          if (lk === 'ean' || lk.includes('ean') || lk === 'barcode' || lk.includes('barcode')) {
            const val = od[key];
            if (val && String(val).trim()) { eanValue = String(val).trim(); break; }
          }
        }
        if (!eanValue) continue;
        if (!eanMap.has(eanValue)) eanMap.set(eanValue, { ean: eanValue, item, totalQty: item.quantita ?? 1 });
      }

      const eanList = Array.from(eanMap.values());
      console.log('[Amazon/Ricezione] loadEanItems found', eanList.length, 'unique EAN values');
      setEanItems(eanList);

      const initialCounts: Record<string, number> = {};
      for (const { ean, item } of eanList) {
        const savedQty = (item.extra_data as any)?.ean_received_qty;
        if (savedQty != null) initialCounts[ean] = Number(savedQty) || 0;
      }
      setEanCounts(initialCounts);
    } catch (err) {
      console.error('[Amazon/Ricezione] loadEanItems exception:', err);
    } finally {
      setLoadingEan(false);
    }
  }, []);

  useEffect(() => {
    if (selectedColumn === 'EAN' && activeFiles.length > 0) loadEanItems(activeFiles);
  }, [selectedColumn, activeFiles, loadEanItems]);

  const showErrorBanner = useCallback((msg: string) => {
    setBannerType('error');
    setErrorBanner(msg);
    Animated.timing(bannerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (errorBannerTimer.current) clearTimeout(errorBannerTimer.current);
    errorBannerTimer.current = setTimeout(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setErrorBanner(null));
    }, 3000);
  }, [bannerOpacity]);

  const showWarningBanner = useCallback((msg: string) => {
    setBannerType('warning');
    setErrorBanner(msg);
    Animated.timing(bannerOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (errorBannerTimer.current) clearTimeout(errorBannerTimer.current);
    errorBannerTimer.current = setTimeout(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setErrorBanner(null));
    }, 3000);
  }, [bannerOpacity]);

  const processCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (processingCode) return;
    setProcessingCode(true);
    console.log('[Amazon/Ricezione] processCode start:', trimmed, '| selectedColumn:', selectedColumn);

    try {
      const activeFileIds = activeFiles.map(f => f.id);
      if (activeFileIds.length === 0) { showToast('Nessun file attivo', 'error'); return; }

      if (selectedColumn === 'EAN') {
        let matchedItem: (SupplierItem & { quantita?: number }) | null = null;
        if (eanItems.length > 0) {
          const eanEntry = eanItems.find(e => e.ean === trimmed);
          matchedItem = eanEntry?.item ?? null;
        } else {
          const { data: rawItems, error: searchError } = await db
            .from('supplier_items')
            .select('id, file_id, item_code, original_data, extra_data, status, quantita, quantita_disponibile')
            .in('file_id', activeFileIds);
          if (searchError) throw searchError;
          const allItems = (rawItems ?? []) as (SupplierItem & { quantita?: number })[];
          for (const item of allItems) {
            const od = item.original_data as Record<string, unknown> | null | undefined;
            if (!od) continue;
            for (const key of Object.keys(od)) {
              const lk = key.toLowerCase();
              if (lk === 'ean' || lk.includes('ean') || lk === 'barcode' || lk.includes('barcode')) {
                if (String(od[key] ?? '').trim() === trimmed) { matchedItem = item; break; }
              }
            }
            if (matchedItem) break;
          }
        }

        const logId = `${Date.now()}-${Math.random()}`;
        if (!matchedItem) {
          setSessionLog(prev => [{ id: logId, code: trimmed, found: false, fileNames: [], count: 0, timestamp: new Date() }, ...prev.slice(0, 19)]);
          showToast(`⚠ EAN non trovato: ${trimmed}`, 'error');
          showErrorBanner(`EAN non trovato: ${trimmed}`);
          return;
        }

        const quantita = matchedItem.quantita ?? 1;
        const currentCount = eanCounts[trimmed] ?? 0;
        if (currentCount >= quantita) {
          const msg = `Quantità massima raggiunta: ${trimmed} (${quantita}/${quantita})`;
          showErrorBanner(msg); showToast(msg, 'error');
          setSessionLog(prev => [{ id: logId, code: trimmed, found: false, duplicate: true, fileNames: [], count: 0, timestamp: new Date() }, ...prev.slice(0, 19)]);
          return;
        }

        const newCount = currentCount + 1;
        setEanCounts(prev => ({ ...prev, [trimmed]: newCount }));
        setSelectAll(false);

        const currentExtraData = (matchedItem.extra_data as Record<string, unknown>) ?? {};
        db.from('supplier_items').update({ extra_data: { ...currentExtraData, ean_received_qty: newCount } }).eq('id', matchedItem.id)
          .then(({ error: eanUpdateErr }) => {
            if (eanUpdateErr) console.error('[Amazon/Ricezione] EAN ean_received_qty update error:', eanUpdateErr);
          });

        const eanInfo = `${newCount}/${quantita} unità ricevute`;
        const activeFileMap = new Map<string, SupplierFile>(activeFiles.map(f => [f.id, f]));
        const file = activeFileMap.get(matchedItem.file_id);
        const fileNames = file ? [file.file_name] : [];
        setSessionLog(prev => [{ id: logId, code: trimmed, found: true, fileNames, count: 1, timestamp: new Date(), eanInfo }, ...prev.slice(0, 19)]);
        showToast(`EAN ${trimmed} — ${newCount}/${quantita} unità`, 'success');
        return;
      }

      const { data: matchedRaw, error: searchError } = await db
        .from('supplier_items')
        .select('id, file_id, item_code, original_data, extra_data, status, quantita, quantita_disponibile')
        .in('file_id', activeFileIds)
        .or(`item_code.eq.${trimmed},original_data->>LPN.eq.${trimmed},original_data->>ASIN.eq.${trimmed},original_data->>PkgID.eq.${trimmed},extra_data->>SKU.eq.${trimmed}`);

      if (searchError) throw searchError;

      const matched = (matchedRaw ?? []) as (SupplierItem & { quantita?: number; quantita_disponibile?: number })[];
      const logId = `${Date.now()}-${Math.random()}`;
      const now = new Date().toISOString();

      if (matched.length === 0) {
        setSessionLog(prev => [{ id: logId, code: trimmed, found: false, fileNames: [], count: 0, timestamp: new Date() }, ...prev.slice(0, 19)]);
        showToast(`⚠ Codice non trovato: ${trimmed}`, 'error');
        showErrorBanner(`Codice non trovato: ${trimmed}`);
        return;
      }

      const alreadyReceived = matched.every(item => item.extra_data?.received === 'true');
      if (alreadyReceived) {
        showToast('Codice già scansionato e già in fase di lavorazione', 'warning');
        showWarningBanner('Codice già scansionato e già in fase di lavorazione');
        setSessionLog(prev => [{ id: logId, code: trimmed, found: false, duplicate: true, fileNames: [], count: 0, timestamp: new Date() }, ...prev.slice(0, 19)]);
        return;
      }

      const firstItem = matched[0];
      const qtaTotale = firstItem.quantita ?? 1;
      const qtaDisponibile = firstItem.quantita_disponibile ?? 1;
      const activeFileMap = new Map<string, SupplierFile>(activeFiles.map(f => [f.id, f]));
      const fileMap = new Map<string, { file: SupplierFile; items: (SupplierItem & { quantita?: number; quantita_disponibile?: number })[] }>();

      for (const item of matched) {
        const file = activeFileMap.get(item.file_id);
        if (!file) continue;
        const existing = fileMap.get(item.file_id);
        if (existing) existing.items.push(item);
        else fileMap.set(item.file_id, { file, items: [item] });
      }

      for (const item of matched) {
        const { error: itemErr } = await db.from('supplier_items').update({
          status: 'processing',
          original_data: { ...item.original_data, AdjReason: '' },
          extra_data: { ...item.extra_data, received: 'true', received_at: now },
        }).eq('id', item.id);
        if (itemErr) console.error('[Amazon/Ricezione] item update error:', itemErr, item.id);
      }

      for (const [fileId, { file }] of fileMap.entries()) {
        const currentExtraColumns: string[] = file.extra_columns ?? [];
        const newColumns = ['received', 'received_at'].filter(c => !currentExtraColumns.includes(c));
        if (newColumns.length > 0) {
          const { error: colErr } = await db.from('supplier_files').update({ extra_columns: [...currentExtraColumns, ...newColumns] }).eq('id', fileId);
          if (colErr) console.error('[Amazon/Ricezione] extra_columns update error:', colErr);
        }
      }

      for (const [fileId, { file }] of fileMap.entries()) {
        if (file.status !== 'processing' && file.status !== 'received' && file.status !== 'completed') {
          const { error: fileStatusErr } = await db.from('supplier_files').update({ status: 'processing' }).eq('id', fileId);
          if (fileStatusErr) console.error('[Amazon/Ricezione] file status update error:', fileStatusErr);
        }
      }

      const involvedFileIds = new Set(fileMap.keys());
      setActiveFiles(prev => prev.map(file =>
        involvedFileIds.has(file.id) && file.status !== 'processing' && file.status !== 'received' && file.status !== 'completed'
          ? { ...file, status: 'processing' as SupplierFile['status'] } : file,
      ));

      const newlyReceived = matched.filter(item => item.extra_data?.received !== 'true').length;
      if (newlyReceived > 0) setReceivedItems(prev => prev + newlyReceived);

      const fileNames = Array.from(fileMap.values()).map(v => v.file.file_name);
      setSessionLog(prev => [{ id: logId, code: trimmed, found: true, fileNames, count: matched.length, timestamp: new Date(), quantita_totale: qtaTotale, quantita_disponibile: qtaDisponibile }, ...prev.slice(0, 19)]);
      showToast(`${matched.length === 1 ? '1 articolo ricevuto' : `${matched.length} articoli ricevuti`} — ${fileNames.length === 1 ? fileNames[0] : `${fileNames.length} file`}`, 'success');
    } catch (err: any) {
      console.error('[Amazon/Ricezione] processCode error:', err);
      showToast(err?.message ?? 'Errore durante la scansione', 'error');
    } finally {
      setProcessingCode(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [activeFiles, eanItems, processingCode, selectedColumn, eanCounts, showToast, showErrorBanner, showWarningBanner]);

  const handleScanned = useCallback((code: string) => {
    console.log('[Amazon/Ricezione] handleScanned from camera:', code);
    setScannerOpen(false);
    processCode(code);
  }, [processCode]);

  const handleManualCodeChange = useCallback((text: string) => {
    if (text.endsWith('\n') || text.endsWith('\r')) {
      const finalCode = text.replace(/[\r\n]/g, '').trim();
      if (finalCode) { console.log('[Amazon/Ricezione] Barcode reader newline detected, processing code:', finalCode); processCode(finalCode); setManualCode(''); setTimeout(() => inputRef.current?.focus(), 50); }
      return;
    }
    setManualCode(text);
  }, [processCode]);

  const handleManualSearch = useCallback(() => {
    console.log('[Amazon/Ricezione] handleManualSearch pressed, code:', manualCode);
    if (!manualCode.trim()) return;
    processCode(manualCode.trim());
    setManualCode('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [manualCode, processCode]);

  const handleColumnToggle = useCallback((col: 'PkgID' | 'LPN' | 'EAN') => {
    console.log('[Amazon/Ricezione] Column toggle pressed:', col);
    if (col !== 'EAN') { setEanCounts({}); setSelectAll(false); }
    setSelectedColumn(col);
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) { setEanCounts({}); setSelectAll(false); }
    else {
      const allCounts: Record<string, number> = {};
      for (const { ean, totalQty } of eanItems) allCounts[ean] = totalQty;
      setEanCounts(allCounts); setSelectAll(true);
    }
  }, [selectAll, eanItems]);

  const handleCompletaRicezione = useCallback(async () => {
    console.log('[Amazon/Ricezione] handleCompletaRicezione pressed');
    const itemsToUpdate = eanItems.filter(({ ean }) => (eanCounts[ean] ?? 0) > 0);
    if (itemsToUpdate.length === 0) return;
    setCompletingRicezione(true);
    const now = new Date().toISOString();
    try {
      const updatePromises = itemsToUpdate.map(({ ean, item }) => {
        const qty = eanCounts[ean] ?? 0;
        return db.from('supplier_items').update({
          status: 'processing',
          extra_data: { ...(item.extra_data as Record<string, unknown> ?? {}), ean_received_qty: qty, received: 'true', received_at: now },
        }).eq('id', item.id);
      });
      const results = await Promise.all(updatePromises);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) console.error('[Amazon/Ricezione] handleCompletaRicezione — some updates failed:', errors.map(r => r.error));
      const updatedCount = results.length - errors.length;
      setReceivedItems(prev => prev + updatedCount);
      showToast(`Ricezione completata — ${updatedCount} articoli aggiornati`, 'success');
      loadActiveFiles();
      loadEanItems(activeFiles);
    } catch (err: any) {
      console.error('[Amazon/Ricezione] handleCompletaRicezione exception:', err);
      showToast(err?.message ?? 'Errore durante il completamento', 'error');
    } finally {
      setCompletingRicezione(false);
    }
  }, [eanItems, eanCounts, activeFiles, showToast, loadActiveFiles, loadEanItems]);

  const progressRatio = totalItems > 0 ? receivedItems / totalItems : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const hasActiveFiles = activeFiles.length > 0;
  const eanTotalUnits = eanItems.reduce((sum, ei) => sum + ei.totalQty, 0);
  const eanScannedUnits = Object.values(eanCounts).reduce((sum, v) => sum + v, 0);
  const progressLabel = selectedColumn === 'EAN'
    ? `${eanScannedUnits} / ${eanTotalUnits} unità scansionate`
    : `${receivedItems} articoli ricevuti su ${totalItems} totali`;
  const scanButtonSubtext = `Cerca per: ${selectedColumn}`;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen
        options={{
          title: 'Ricezione — Amazon',
          headerShown: true,
          headerLeft: () => (
            <TouchableOpacity onPress={() => { console.log('[Amazon/Ricezione] Back button pressed'); router.back(); }} style={{ marginRight: 8 }}>
              <ArrowLeft size={22} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        }}
      />

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator color={COLORS.primary} size="large" /></View>
      ) : !hasActiveFiles ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}><Package size={36} color={COLORS.warning} /></View>
          <Text style={styles.emptyTitle}>Nessun file attivo da ricevere</Text>
          <Text style={styles.emptySubtitle}>Importa prima un file nella sezione Import per iniziare la ricezione.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>{progressLabel}</Text>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` as any }]} />
            </View>
          </View>

          <View style={styles.columnFilterSection}>
            <Text style={styles.columnFilterLabel}>Cerca per:</Text>
            <View style={styles.columnToggleRow}>
              {(['PkgID', 'LPN', 'EAN'] as const).map(col => (
                <TouchableOpacity key={col} style={[styles.columnToggleBtn, selectedColumn === col && styles.columnToggleBtnActive]} onPress={() => handleColumnToggle(col)} activeOpacity={0.75}>
                  <Text style={[styles.columnToggleText, selectedColumn === col && styles.columnToggleTextActive]}>{col}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <AnimatedPressable onPress={() => { console.log('[Amazon/Ricezione] Open scanner button pressed'); setScannerOpen(true); }} disabled={processingCode}>
            <View style={[styles.scanButton, processingCode && { opacity: 0.6 }]}>
              {processingCode ? <ActivityIndicator color="#FFFFFF" size="small" /> : <ScanLine size={24} color="#FFFFFF" />}
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.scanButtonText}>Scansiona Barcode</Text>
                <Text style={styles.scanButtonSubtext}>{scanButtonSubtext}</Text>
              </View>
            </View>
          </AnimatedPressable>

          {errorBanner ? (
            <Animated.View style={[styles.errorBanner, bannerType === 'warning' ? styles.warningBanner : undefined, { opacity: bannerOpacity }]}>
              <XCircle size={16} color={bannerType === 'warning' ? '#D97706' : '#DC2626'} />
              <Text style={[styles.errorBannerText, bannerType === 'warning' ? styles.warningBannerText : undefined]}>{errorBanner}</Text>
            </Animated.View>
          ) : null}

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
            <TouchableOpacity style={[styles.manualSearchBtn, !manualCode.trim() && { opacity: 0.4 }]} onPress={handleManualSearch} disabled={!manualCode.trim() || processingCode} activeOpacity={0.75}>
              <Text style={styles.manualSearchBtnText}>Cerca</Text>
            </TouchableOpacity>
          </View>

          {selectedColumn === 'EAN' && (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionTitle}>Articoli EAN nei file attivi</Text>
              {loadingEan ? (
                <ActivityIndicator color={COLORS.primary} size="small" style={{ marginVertical: 12 }} />
              ) : eanItems.length === 0 ? (
                <View style={styles.eanEmptyState}><Text style={styles.eanEmptyText}>Nessun articolo con EAN trovato nei file attivi</Text></View>
              ) : (
                <>
                  <TouchableOpacity style={styles.selectAllRow} onPress={handleSelectAll} activeOpacity={0.75}>
                    <View style={[styles.selectAllCheckbox, selectAll && styles.selectAllCheckboxActive]}>
                      {selectAll ? <Text style={styles.selectAllCheckmark}>✓</Text> : null}
                    </View>
                    <Text style={styles.selectAllText}>Seleziona tutto</Text>
                  </TouchableOpacity>
                  {eanItems.map(ei => <EanItemRow key={ei.ean} ean={ei.ean} totalQty={ei.totalQty} received={eanCounts[ei.ean] ?? 0} />)}
                  {(() => {
                    const hasAny = eanItems.some(({ ean }) => (eanCounts[ean] ?? 0) > 0);
                    return (
                      <TouchableOpacity style={[styles.completaBtn, (!hasAny || completingRicezione) && { opacity: 0.4 }]} onPress={handleCompletaRicezione} disabled={!hasAny || completingRicezione} activeOpacity={0.8}>
                        {completingRicezione ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                        <Text style={styles.completaBtnText}>{completingRicezione ? 'Salvataggio...' : 'Completa Ricezione'}</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </>
              )}
            </View>
          )}

          {sessionLog.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionTitle}>Ricevuti in questa sessione</Text>
              {sessionLog.map(entry => <SessionLogRow key={entry.id} entry={entry} />)}
            </View>
          ) : (
            <View style={styles.logEmptyState}>
              <ScanLine size={28} color={COLORS.textTertiary} />
              <Text style={styles.logEmptyText}>Scansiona un barcode per iniziare</Text>
            </View>
          )}
        </ScrollView>
      )}

      <ScannerModal
        visible={scannerOpen}
        onClose={() => { console.log('[Amazon/Ricezione] Scanner modal closed'); setScannerOpen(false); }}
        onScanned={handleScanned}
        hint="Inquadra il barcode — cerca in tutti i file attivi"
      />

      <ToastMessage message={toast.message} type={toast.type} visible={toast.visible} onHide={hideToast} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 16, paddingBottom: 120, gap: 14 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 12 },
  emptyIconWrap: { width: 76, height: 76, borderRadius: 22, backgroundColor: COLORS.warningMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  progressCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: 14, fontWeight: '600', color: COLORS.text, flex: 1, marginRight: 8 },
  progressPercent: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  progressBarBg: { height: 8, backgroundColor: COLORS.surfaceSecondary, borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: 8, backgroundColor: COLORS.accent, borderRadius: 4 },
  columnFilterSection: { gap: 8 },
  columnFilterLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, letterSpacing: 0.2 },
  columnToggleRow: { flexDirection: 'row', gap: 8 },
  columnToggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  columnToggleBtnActive: { backgroundColor: '#1A56DB', borderColor: '#1A56DB' },
  columnToggleText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  columnToggleTextActive: { color: '#FFFFFF' },
  scanButton: { backgroundColor: '#1A56DB', borderRadius: 14, paddingVertical: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 12, shadowColor: '#1A56DB', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  scanButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  scanButtonSubtext: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '500', marginTop: 2 },
  errorBanner: { backgroundColor: '#FEE2E2', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#FECACA' },
  errorBannerText: { color: '#DC2626', fontSize: 13, fontWeight: '600', flex: 1 },
  warningBanner: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  warningBannerText: { color: '#D97706' },
  manualRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  manualInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: COLORS.text },
  manualSearchBtn: { backgroundColor: '#1A56DB', paddingHorizontal: 18, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  manualSearchBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  eanItemRow: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1 },
  eanItemCode: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  eanItemBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, minWidth: 36, alignItems: 'center' },
  eanItemBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  eanEmptyState: { alignItems: 'center', paddingVertical: 20 },
  eanEmptyText: { fontSize: 13, color: COLORS.textTertiary, textAlign: 'center' },
  logRow: { borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1 },
  logRowFound: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  logRowNotFound: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  logRowDuplicate: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  logCodeDuplicate: { color: '#D97706' },
  logDuplicateText: { fontSize: 12, color: '#D97706', fontWeight: '500' },
  logRowIcon: { marginTop: 1 },
  logCode: { fontSize: 14, fontWeight: '700' },
  logCodeFound: { color: '#15803D' },
  logCodeNotFound: { color: '#DC2626' },
  logMeta: { fontSize: 12, color: '#16A34A', fontWeight: '500' },
  logFileName: { fontSize: 11, color: '#16A34A', opacity: 0.8 },
  logNotFoundText: { fontSize: 12, color: '#DC2626', fontWeight: '500' },
  logTimestamp: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  logTime: { fontSize: 10, color: COLORS.textTertiary, fontVariant: ['tabular-nums'] },
  logEmptyState: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  logEmptyText: { fontSize: 14, color: COLORS.textTertiary, textAlign: 'center' },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  selectAllCheckbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  selectAllCheckboxActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  selectAllCheckmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  selectAllText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  completaBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  completaBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
