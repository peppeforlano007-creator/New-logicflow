import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Upload, FileText, ChevronRight, Plus, X, Check, Trash2, ChevronDown } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { FileStatusBadge, FormatBadge } from '@/components/StatusBadge';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';
import { readFileAsBase64 } from '@/utils/fileHelpers';
import { SUPABASE_PROJECT_URL as SUPABASE_URL, SUPABASE_ANON_TOKEN as SUPABASE_ANON_KEY } from '@/constants/supabase';
import type { SupplierFile } from '@/types';

// ─── Base64 helpers ───────────────────────────────────────────────────────────

function stripBase64Prefix(b64: string): string {
  const idx = b64.indexOf(',');
  return idx !== -1 ? b64.slice(idx + 1) : b64;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = stripBase64Prefix(b64);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Mapping field definitions ────────────────────────────────────────────────

const MAPPING_FIELDS = [
  { key: 'lpn',          label: 'LPN',           required: true,  color: '#2563EB', desc: 'Codice univoco per riga — usato per scansione in ricezione e ricerca in cassa' },
  { key: 'asin',         label: 'ASIN',          required: false, color: '#7C3AED', desc: 'Raggruppamento articoli con stessa identità — usato in lavorazione' },
  { key: 'pkgid',        label: 'PkgID',         required: false, color: '#0891B2', desc: 'Codice collo per ricezione multipla (opzionale)' },
  { key: 'amazonprice',  label: 'Amazon Price',  required: true,  color: '#D97706', desc: 'Prezzo Amazon — calcola automaticamente il prezzo A (−35%), B (−50%), C (−70%) in lavorazione' },
  { key: 'descrizione',  label: 'Descrizione',   required: false, color: '#059669', desc: 'Titolo/descrizione articolo — mostrato in lavorazione e nella ricerca cassa' },
  { key: 'adjreason',    label: 'AdjReason',     required: false, color: '#DC2626', desc: 'Motivo anomalia — usato nell\'export per articoli non ricevuti' },
  { key: 'quantita',     label: 'Quantità',      required: false, color: '#6B7280', desc: 'Numero di unità per riga — lascia vuoto se ogni riga è 1 articolo' },
  { key: 'unitrecovery', label: 'Unit Recovery', required: false, color: '#B45309', desc: 'Costo unitario di recupero — salvato per analisi di redditività future' },
] as const;

type MappingKey = typeof MAPPING_FIELDS[number]['key'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 350,
        delay: index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 350,
        delay: index * 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Returns true if the column header is a likely auto-match for the given mapping key */
function isAutoMatch(colHeader: string, fieldKey: MappingKey): boolean {
  const lower = colHeader.toLowerCase();
  switch (fieldKey) {
    case 'lpn':          return lower.includes('lpn') || lower.includes('fnsku');
    case 'asin':         return lower.includes('asin');
    case 'pkgid':        return lower.includes('pkgid') || lower.includes('pkg_id') || lower.includes('pkg id');
    case 'amazonprice':  return lower.includes('amazonprice') || lower.includes('amazon price') || lower.includes('amazon_price');
    case 'descrizione':  return lower.includes('title') || lower.includes('descrizione') || lower.includes('description') || lower.includes('itemdesc');
    case 'adjreason':    return lower.includes('adjreason') || lower.includes('adj_reason') || lower.includes('adj reason');
    case 'quantita':     return lower.includes('quantit') || lower.includes('qty') || lower.includes('quantity');
    case 'unitrecovery': return lower.includes('unitrecovery') || lower.includes('unit_recovery') || lower.includes('unit recovery');
    default:             return false;
  }
}

interface FileWithCount extends SupplierFile {
  item_count?: number;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const [files, setFiles] = useState<FileWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Import modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [importedBy, setImportedBy] = useState('');
  const [importing, setImporting] = useState(false);
  const [previewRows, setPreviewRows] = useState(0);
  const [previewCols, setPreviewCols] = useState<string[]>([]);

  // 8-field mapping state
  const [mappings, setMappings] = useState<Record<MappingKey, string | null>>({
    lpn: null,
    asin: null,
    pkgid: null,
    amazonprice: null,
    descrizione: null,
    adjreason: null,
    quantita: null,
    unitrecovery: null,
  });
  const [activePicker, setActivePicker] = useState<MappingKey | null>(null);

  const resetMappings = useCallback(() => {
    setMappings({
      lpn: null,
      asin: null,
      pkgid: null,
      amazonprice: null,
      descrizione: null,
      adjreason: null,
      quantita: null,
      unitrecovery: null,
    });
    setActivePicker(null);
  }, []);

  // Auto-apply mappings when previewCols becomes available
  useEffect(() => {
    if (previewCols.length === 0) return;
    setMappings(prev => {
      const next = { ...prev };
      for (const field of MAPPING_FIELDS) {
        if (next[field.key] === null) {
          const match = previewCols.find(col => isAutoMatch(col, field.key));
          if (match) {
            console.log('[Import] Auto-mapping field:', field.key, '→', match);
            next[field.key] = match;
          }
        }
      }
      return next;
    });
  }, [previewCols]);

  const fetchFiles = useCallback(async () => {
    console.log('[Import] fetchFiles called');
    try {
      const { data, error } = await db
        .from('supplier_files')
        .select('*, supplier_items(count)')
        .order('imported_at', { ascending: false });

      if (error) {
        console.error('[Import] fetchFiles error:', error);
        throw error;
      }

      console.log('[Import] fetchFiles success, count:', data?.length);
      const mapped: FileWithCount[] = (data || []).map((f: any) => ({
        ...f,
        item_count: f.supplier_items?.[0]?.count ?? 0,
      }));
      setFiles(mapped);
    } catch (err) {
      console.error('[Import] fetchFiles exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleRefresh = useCallback(() => {
    console.log('[Import] handleRefresh called');
    setRefreshing(true);
    fetchFiles();
  }, [fetchFiles]);

  const handlePickFile = useCallback(async () => {
    console.log('[Import] handlePickFile called');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      console.log('[Import] DocumentPicker result:', result);

      if (result.canceled || !result.assets?.[0]) {
        console.log('[Import] File picker canceled');
        return;
      }

      const asset = result.assets[0];
      console.log('[Import] File selected:', asset.name, 'size:', asset.size);
      setSelectedFile(asset);
      setPreviewRows(0);
      setPreviewCols([]);
      resetMappings();
      setModalVisible(true);

      // Quick preview: read base64 and parse headers locally (CSV + XLSX)
      try {
        const base64 = await readFileAsBase64(asset.uri);

        // Parse headers locally — works for both CSV and XLSX
        try {
          const isCSV = asset.name.toLowerCase().endsWith('.csv');
          const isXLSX = asset.name.toLowerCase().endsWith('.xlsx') || asset.name.toLowerCase().endsWith('.xls');

          if (isCSV) {
            const text = atob(stripBase64Prefix(base64));
            const firstLine = text.split(/\r?\n/)[0] ?? '';
            // Handle tab-separated too
            const sep = firstLine.includes('\t') ? '\t' : ',';
            const cols = firstLine.split(sep).map(h => h.replace(/^"|"$/g, '').trim()).filter(Boolean);
            if (cols.length > 0) {
              console.log('[Import] Local CSV headers extracted:', cols);
              setPreviewCols(cols);
            }
          } else if (isXLSX) {
            const XLSX = await import('xlsx');
            const bytes = base64ToUint8Array(base64);
            const workbook = XLSX.read(bytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            const headerRow: string[] = (jsonRows[0] as string[]) ?? [];
            const cols = headerRow.map(h => String(h ?? '').trim()).filter(Boolean);
            if (cols.length > 0) {
              console.log('[Import] Local XLSX headers extracted:', cols);
              setPreviewCols(cols);
              // Also set row count from local parse
              setPreviewRows(Math.max(0, jsonRows.length - 1));
            }
          }
        } catch (localErr) {
          console.warn('[Import] Local header extraction failed:', localErr);
        }

        console.log('[Import] Calling parse-supplier-file for preview (authoritative overwrite)');
        const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-supplier-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ file_base64: stripBase64Prefix(base64), file_name: asset.name, preview_only: true }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Import] Preview data:', data);
          if (data.row_count != null && data.row_count > 0) {
            setPreviewRows(data.row_count);
          }
          if (data.column_headers && data.column_headers.length > 0) {
            setPreviewCols(data.column_headers);
          }
        } else {
          const text = await response.text();
          console.warn('[Import] Preview response not ok:', response.status, text);
        }
      } catch (previewErr) {
        console.warn('[Import] Preview failed (non-blocking):', previewErr);
      }
    } catch (err) {
      console.error('[Import] handlePickFile error:', err);
      showToast('Errore nella selezione del file', 'error');
    }
  }, [showToast, resetMappings]);

  const handleConfirmImport = useCallback(async () => {
    if (!selectedFile) return;

    if (mappings.lpn === null) {
      console.log('[Import] handleConfirmImport blocked — LPN column not mapped');
      showToast('Seleziona almeno la colonna LPN prima di importare', 'error');
      return;
    }

    console.log('[Import] handleConfirmImport called', {
      fileName: selectedFile.name,
      importedBy,
      mappings,
    });

    setImporting(true);

    const { data: existing } = await db
      .from('supplier_files')
      .select('id')
      .eq('file_name', selectedFile.name)
      .maybeSingle();

    if (existing) {
      console.log('[Import] Duplicate file detected', { fileName: selectedFile.name, existingId: existing.id });
      showToast(`Lista "${selectedFile.name}" già importata. Elimina quella esistente prima di reimportarla.`, 'error');
      setImporting(false);
      return;
    }

    try {
      const base64 = await readFileAsBase64(selectedFile.uri);
      console.log('[Import] Parsing file locally for import:', selectedFile.name);

      const isCSV = selectedFile.name.toLowerCase().endsWith('.csv');
      const isXLSX = selectedFile.name.toLowerCase().endsWith('.xlsx') || selectedFile.name.toLowerCase().endsWith('.xls');

      let parsedRows: Record<string, string>[] = [];
      let parsedHeaders: string[] = [];

      if (isCSV) {
        const text = atob(stripBase64Prefix(base64));
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const sep = lines[0]?.includes('\t') ? '\t' : ',';
        const hdrs = lines[0]?.split(sep).map(h => h.replace(/^"|"$/g, '').trim()) ?? [];
        parsedHeaders = hdrs;
        parsedRows = lines.slice(1).map(line => {
          const vals = line.split(sep).map(v => v.replace(/^"|"$/g, '').trim());
          const obj: Record<string, string> = {};
          hdrs.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
          return obj;
        });
        console.log('[Import] Local CSV parse complete — rows:', parsedRows.length, '| headers:', parsedHeaders);
      } else if (isXLSX) {
        const XLSX = await import('xlsx');
        const bytes = base64ToUint8Array(base64);
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        parsedHeaders = jsonRows.length > 0 ? Object.keys(jsonRows[0]) : [];
        parsedRows = jsonRows.map(row => {
          const obj: Record<string, string> = {};
          for (const k of Object.keys(row)) obj[k] = String(row[k] ?? '');
          return obj;
        });
        console.log('[Import] Local XLSX parse complete — rows:', parsedRows.length, '| headers:', parsedHeaders);
      } else {
        throw new Error('Formato file non supportato. Usa CSV o XLSX.');
      }

      const format = isCSV ? 'csv' : 'xlsx';

      // Save supplier_file with all mapping columns
      const { data: fileData, error: fileError } = await db
        .from('supplier_files')
        .insert({
          file_name: selectedFile.name,
          original_format: format,
          column_headers: parsedHeaders,
          extra_columns: [],
          imported_by: importedBy || null,
          status: 'imported',
          // Keep identificatore_column for backward compat (use lpn mapping)
          identificatore_column: mappings.lpn ?? null,
          lpn_column: mappings.lpn,
          asin_column: mappings.asin,
          pkgid_column: mappings.pkgid,
          amazonprice_column: mappings.amazonprice,
          descrizione_column: mappings.descrizione,
          adjreason_column: mappings.adjreason,
          quantita_column: mappings.quantita,
          unitrecovery_column: mappings.unitrecovery,
        })
        .select()
        .single();

      if (fileError) {
        console.error('[Import] insert supplier_files error:', fileError);
        throw fileError;
      }

      console.log('[Import] supplier_file created:', fileData.id);

      // Save items with normalization
      const rows: Record<string, string>[] = parsedRows;
      const headers: string[] = parsedHeaders;

      console.log('[Import] Building normalized items — mappings:', mappings);

      const items = rows.map((row, idx) => {
        // Build normalized original_data — keep all original columns, add standard keys on top
        const normalized: Record<string, string> = { ...row };

        if (mappings.lpn && row[mappings.lpn] != null)
          normalized['LPN'] = String(row[mappings.lpn]);
        if (mappings.asin && row[mappings.asin] != null)
          normalized['ASIN'] = String(row[mappings.asin]);
        if (mappings.pkgid && row[mappings.pkgid] != null)
          normalized['PkgID'] = String(row[mappings.pkgid]);
        if (mappings.amazonprice && row[mappings.amazonprice] != null)
          normalized['AmazonPrice'] = String(row[mappings.amazonprice]);
        if (mappings.descrizione && row[mappings.descrizione] != null)
          normalized['Title'] = String(row[mappings.descrizione]);
        if (mappings.adjreason && row[mappings.adjreason] != null)
          normalized['AdjReason'] = String(row[mappings.adjreason]);

        const qty = mappings.quantita
          ? Math.max(1, parseInt(String(row[mappings.quantita] ?? '1'), 10) || 1)
          : 1;

        const unitRecovery = mappings.unitrecovery
          ? parseFloat(String(row[mappings.unitrecovery] ?? '0')) || null
          : null;

        // item_code: prefer LPN mapping, then ASIN, then first column
        const codeKey = mappings.lpn ?? mappings.asin ?? headers[0] ?? 'col_0';
        const itemCode = String(row[codeKey] ?? `ITEM_${idx + 1}`);

        return {
          file_id: fileData.id,
          row_index: idx,
          item_code: itemCode,
          original_data: normalized,
          extra_data: {},
          status: 'pending' as const,
          quantita: qty,
          quantita_disponibile: qty,
          unit_recovery: unitRecovery,
        };
      });

      if (items.length > 0) {
        console.log('[Import] Inserting', items.length, 'normalized items — lpn_column:', mappings.lpn ?? 'none', '| quantita_column:', mappings.quantita ?? 'none (default 1)');
        const { error: itemsError } = await db.from('supplier_items').insert(items);
        if (itemsError) {
          console.error('[Import] insert supplier_items error:', itemsError);
          throw itemsError;
        }
        console.log('[Import] Items inserted successfully');
      }

      setModalVisible(false);
      setSelectedFile(null);
      setImportedBy('');
      resetMappings();
      showToast(`File importato con successo (${items.length} articoli)`, 'success');
      fetchFiles();
    } catch (err: any) {
      console.error('[Import] handleConfirmImport error:', err);
      showToast(err?.message ?? 'Errore durante l\'importazione', 'error');
    } finally {
      setImporting(false);
    }
  }, [selectedFile, importedBy, mappings, fetchFiles, showToast, resetMappings]);

  const handleDeleteFile = useCallback((fileId: string, fileName: string) => {
    console.log('[Import] handleDeleteFile called', { fileId, fileName });
    setDeleteTarget({ id: fileId, name: fileName });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { id: fileId, name: fileName } = deleteTarget;
    console.log('[Import] confirmDelete called', { fileId, fileName });
    setDeleteTarget(null);
    setDeletingId(fileId);
    try {
      const { error: itemsError } = await db
        .from('supplier_items')
        .delete()
        .eq('file_id', fileId);
      if (itemsError) throw itemsError;

      const { error: fileError } = await db
        .from('supplier_files')
        .delete()
        .eq('id', fileId);
      if (fileError) throw fileError;

      setFiles(prev => prev.filter(f => f.id !== fileId));
      showToast(`"${fileName}" eliminata`, 'success');
      console.log('[Import] File deleted successfully:', fileId);
    } catch (err: any) {
      console.error('[Import] confirmDelete error:', err);
      showToast(err?.message ?? 'Errore durante l\'eliminazione', 'error');
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget, showToast]);

  const handleCardPress = useCallback((fileId: string, fileName: string) => {
    console.log('[Import] handleCardPress', { fileId, fileName });
    router.push(`/file/${fileId}` as any);
  }, [router]);

  const renderItem = useCallback(({ item, index }: { item: FileWithCount; index: number }) => {
    const dateDisplay = formatDate(item.imported_at);
    const itemCount = item.item_count ?? 0;

    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable onPress={() => handleCardPress(item.id, item.file_name)}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 14,
              padding: 16,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: COLORS.border,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                  style={{ fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 2 }}
                  numberOfLines={1}
                >
                  {item.file_name}
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  {dateDisplay}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AnimatedPressable
                    onPress={() => {
                      console.log('[Import] Delete button pressed', { fileId: item.id, fileName: item.file_name });
                      handleDeleteFile(item.id, item.file_name);
                    }}
                    disabled={deletingId === item.id}
                  >
                    <View style={{
                      width: 32, height: 32, borderRadius: 8,
                      backgroundColor: '#FEE2E2',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {deletingId === item.id
                        ? <ActivityIndicator size="small" color="#EF4444" />
                        : <Trash2 size={15} color="#EF4444" />}
                    </View>
                  </AnimatedPressable>
                  <ChevronRight size={18} color={COLORS.textTertiary} />
                </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <FormatBadge format={item.original_format} />
              <FileStatusBadge status={item.status} />
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <FileText size={13} color={COLORS.textSecondary} />
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] }}>
                  {itemCount}
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  articoli
                </Text>
              </View>
            </View>
            {item.imported_by ? (
              <Text style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 6 }}>
                Importato da: {item.imported_by}
              </Text>
            ) : null}
          </View>
        </AnimatedPressable>
      </AnimatedListItem>
    );
  }, [handleCardPress, handleDeleteFile, deletingId]);

  const emptyState = (
    <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: COLORS.primaryMuted,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Upload size={32} color={COLORS.primary} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessun file importato
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Importa il tuo primo file CSV o XLSX per iniziare a gestire gli articoli fornitore.
      </Text>
    </View>
  );

  // Active picker field definition
  const activeField = activePicker ? MAPPING_FIELDS.find(f => f.key === activePicker) : null;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen
        options={{
          title: 'Import',
          headerRight: () => (
            <AnimatedPressable onPress={handlePickFile}>
              <View
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Plus size={16} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
                  Importa
                </Text>
              </View>
            </AnimatedPressable>
          ),
        }}
      />

      {loading ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        >
          <SkeletonList count={4} />
        </ScrollView>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 120,
            flexGrow: 1,
          }}
          ListEmptyComponent={emptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
        />
      )}

      {/* Import Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => {
          console.log('[Import] Modal closed');
          setModalVisible(false);
          resetMappings();
        }}
      >
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          {/* Modal Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 20,
              paddingTop: 24,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
              backgroundColor: COLORS.surface,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>
              Importa File
            </Text>
            <AnimatedPressable
              onPress={() => {
                console.log('[Import] Modal dismiss button pressed');
                setModalVisible(false);
                resetMappings();
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: COLORS.surfaceSecondary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={16} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
            {/* File info */}
            <View
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: 14,
                padding: 16,
                borderWidth: 1,
                borderColor: COLORS.border,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: COLORS.primaryMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>
                    {selectedFile?.name ?? ''}
                  </Text>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    {selectedFile?.size ? `${(selectedFile.size / 1024).toFixed(1)} KB` : ''}
                  </Text>
                </View>
              </View>

              {previewRows > 0 && (
                <View
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: 10,
                    padding: 12,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <View>
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 }}>
                        RIGHE
                      </Text>
                      <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] }}>
                        {previewRows}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 }}>
                        COLONNE
                      </Text>
                      <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] }}>
                        {previewCols.length}
                      </Text>
                    </View>
                  </View>
                  {previewCols.length > 0 && (
                    <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }} numberOfLines={2}>
                      {previewCols.join(', ')}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* Imported by */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text }}>
                Importato da
              </Text>
              <TextInput
                value={importedBy}
                onChangeText={setImportedBy}
                placeholder="Nome dipendente"
                placeholderTextColor={COLORS.textTertiary}
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 15,
                  color: COLORS.text,
                }}
              />
            </View>

            {/* Column Mappings */}
            <View style={{ gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text }}>
                  Mappatura Colonne
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  Associa le colonne del file ai campi standard
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  overflow: 'hidden',
                }}
              >
                {MAPPING_FIELDS.map((field, idx) => {
                  const selectedCol = mappings[field.key];
                  const isLast = idx === MAPPING_FIELDS.length - 1;
                  const requiredLabel = field.required ? '(obbligatorio)' : '(opzionale)';
                  const chipLabel = selectedCol ?? 'Seleziona...';
                  const hasValue = selectedCol !== null;

                  return (
                    <View
                      key={field.key}
                      style={{
                        borderBottomWidth: isLast ? 0 : 1,
                        borderBottomColor: COLORS.border,
                        padding: 14,
                        gap: 8,
                      }}
                    >
                      {/* Top row: dot + label + required badge */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: field.color,
                          flexShrink: 0,
                        }} />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
                          {field.label}
                        </Text>
                        <Text style={{ fontSize: 11, color: COLORS.textTertiary }}>
                          {requiredLabel}
                        </Text>
                      </View>

                      {/* Description */}
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 16 }}>
                        {field.desc}
                      </Text>

                      {/* Chip */}
                      <TouchableOpacity
                        onPress={() => {
                          console.log('[Import] Mapping picker opened for field:', field.key, '| previewCols:', previewCols);
                          setActivePicker(field.key);
                        }}
                        activeOpacity={0.8}
                        style={{
                          backgroundColor: hasValue ? COLORS.primaryMuted : COLORS.background,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: hasValue ? field.color : COLORS.border,
                          paddingHorizontal: 12,
                          paddingVertical: 9,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          alignSelf: 'flex-start',
                          minWidth: 160,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: hasValue ? '600' : '400',
                            color: hasValue ? field.color : COLORS.textTertiary,
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {chipLabel}
                        </Text>
                        <ChevronDown size={14} color={hasValue ? field.color : COLORS.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Confirm button */}
            <AnimatedPressable
              onPress={handleConfirmImport}
              disabled={importing || !selectedFile}
            >
              <View
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 14,
                  paddingVertical: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                {importing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Check size={18} color="#FFFFFF" />
                )}
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
                  {importing ? 'Importazione in corso...' : 'Conferma Importazione'}
                </Text>
              </View>
            </AnimatedPressable>
          </ScrollView>

          <ToastMessage
            message={toast.message}
            type={toast.type}
            visible={toast.visible}
            onHide={hideToast}
          />
        </View>
      </Modal>

      {/* Column Picker Modal (shared for all 8 fields) */}
      <Modal
        visible={activePicker !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => {
          console.log('[Import] column picker dismissed for field:', activePicker);
          setActivePicker(null);
        }}
      >
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            padding: 20, paddingTop: 24,
            borderBottomWidth: 1, borderBottomColor: COLORS.border,
            backgroundColor: COLORS.surface,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {activeField && (
                <View style={{
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: activeField.color,
                }} />
              )}
              <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text }}>
                {activeField?.label ?? 'Seleziona colonna'}
              </Text>
            </View>
            <AnimatedPressable onPress={() => {
              console.log('[Import] column picker dismissed for field:', activePicker);
              setActivePicker(null);
            }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>

          {activeField && (
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, lineHeight: 16 }}>
              {activeField.desc}
            </Text>
          )}

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {/* Loading state when columns not yet available */}
            {previewCols.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 32, gap: 12 }}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' }}>
                  Lettura colonne in corso...
                </Text>
                <Text style={{ color: COLORS.textTertiary, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 }}>
                  Se il caricamento non termina, chiudi e riprova con un file CSV o XLSX.
                </Text>
              </View>
            )}

            {/* Nessuna option */}
            {(() => {
              const isNoneSelected = activePicker !== null && mappings[activePicker] === null;
              return (
                <TouchableOpacity
                  onPress={() => {
                    console.log('[Import] mapping cleared for field:', activePicker);
                    if (activePicker) {
                      setMappings(prev => ({ ...prev, [activePicker]: null }));
                    }
                    setActivePicker(null);
                  }}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: isNoneSelected ? COLORS.primaryMuted : COLORS.surface,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: isNoneSelected ? COLORS.primary : COLORS.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: isNoneSelected ? '600' : '400', color: isNoneSelected ? COLORS.primary : COLORS.textSecondary }}>
                    Nessuna
                  </Text>
                  {isNoneSelected && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })()}

            {/* Column options */}
            {previewCols.map(col => {
              const isSelected = activePicker !== null && mappings[activePicker] === col;
              const isMatch = activePicker !== null && isAutoMatch(col, activePicker);

              return (
                <TouchableOpacity
                  key={col}
                  onPress={() => {
                    console.log('[Import] mapping set — field:', activePicker, '→ column:', col);
                    if (activePicker) {
                      setMappings(prev => ({ ...prev, [activePicker]: col }));
                    }
                    setActivePicker(null);
                  }}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: isSelected ? COLORS.primary : COLORS.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Text style={{
                      fontSize: 15,
                      fontWeight: isSelected ? '600' : '400',
                      color: isSelected ? COLORS.primary : COLORS.text,
                      flex: 1,
                    }} numberOfLines={1}>
                      {col}
                    </Text>
                    {isMatch && !isSelected && (
                      <View style={{
                        backgroundColor: activeField ? `${activeField.color}20` : COLORS.primaryMuted,
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderWidth: 1,
                        borderColor: activeField ? `${activeField.color}40` : COLORS.primary,
                      }}>
                        <Text style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color: activeField?.color ?? COLORS.primary,
                        }}>
                          Match
                        </Text>
                      </View>
                    )}
                  </View>
                  {isSelected && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={!!deleteTarget}
        animationType="fade"
        transparent
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
        }}>
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            padding: 24,
            width: '100%',
            maxWidth: 360,
            gap: 16,
          }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text }}>
              Elimina lista
            </Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 }}>
              Vuoi eliminare "{deleteTarget?.name}" e tutti i suoi articoli? L'operazione non è reversibile.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <AnimatedPressable
                onPress={() => {
                  console.log('[Import] Delete modal cancelled');
                  setDeleteTarget(null);
                }}
                style={{ flex: 1 }}
              >
                <View style={{
                  borderRadius: 10,
                  paddingVertical: 12,
                  alignItems: 'center',
                  backgroundColor: COLORS.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text }}>Annulla</Text>
                </View>
              </AnimatedPressable>
              <AnimatedPressable onPress={confirmDelete} style={{ flex: 1 }}>
                <View style={{
                  borderRadius: 10,
                  paddingVertical: 12,
                  alignItems: 'center',
                  backgroundColor: '#EF4444',
                }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>Elimina</Text>
                </View>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
