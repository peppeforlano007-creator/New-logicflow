import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Download, FileText } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { FileStatusBadge, FormatBadge } from '@/components/StatusBadge';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';
import { saveAndShareFile } from '@/utils/fileHelpers';
import { SUPABASE_PROJECT_URL as SUPABASE_URL, SUPABASE_ANON_TOKEN as SUPABASE_ANON_KEY } from '@/constants/supabase';
import type { SupplierFile } from '@/types';

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
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
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface FileWithProgress extends SupplierFile {
  total_items: number;
  completed_items: number;
}

export default function ExportScreen() {
  const { toast, showToast, hideToast } = useToast();
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [markingShortageId, setMarkingShortageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingMerged, setExportingMerged] = useState(false);

  const fetchFiles = useCallback(async () => {
    console.log('[Export] fetchFiles called');
    try {
      // Flat query — no nested embed, no row-limit truncation
      const { data: filesData, error: filesError } = await db
        .from('supplier_files')
        .select('id, file_name, original_format, status, extra_columns, column_headers, imported_at, received_at, completed_at, imported_by, notes')
        .order('imported_at', { ascending: false });

      if (filesError) {
        console.error('[Export] fetchFiles files error:', filesError);
        throw filesError;
      }

      const fileList = filesData ?? [];
      console.log('[Export] fetchFiles files loaded:', fileList.length);

      if (fileList.length === 0) {
        setFiles([]);
        return;
      }

      // Accurate counts from aggregate view (no row-limit issues)
      const fileIds = fileList.map((f: any) => f.id);
      const { data: countsData, error: countsError } = await db
        .from('supplier_file_progress')
        .select('file_id, total_items, completed_items')
        .in('file_id', fileIds);

      if (countsError) {
        console.error('[Export] fetchFiles counts error:', countsError);
        throw countsError;
      }

      const countsMap: Record<string, { total_items: number; completed_items: number }> = {};
      for (const row of (countsData ?? [])) {
        countsMap[row.file_id] = {
          total_items: Number(row.total_items ?? 0),
          completed_items: Number(row.completed_items ?? 0),
        };
      }

      const mapped: FileWithProgress[] = fileList.map((f: any) => ({
        ...f,
        total_items: countsMap[f.id]?.total_items ?? 0,
        completed_items: countsMap[f.id]?.completed_items ?? 0,
      }));

      console.log('[Export] fetchFiles mapped:', mapped.length, 'files with counts');
      setFiles(mapped);
    } catch (err) {
      console.error('[Export] fetchFiles exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchFiles();
    }, [fetchFiles])
  );

  const handleRefresh = useCallback(() => {
    console.log('[Export] handleRefresh called');
    setRefreshing(true);
    fetchFiles();
  }, [fetchFiles]);

  const toggleSelect = useCallback((id: string) => {
    console.log('[Export] toggleSelect called, id:', id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleMarkShortage = useCallback(async (fileId: string, fileName: string) => {
    console.log('[Export] handleMarkShortage called', { fileId, fileName });
    setMarkingShortageId(fileId);
    try {
      const { data: pendingItems, error: fetchError } = await db
        .from('supplier_items')
        .select('id, original_data')
        .eq('file_id', fileId)
        .eq('status', 'pending');

      if (fetchError) throw fetchError;
      if (!pendingItems || pendingItems.length === 0) {
        showToast('Nessun articolo non ricevuto', 'info');
        return;
      }

      const updates = pendingItems.map((item: any) =>
        db
          .from('supplier_items')
          .update({
            original_data: { ...item.original_data, AdjReason: 'shortage' },
          })
          .eq('id', item.id)
      );
      await Promise.all(updates);

      console.log('[Export] marked', pendingItems.length, 'items as shortage');
      showToast(`${pendingItems.length} articoli segnati come non ricevuti`, 'success');
    } catch (err: any) {
      console.error('[Export] handleMarkShortage error:', err);
      showToast(err?.message ?? 'Errore', 'error');
    } finally {
      setMarkingShortageId(null);
    }
  }, [showToast]);

  const handleExport = useCallback(async (file: FileWithProgress) => {
    console.log('[Export] handleExport called', { fileId: file.id, fileName: file.file_name });
    setExportingId(file.id);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/export-supplier-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ file_id: file.id }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[Export] export-supplier-file error:', response.status, text);
        throw new Error(`Errore esportazione: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Export] export-supplier-file success, fileName:', data.file_name);

      console.log('[Export] saving file from base64, fileName:', data.file_name ?? file.file_name);
      await saveAndShareFile(data.file_base64, data.file_name ?? file.file_name);
      showToast(`File esportato: ${data.file_name ?? file.file_name}`, 'success');
    } catch (err: any) {
      console.error('[Export] handleExport error:', err);
      showToast(err?.message ?? 'Errore durante l\'esportazione', 'error');
    } finally {
      setExportingId(null);
    }
  }, [showToast]);

  const handleExportMerged = useCallback(async () => {
    if (selectedIds.size === 0) return;
    console.log('[Export] handleExportMerged called, ids:', [...selectedIds]);
    setExportingMerged(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/export-merged-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ file_ids: [...selectedIds] }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[Export] export-merged-files error:', response.status, text);
        throw new Error(`Errore esportazione unificata: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Export] saving merged file from base64, fileName:', data.file_name ?? 'export_unificato.csv');
      await saveAndShareFile(data.file_base64, data.file_name ?? 'export_unificato.csv');
      showToast(`File unificato esportato: ${data.file_name}`, 'success');
      setSelectedIds(new Set());
    } catch (err: any) {
      console.error('[Export] handleExportMerged error:', err);
      showToast(err?.message ?? 'Errore esportazione unificata', 'error');
    } finally {
      setExportingMerged(false);
    }
  }, [selectedIds, showToast]);

  const renderItem = useCallback(({ item, index }: { item: FileWithProgress; index: number }) => {
    const dateDisplay = formatDate(item.imported_at);
    const isExporting = exportingId === item.id;
    const isMarkingShortage = markingShortageId === item.id;
    const progress = item.total_items > 0 ? item.completed_items / item.total_items : 0;
    const progressPercent = Math.round(progress * 100);
    const isSelected = selectedIds.has(item.id);

    return (
      <AnimatedListItem index={index}>
        <TouchableOpacity onPress={() => toggleSelect(item.id)} activeOpacity={0.85}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 14,
              padding: 16,
              marginBottom: 12,
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? COLORS.primary : COLORS.border,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)',
            }}
          >
            {/* Checkbox row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: isSelected ? COLORS.primary : COLORS.border,
                  backgroundColor: isSelected ? COLORS.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isSelected && (
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>
                  {item.file_name}
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{dateDisplay}</Text>
              </View>
            </View>

            {/* Buttons row */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TouchableOpacity
                onPress={() => { handleMarkShortage(item.id, item.file_name); }}
                disabled={isMarkingShortage || isExporting}
                activeOpacity={0.75}
                style={{
                  flex: 1,
                  backgroundColor: isMarkingShortage ? '#FCA5A5' : '#FEE2E2',
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                {isMarkingShortage ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <FileText size={14} color="#EF4444" />
                )}
                <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600' }}>
                  {isMarkingShortage ? '...' : 'Segna non ricevuti'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { handleExport(item); }}
                disabled={isExporting || isMarkingShortage}
                activeOpacity={0.75}
                style={{
                  flex: 1,
                  backgroundColor: isExporting ? COLORS.accent + 'AA' : COLORS.accent,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Download size={14} color="#FFFFFF" />
                )}
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>
                  {isExporting ? '...' : 'Esporta'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Status + progress */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <FormatBadge format={item.original_format} />
              <FileStatusBadge status={item.status} />
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <FileText size={13} color={COLORS.textSecondary} />
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] }}>
                  {item.completed_items}
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>/</Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] }}>
                  {item.total_items}
                </Text>
              </View>
            </View>

            {item.total_items > 0 && (
              <View style={{ height: 4, backgroundColor: COLORS.surfaceSecondary, borderRadius: 2, overflow: 'hidden' }}>
                <View
                  style={{
                    height: '100%',
                    width: `${progressPercent}%`,
                    backgroundColor: progress === 1 ? COLORS.accent : COLORS.primary,
                    borderRadius: 2,
                  }}
                />
              </View>
            )}
          </View>
        </TouchableOpacity>
      </AnimatedListItem>
    );
  }, [exportingId, markingShortageId, selectedIds, toggleSelect, handleExport, handleMarkShortage]);

  const emptyState = (
    <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: COLORS.accentMuted,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Download size={32} color={COLORS.accent} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessun file disponibile
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Importa e lavora i file per poi esportarli.
      </Text>
    </View>
  );

  const selectedCount = selectedIds.size;
  const selectionLabel = selectedCount === 1 ? 'lista selezionata' : 'liste selezionate';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Export' }} />

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
          contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
          ListEmptyComponent={emptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
        />
      )}

      {selectedCount > 0 && (
        <View
          style={{
            position: 'absolute',
            bottom: 90,
            left: 16,
            right: 16,
            backgroundColor: COLORS.primary,
            borderRadius: 14,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
            elevation: 8,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
            {selectedCount}
          </Text>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
            {' '}{selectionLabel}
          </Text>
          <TouchableOpacity
            onPress={handleExportMerged}
            disabled={exportingMerged}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#fff',
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {exportingMerged ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Download size={15} color={COLORS.primary} />
            )}
            <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: '700' }}>
              {exportingMerged ? 'Esportando...' : 'Esporta Unificato'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ToastMessage
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onHide={hideToast}
      />
    </View>
  );
}
