import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  ScanLine,
  CheckCircle2,
  CheckCircle,
  Package,
  Tag,
  Barcode,
} from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import type { SupplierFile, SupplierItem } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanMode = 'pkgid' | 'lpn' | 'ean';

interface PkgGroup {
  pkgId: string;
  items: SupplierItem[];
  isReceived: boolean;
}

interface LpnRow {
  lpnValue: string;
  item: SupplierItem;
  isReceived: boolean;
}

interface EanRow {
  eanValue: string;
  item: SupplierItem;
  receivedQty: number;
  totalQty: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectEanColumn(items: SupplierItem[]): string | null {
  if (items.length === 0) return null;
  const keys = Object.keys(items[0].original_data ?? {});
  return (
    keys.find(k => k.toLowerCase().includes('ean')) ??
    keys.find(k => k.toLowerCase().includes('barcode')) ??
    null
  );
}

function groupByPkgId(items: SupplierItem[], column: string): PkgGroup[] {
  const map = new Map<string, SupplierItem[]>();
  for (const item of items) {
    const raw = item.original_data?.[column] ?? '';
    const key = String(raw).trim() || '__NO_PKGID__';
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }
  const groups: PkgGroup[] = [];
  map.forEach((groupItems, pkgId) => {
    const isReceived = groupItems.every(i => i.extra_data?.received === 'true');
    groups.push({ pkgId, items: groupItems, isReceived });
  });
  groups.sort((a, b) => {
    if (a.isReceived === b.isReceived) return a.pkgId.localeCompare(b.pkgId);
    return a.isReceived ? 1 : -1;
  });
  return groups;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PkgGroupCard({ group }: { group: PkgGroup }) {
  const itemCount = group.items.length;
  const itemCountLabel = itemCount === 1 ? '1 articolo' : `${itemCount} articoli`;
  const itemCodes = group.items.map(i => i.item_code).filter(Boolean).join(', ');

  if (group.isReceived) {
    return (
      <View style={styles.groupCardReceived}>
        <View style={styles.groupCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupPkgIdReceived}>{group.pkgId}</Text>
            <Text style={styles.groupCountReceived}>{itemCountLabel}</Text>
          </View>
          <CheckCircle2 size={28} color="#16A34A" />
        </View>
        {itemCodes ? (
          <Text style={styles.groupItemCodesReceived} numberOfLines={2}>
            {itemCodes}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.groupCard}>
      <View style={styles.groupCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupPkgId}>{group.pkgId}</Text>
          <Text style={styles.groupCount}>{itemCountLabel}</Text>
        </View>
        <View style={styles.groupBadgePending}>
          <Text style={styles.groupBadgePendingText}>Da scansionare</Text>
        </View>
      </View>
      {itemCodes ? (
        <Text style={styles.groupItemCodes} numberOfLines={2}>
          {itemCodes}
        </Text>
      ) : null}
    </View>
  );
}

function LpnRowCard({ row }: { row: LpnRow }) {
  const itemCode = row.item.item_code ?? '';

  if (row.isReceived) {
    return (
      <View style={styles.groupCardReceived}>
        <View style={styles.groupCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupPkgIdReceived}>{row.lpnValue}</Text>
            {itemCode ? <Text style={styles.groupCountReceived}>{itemCode}</Text> : null}
          </View>
          <CheckCircle2 size={24} color="#16A34A" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.groupCard}>
      <View style={styles.groupCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupPkgId}>{row.lpnValue}</Text>
          {itemCode ? <Text style={styles.groupCount}>{itemCode}</Text> : null}
        </View>
        <View style={styles.groupBadgePending}>
          <Text style={styles.groupBadgePendingText}>Da scansionare</Text>
        </View>
      </View>
    </View>
  );
}

function EanRowCard({ row }: { row: EanRow }) {
  const isComplete = row.receivedQty >= row.totalQty;
  const isPartial = row.receivedQty > 0 && !isComplete;
  const qtyLabel = `${row.receivedQty}/${row.totalQty}`;
  const itemCode = row.item.item_code ?? '';

  if (isComplete) {
    return (
      <View style={styles.groupCardReceived}>
        <View style={styles.groupCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupPkgIdReceived}>{row.eanValue}</Text>
            {itemCode ? <Text style={styles.groupCountReceived}>{itemCode}</Text> : null}
          </View>
          <View style={styles.eanQtyBadgeGreen}>
            <Text style={styles.eanQtyBadgeGreenText}>{qtyLabel}</Text>
          </View>
          <CheckCircle2 size={22} color="#16A34A" />
        </View>
      </View>
    );
  }

  if (isPartial) {
    return (
      <View style={styles.eanCardPartial}>
        <View style={styles.groupCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eanPkgIdPartial}>{row.eanValue}</Text>
            {itemCode ? <Text style={styles.eanCountPartial}>{itemCode}</Text> : null}
          </View>
          <View style={styles.eanQtyBadgeYellow}>
            <Text style={styles.eanQtyBadgeYellowText}>{qtyLabel}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.groupCard}>
      <View style={styles.groupCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupPkgId}>{row.eanValue}</Text>
          {itemCode ? <Text style={styles.groupCount}>{itemCode}</Text> : null}
        </View>
        <View style={styles.groupBadgePending}>
          <Text style={styles.groupBadgePendingText}>{qtyLabel}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Mode Selector ────────────────────────────────────────────────────────────

interface ModeSelectorProps {
  currentMode: ScanMode | null;
  pkgidAvailable: boolean;
  lpnAvailable: boolean;
  eanAvailable: boolean;
  onSelect: (mode: ScanMode) => void;
}

function ModeSelector({ currentMode, pkgidAvailable, lpnAvailable, eanAvailable, onSelect }: ModeSelectorProps) {
  const modes: { mode: ScanMode; label: string; subtitle: string; icon: React.ReactNode; available: boolean }[] = [
    {
      mode: 'pkgid',
      label: 'PkgID',
      subtitle: 'Scansiona collo, riceve tutti gli articoli',
      icon: <Package size={20} color={currentMode === 'pkgid' ? '#1A56DB' : COLORS.textSecondary} />,
      available: pkgidAvailable,
    },
    {
      mode: 'lpn',
      label: 'LPN',
      subtitle: 'Scansiona unità fisica singola',
      icon: <Tag size={20} color={currentMode === 'lpn' ? '#7C3AED' : COLORS.textSecondary} />,
      available: lpnAvailable,
    },
    {
      mode: 'ean',
      label: 'EAN',
      subtitle: 'Scansiona codice articolo, conta unità',
      icon: <Barcode size={20} color={currentMode === 'ean' ? COLORS.primary : COLORS.textSecondary} />,
      available: eanAvailable,
    },
  ];

  return (
    <View style={styles.modeSelectorCard}>
      <Text style={styles.modeSelectorTitle}>Modalità di scansione</Text>
      <View style={styles.modeSelectorRow}>
        {modes.map(({ mode, label, subtitle, icon, available }) => {
          const isActive = currentMode === mode;
          const activeColor = mode === 'pkgid' ? '#1A56DB' : mode === 'lpn' ? '#7C3AED' : COLORS.primary;
          return (
            <TouchableOpacity
              key={mode}
              style={[
                styles.modeCard,
                isActive && { borderColor: activeColor, borderWidth: 2, backgroundColor: `${activeColor}10` },
                !available && styles.modeCardDisabled,
              ]}
              onPress={() => {
                console.log('[Reception] Mode selected:', mode);
                if (available) onSelect(mode);
              }}
              activeOpacity={available ? 0.7 : 1}
              disabled={!available}
            >
              {icon}
              <Text style={[styles.modeCardLabel, isActive && { color: activeColor }, !available && styles.modeCardLabelDisabled]}>
                {label}
              </Text>
              <Text style={[styles.modeCardSubtitle, !available && styles.modeCardLabelDisabled]} numberOfLines={2}>
                {available ? subtitle : 'Non configurato'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ReceptionScreen() {
  const { fileId } = useLocalSearchParams<{ fileId: string }>();
  const { toast, showToast, hideToast } = useToast();

  const [file, setFile] = useState<SupplierFile | null>(null);
  const [items, setItems] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [processingCode, setProcessingCode] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode | null>(null);
  // EAN local counters: eanValue → count scanned this session
  const [eanCounts, setEanCounts] = useState<Record<string, number>>({});

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    console.log('[Reception] fetchData called', { fileId });
    try {
      const [fileRes, itemsRes] = await Promise.all([
        db.from('supplier_files').select('*').eq('id', fileId).single(),
        db.from('supplier_items').select('*').eq('file_id', fileId).order('row_index', { ascending: true }),
      ]);

      if (fileRes.error) {
        console.error('[Reception] file fetch error:', fileRes.error);
        throw fileRes.error;
      }
      if (itemsRes.error) {
        console.error('[Reception] items fetch error:', itemsRes.error);
        throw itemsRes.error;
      }

      const fetchedFile = fileRes.data as SupplierFile;
      const fetchedItems = (itemsRes.data ?? []) as SupplierItem[];
      console.log('[Reception] fetchData success, items:', fetchedItems.length);
      setFile(fetchedFile);
      setItems(fetchedItems);

      // Auto-detect scan mode
      let detectedMode: ScanMode | null = null;
      if (fetchedFile.pkgid_column) {
        detectedMode = 'pkgid';
      } else if (fetchedFile.lpn_column) {
        detectedMode = 'lpn';
      } else {
        const eanCol = detectEanColumn(fetchedItems);
        if (eanCol) detectedMode = 'ean';
      }
      console.log('[Reception] Auto-detected scan mode:', detectedMode);
      setScanMode(detectedMode);

      // Restore EAN counts from DB extra_data
      if (detectedMode === 'ean' || !detectedMode) {
        const eanCol = fetchedFile.asin_column?.toLowerCase().includes('ean')
          ? fetchedFile.asin_column
          : detectEanColumn(fetchedItems);
        if (eanCol) {
          const restored: Record<string, number> = {};
          for (const item of fetchedItems) {
            const eanVal = String(item.original_data?.[eanCol] ?? '').trim();
            if (!eanVal) continue;
            const storedQty = Number(item.extra_data?.ean_received_qty ?? 0);
            if (storedQty > 0) restored[eanVal] = storedQty;
          }
          console.log('[Reception] Restored EAN counts from DB:', Object.keys(restored).length, 'entries');
          setEanCounts(restored);
        }
      }
    } catch (err) {
      console.error('[Reception] fetchData exception:', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived column values ──────────────────────────────────────────────────

  const eanColumn = useMemo(() => {
    if (!file) return null;
    if (file.asin_column?.toLowerCase().includes('ean')) return file.asin_column;
    return detectEanColumn(items);
  }, [file, items]);

  const pkgidAvailable = Boolean(file?.pkgid_column);
  const lpnAvailable = Boolean(file?.lpn_column);
  const eanAvailable = Boolean(eanColumn);

  // ── Handle mode change ─────────────────────────────────────────────────────

  const handleModeChange = useCallback((mode: ScanMode) => {
    console.log('[Reception] Changing scan mode to:', mode, '(resetting EAN counts)');
    setScanMode(mode);
    setEanCounts({});
  }, []);

  // ── PkgID scan handler ─────────────────────────────────────────────────────

  const handlePkgIdScan = useCallback(async (code: string) => {
    const column = file?.pkgid_column;
    if (!column) return;
    console.log('[Reception][PkgID] handlePkgIdScan', { code, column });

    const normalizedCode = code.trim().toLowerCase();
    const matched = items.filter(item => {
      const val = item.original_data?.[column] ?? '';
      return String(val).trim().toLowerCase() === normalizedCode;
    });

    if (matched.length === 0) {
      console.log('[Reception][PkgID] No items found for code:', code);
      showToast(`PkgID non trovato: ${code}`, 'error');
      return;
    }

    const alreadyReceived = matched.every(item => item.extra_data?.received === 'true');
    if (alreadyReceived) {
      console.log('[Reception][PkgID] Already received:', code);
      showToast(`PkgID già scansionato: ${code}`, 'error');
      return;
    }

    console.log('[Reception][PkgID] Marking', matched.length, 'items for pkgid:', code);

    // Ensure extra_columns
    const currentExtraColumns: string[] = file?.extra_columns ?? [];
    const newColumns = ['received', 'received_at'].filter(c => !currentExtraColumns.includes(c));
    if (newColumns.length > 0) {
      const { error: colErr } = await db
        .from('supplier_files')
        .update({ extra_columns: [...currentExtraColumns, ...newColumns] })
        .eq('id', fileId);
      if (colErr) console.error('[Reception][PkgID] extra_columns update error:', colErr);
      else setFile(prev => prev ? { ...prev, extra_columns: [...currentExtraColumns, ...newColumns] } : prev);
    }

    const now = new Date().toISOString();
    for (const item of matched) {
      const { error: itemErr } = await db
        .from('supplier_items')
        .update({
          status: 'processing',
          extra_data: { ...item.extra_data, received: 'true', received_at: now },
        })
        .eq('id', item.id);
      if (itemErr) console.error('[Reception][PkgID] item update error:', itemErr, item.id);
    }

    setItems(prev =>
      prev.map(item => {
        const val = item.original_data?.[column] ?? '';
        if (String(val).trim().toLowerCase() !== normalizedCode) return item;
        return { ...item, status: 'processing' as const, extra_data: { ...item.extra_data, received: 'true', received_at: now } };
      }),
    );

    const countLabel = matched.length === 1 ? '1 articolo ricevuto' : `${matched.length} articoli ricevuti`;
    showToast(`${countLabel} per PkgID: ${code}`, 'success');
    console.log('[Reception][PkgID] Success', { code, count: matched.length });
  }, [file, items, fileId, showToast]);

  // ── LPN scan handler ───────────────────────────────────────────────────────

  const handleLpnScan = useCallback(async (code: string) => {
    const column = file?.lpn_column;
    if (!column) return;
    console.log('[Reception][LPN] handleLpnScan', { code, column });

    const normalizedCode = code.trim().toLowerCase();
    const matched = items.find(item => {
      const val = item.original_data?.[column] ?? '';
      return String(val).trim().toLowerCase() === normalizedCode;
    });

    if (!matched) {
      console.log('[Reception][LPN] LPN not found:', code);
      showToast(`LPN non trovato: ${code}`, 'error');
      return;
    }

    if (matched.extra_data?.received === 'true') {
      console.log('[Reception][LPN] LPN already scanned:', code);
      showToast(`LPN già scansionato: ${code}`, 'warning');
      return;
    }

    console.log('[Reception][LPN] Marking item as received, id:', matched.id);

    const now = new Date().toISOString();
    const { error: itemErr } = await db
      .from('supplier_items')
      .update({
        status: 'processing',
        extra_data: { ...matched.extra_data, received: 'true', received_at: now },
      })
      .eq('id', matched.id);

    if (itemErr) {
      console.error('[Reception][LPN] item update error:', itemErr);
      showToast('Errore durante l\'aggiornamento', 'error');
      return;
    }

    setItems(prev =>
      prev.map(item =>
        item.id === matched.id
          ? { ...item, status: 'processing' as const, extra_data: { ...item.extra_data, received: 'true', received_at: now } }
          : item,
      ),
    );

    showToast(`LPN ricevuto: ${code}`, 'success');
    console.log('[Reception][LPN] Success', { code, itemId: matched.id });
  }, [file, items, showToast]);

  // ── EAN scan handler ───────────────────────────────────────────────────────

  const handleEanScan = useCallback(async (code: string) => {
    if (!eanColumn) return;
    console.log('[Reception][EAN] handleEanScan', { code, eanColumn });

    const normalizedCode = code.trim().toLowerCase();
    const matched = items.find(item => {
      const val = item.original_data?.[eanColumn] ?? '';
      return String(val).trim().toLowerCase() === normalizedCode;
    });

    if (!matched) {
      console.log('[Reception][EAN] EAN not found:', code);
      showToast(`EAN non trovato: ${code}`, 'error');
      return;
    }

    const eanKey = String(matched.original_data?.[eanColumn] ?? '').trim();
    const totalQty = matched.quantita ?? 1;
    const currentCount = eanCounts[eanKey] ?? 0;

    if (currentCount >= totalQty) {
      console.log('[Reception][EAN] Max quantity reached for:', eanKey, `(${currentCount}/${totalQty})`);
      showToast(`Quantità massima raggiunta per ${eanKey} (${totalQty}/${totalQty})`, 'error');
      return;
    }

    const newCount = currentCount + 1;
    console.log('[Reception][EAN] Incrementing count for', eanKey, ':', currentCount, '->', newCount, '/', totalQty);

    const isNowComplete = newCount >= totalQty;
    const updatePayload: Record<string, unknown> = {
      extra_data: {
        ...matched.extra_data,
        ean_received_qty: String(newCount),
        ...(isNowComplete ? { received: 'true', received_at: new Date().toISOString() } : {}),
      },
      ...(isNowComplete ? { status: 'processing' } : {}),
    };

    const { error: itemErr } = await db
      .from('supplier_items')
      .update(updatePayload)
      .eq('id', matched.id);

    if (itemErr) {
      console.error('[Reception][EAN] item update error:', itemErr);
      showToast('Errore durante l\'aggiornamento', 'error');
      return;
    }

    // Update local eanCounts
    setEanCounts(prev => ({ ...prev, [eanKey]: newCount }));

    // Optimistic local items update
    setItems(prev =>
      prev.map(item => {
        if (item.id !== matched.id) return item;
        return {
          ...item,
          status: isNowComplete ? ('processing' as const) : item.status,
          extra_data: {
            ...item.extra_data,
            ean_received_qty: String(newCount),
            ...(isNowComplete ? { received: 'true', received_at: new Date().toISOString() } : {}),
          },
        };
      }),
    );

    if (isNowComplete) {
      showToast(`EAN completato: ${eanKey} (${newCount}/${totalQty})`, 'success');
    } else {
      showToast(`EAN scansionato: ${eanKey} (${newCount}/${totalQty})`, 'success');
    }
    console.log('[Reception][EAN] Success', { eanKey, newCount, totalQty, isNowComplete });
  }, [eanColumn, items, eanCounts, showToast]);

  // ── Unified scan dispatcher ────────────────────────────────────────────────

  const handleScanned = useCallback(async (code: string) => {
    if (processingCode) return;
    setProcessingCode(true);
    console.log('[Reception] handleScanned dispatching, mode:', scanMode, 'code:', code);
    try {
      if (scanMode === 'pkgid') await handlePkgIdScan(code);
      else if (scanMode === 'lpn') await handleLpnScan(code);
      else if (scanMode === 'ean') await handleEanScan(code);
    } finally {
      setProcessingCode(false);
    }
  }, [processingCode, scanMode, handlePkgIdScan, handleLpnScan, handleEanScan]);

  // ── Mark complete ──────────────────────────────────────────────────────────

  const handleMarkComplete = useCallback(async () => {
    console.log('[Reception] handleMarkComplete pressed', { fileId });
    setMarkingComplete(true);
    try {
      const { error } = await db
        .from('supplier_files')
        .update({ status: 'received', received_at: new Date().toISOString() })
        .eq('id', fileId);

      if (error) {
        console.error('[Reception] markComplete error:', error);
        throw error;
      }

      console.log('[Reception] File marked as received');
      showToast('File segnato come ricevuto completamente', 'success');
      setFile(prev => prev ? { ...prev, status: 'received' } : prev);
    } catch (err: any) {
      console.error('[Reception] handleMarkComplete error:', err);
      showToast(err?.message ?? 'Errore', 'error');
    } finally {
      setMarkingComplete(false);
    }
  }, [fileId, showToast]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isAlreadyReceived = file?.status === 'received';

  // PkgID groups
  const pkgGroups = useMemo(() => {
    if (scanMode !== 'pkgid' || !file?.pkgid_column) return [];
    return groupByPkgId(items, file.pkgid_column);
  }, [scanMode, file, items]);

  // LPN rows
  const lpnRows = useMemo((): LpnRow[] => {
    if (scanMode !== 'lpn' || !file?.lpn_column) return [];
    const column = file.lpn_column;
    return items
      .map(item => ({
        lpnValue: String(item.original_data?.[column] ?? '').trim() || '—',
        item,
        isReceived: item.extra_data?.received === 'true',
      }))
      .sort((a, b) => {
        if (a.isReceived === b.isReceived) return a.lpnValue.localeCompare(b.lpnValue);
        return a.isReceived ? 1 : -1;
      });
  }, [scanMode, file, items]);

  // EAN rows
  const eanRows = useMemo((): EanRow[] => {
    if (scanMode !== 'ean' || !eanColumn) return [];
    return items.map(item => {
      const eanValue = String(item.original_data?.[eanColumn] ?? '').trim() || '—';
      const totalQty = item.quantita ?? 1;
      const receivedQty = eanCounts[eanValue] ?? Number(item.extra_data?.ean_received_qty ?? 0);
      return { eanValue, item, receivedQty, totalQty };
    }).sort((a, b) => {
      const aComplete = a.receivedQty >= a.totalQty;
      const bComplete = b.receivedQty >= b.totalQty;
      if (aComplete !== bComplete) return aComplete ? 1 : -1;
      return a.eanValue.localeCompare(b.eanValue);
    });
  }, [scanMode, eanColumn, items, eanCounts]);

  // Progress
  const { progressScanned, progressTotal, progressLabel } = useMemo(() => {
    if (scanMode === 'pkgid') {
      const scanned = pkgGroups.filter(g => g.isReceived).length;
      const total = pkgGroups.length;
      return { progressScanned: scanned, progressTotal: total, progressLabel: `${scanned} / ${total} colli scansionati` };
    }
    if (scanMode === 'lpn') {
      const scanned = lpnRows.filter(r => r.isReceived).length;
      const total = lpnRows.length;
      return { progressScanned: scanned, progressTotal: total, progressLabel: `${scanned} / ${total} LPN scansionati` };
    }
    if (scanMode === 'ean') {
      const scanned = eanRows.reduce((sum, r) => sum + r.receivedQty, 0);
      const total = eanRows.reduce((sum, r) => sum + r.totalQty, 0);
      return { progressScanned: scanned, progressTotal: total, progressLabel: `${scanned} / ${total} unità scansionate` };
    }
    return { progressScanned: 0, progressTotal: 0, progressLabel: '—' };
  }, [scanMode, pkgGroups, lpnRows, eanRows]);

  const progressRatio = progressTotal > 0 ? progressScanned / progressTotal : 0;

  const scanModeLabel = scanMode === 'pkgid' ? 'PkgID' : scanMode === 'lpn' ? 'LPN' : scanMode === 'ean' ? 'EAN' : '—';
  const scanHint = scanMode === 'pkgid' ? 'Inquadra il barcode del collo (PkgID)' : scanMode === 'lpn' ? 'Inquadra il barcode LPN' : 'Inquadra il codice EAN';

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen
        options={{
          title: file?.file_name ?? 'Ricezione',
          headerLargeTitle: false,
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}
      >
        {/* Mode selector */}
        <ModeSelector
          currentMode={scanMode}
          pkgidAvailable={pkgidAvailable}
          lpnAvailable={lpnAvailable}
          eanAvailable={eanAvailable}
          onSelect={handleModeChange}
        />

        {/* Progress card */}
        {scanMode !== null && items.length > 0 && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>{progressLabel}</Text>
              <Text style={styles.progressPercent}>
                {Math.round(progressRatio * 100)}%
              </Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressRatio * 100}%` as any }]} />
            </View>
          </View>
        )}

        {/* Scan button */}
        {!isAlreadyReceived && scanMode !== null && (
          <AnimatedPressable
            onPress={() => {
              console.log('[Reception] Open scanner pressed, mode:', scanMode);
              setScannerOpen(true);
            }}
          >
            <View style={styles.scanButton}>
              <ScanLine size={22} color="#FFFFFF" />
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.scanButtonText}>Scansiona Barcode</Text>
                <Text style={styles.scanButtonSubtext}>Modalità: {scanModeLabel}</Text>
              </View>
            </View>
          </AnimatedPressable>
        )}

        {/* PkgID groups list */}
        {scanMode === 'pkgid' && pkgGroups.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Gruppi PkgID</Text>
            {pkgGroups.map(group => (
              <PkgGroupCard key={group.pkgId} group={group} />
            ))}
          </View>
        )}

        {/* LPN list */}
        {scanMode === 'lpn' && lpnRows.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>LPN</Text>
            {lpnRows.map(row => (
              <LpnRowCard key={row.item.id} row={row} />
            ))}
          </View>
        )}

        {/* EAN list */}
        {scanMode === 'ean' && eanRows.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Articoli EAN</Text>
            {eanRows.map(row => (
              <EanRowCard key={row.item.id} row={row} />
            ))}
          </View>
        )}

        {/* Already received banner */}
        {isAlreadyReceived && (
          <View style={styles.receivedBanner}>
            <CheckCircle size={20} color={COLORS.accent} />
            <Text style={styles.receivedBannerText}>File ricevuto completamente</Text>
          </View>
        )}

        {/* Mark complete button */}
        {!isAlreadyReceived && (
          <AnimatedPressable
            onPress={handleMarkComplete}
            disabled={markingComplete}
          >
            <View style={styles.completeButton}>
              {markingComplete ? (
                <ActivityIndicator color={COLORS.accent} size="small" />
              ) : (
                <CheckCircle size={18} color={COLORS.accent} />
              )}
              <Text style={styles.completeButtonText}>
                {markingComplete ? 'Aggiornamento...' : 'Segna come Ricevuto Completamente'}
              </Text>
            </View>
          </AnimatedPressable>
        )}
      </ScrollView>

      {/* Scanner modal */}
      <ScannerModal
        visible={scannerOpen}
        onClose={() => {
          console.log('[Reception] Scanner modal closed');
          setScannerOpen(false);
        }}
        onScanned={handleScanned}
        hint={scanHint}
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
  // Mode selector
  modeSelectorCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  modeSelectorTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modeSelectorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeCard: {
    flex: 1,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modeCardDisabled: {
    opacity: 0.4,
  },
  modeCardLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  modeCardLabelDisabled: {
    color: COLORS.textTertiary,
  },
  modeCardSubtitle: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
  },

  // Progress
  progressCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
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
  },
  progressPercent: {
    fontSize: 14,
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

  // Scan button
  scanButton: {
    backgroundColor: '#1A56DB',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  scanButtonSubtext: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },

  // Group cards (shared PkgID / LPN)
  groupCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  groupCardReceived: {
    backgroundColor: '#DCFCE7',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#16A34A',
    gap: 6,
  },
  groupCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  groupPkgId: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  groupPkgIdReceived: {
    fontSize: 15,
    fontWeight: '700',
    color: '#15803D',
  },
  groupCount: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  groupCountReceived: {
    fontSize: 12,
    color: '#16A34A',
    marginTop: 2,
  },
  groupBadgePending: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  groupBadgePendingText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  groupItemCodes: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  groupItemCodesReceived: {
    fontSize: 11,
    color: '#16A34A',
  },

  // EAN cards
  eanCardPartial: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D97706',
    gap: 6,
  },
  eanPkgIdPartial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
  },
  eanCountPartial: {
    fontSize: 12,
    color: '#D97706',
    marginTop: 2,
  },
  eanQtyBadgeGreen: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eanQtyBadgeGreenText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eanQtyBadgeYellow: {
    backgroundColor: '#D97706',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eanQtyBadgeYellowText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Received banner
  receivedBanner: {
    backgroundColor: COLORS.accentMuted,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  receivedBannerText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '600',
  },

  // Complete button
  completeButton: {
    backgroundColor: COLORS.accentMuted,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  completeButtonText: {
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: '700',
  },
});
