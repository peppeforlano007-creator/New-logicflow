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
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Upload, FileText, ChevronRight, Plus, X, Check, Trash2 } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { FileStatusBadge, FormatBadge } from '@/components/StatusBadge';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';
import { readFileAsBase64 } from '@/utils/fileHelpers';
import { SUPABASE_PROJECT_URL as SUPABASE_URL, SUPABASE_ANON_TOKEN as SUPABASE_ANON_KEY } from '@/constants/supabase';
import type { SupplierFile } from '@/types';

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

interface FileWithCount extends SupplierFile {
  item_count?: number;
}

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
      setModalVisible(true);

      // Quick preview: read base64 and call edge function for preview
      try {
        const base64 = await readFileAsBase64(asset.uri);
        console.log('[Import] Calling parse-supplier-file for preview');
        const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-supplier-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ file_base64: base64, file_name: asset.name, preview_only: true }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Import] Preview data:', data);
          setPreviewRows(data.row_count ?? 0);
          setPreviewCols(data.column_headers ?? []);
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
  }, [showToast]);

  const handleConfirmImport = useCallback(async () => {
    if (!selectedFile) return;
    console.log('[Import] handleConfirmImport called', { fileName: selectedFile.name, importedBy });

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
      console.log('[Import] Calling parse-supplier-file edge function');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-supplier-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ file_base64: base64, file_name: selectedFile.name }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[Import] parse-supplier-file error:', response.status, text);
        throw new Error(`Errore edge function: ${response.status}`);
      }

      const parsed = await response.json();
      console.log('[Import] parse-supplier-file response:', {
        rows: parsed.rows?.length,
        columns: parsed.column_headers,
      });

      const format = selectedFile.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

      // Save supplier_file
      const { data: fileData, error: fileError } = await db
        .from('supplier_files')
        .insert({
          file_name: selectedFile.name,
          original_format: format,
          column_headers: parsed.column_headers ?? [],
          extra_columns: [],
          imported_by: importedBy || null,
          status: 'imported',
        })
        .select()
        .single();

      if (fileError) {
        console.error('[Import] insert supplier_files error:', fileError);
        throw fileError;
      }

      console.log('[Import] supplier_file created:', fileData.id);

      // Save items
      const rows: Record<string, string>[] = parsed.rows ?? [];
      const headers: string[] = parsed.column_headers ?? [];

      const codeKeys = ['codice', 'code', 'cod', 'item_code', 'sku', 'articolo'];
      const codeKey = headers.find(h => codeKeys.includes(h.toLowerCase())) ?? headers[0] ?? 'col_0';

      const items = rows.map((row, idx) => ({
        file_id: fileData.id,
        row_index: idx,
        item_code: String(row[codeKey] ?? row[Object.keys(row)[0]] ?? `ITEM_${idx + 1}`),
        original_data: row,
        extra_data: {},
        status: 'pending' as const,
      }));

      if (items.length > 0) {
        console.log('[Import] Inserting', items.length, 'items');
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
      showToast(`File importato con successo (${items.length} articoli)`, 'success');
      fetchFiles();
    } catch (err: any) {
      console.error('[Import] handleConfirmImport error:', err);
      showToast(err?.message ?? 'Errore durante l\'importazione', 'error');
    } finally {
      setImporting(false);
    }
  }, [selectedFile, importedBy, fetchFiles, showToast]);

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
        </View>
      </Modal>

      <ToastMessage
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onHide={hideToast}
      />

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
