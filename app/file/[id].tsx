import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { FileStatusBadge, ItemStatusBadge } from '@/components/StatusBadge';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonList } from '@/components/SkeletonLoader';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';
import type { SupplierFile, SupplierItem } from '@/types';

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, delay: index * 50, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export default function FileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const [file, setFile] = useState<SupplierFile | null>(null);
  const [items, setItems] = useState<SupplierItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    console.log('[FileDetail] fetchData called', { id });
    try {
      const [fileRes, itemsRes] = await Promise.all([
        db.from('supplier_files').select('*').eq('id', id).single(),
        db
          .from('supplier_items')
          .select('*')
          .eq('file_id', id)
          .order('row_index', { ascending: true }),
      ]);

      if (fileRes.error) {
        console.error('[FileDetail] file fetch error:', fileRes.error);
        throw fileRes.error;
      }
      if (itemsRes.error) {
        console.error('[FileDetail] items fetch error:', itemsRes.error);
        throw itemsRes.error;
      }

      console.log('[FileDetail] fetchData success, items:', itemsRes.data?.length);
      const fileData = fileRes.data as SupplierFile;
      setFile(fileData);
      setItems((itemsRes.data ?? []) as SupplierItem[]);
      setFilteredItems((itemsRes.data ?? []) as SupplierItem[]);

      // Update status to processing if received
      if (fileData.status === 'received') {
        console.log('[FileDetail] Updating file status to processing');
        await db
          .from('supplier_files')
          .update({ status: 'processing' })
          .eq('id', id);
        setFile(prev => prev ? { ...prev, status: 'processing' } : prev);
      }
    } catch (err) {
      console.error('[FileDetail] fetchData exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter items based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredItems(items);
      return;
    }
    const q = searchQuery.toLowerCase();
    const filtered = items.filter(item => {
      if (item.item_code.toLowerCase().includes(q)) return true;
      const dataValues = Object.values(item.original_data ?? {});
      return dataValues.some(v => String(v).toLowerCase().includes(q));
    });
    console.log('[FileDetail] search filter applied, query:', q, 'results:', filtered.length);
    setFilteredItems(filtered);
  }, [searchQuery, items]);

  const handleRefresh = useCallback(() => {
    console.log('[FileDetail] handleRefresh called');
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const handleItemPress = useCallback((itemId: string, itemCode: string) => {
    console.log('[FileDetail] handleItemPress', { itemId, itemCode });
    router.push(`/item/${itemId}` as any);
  }, [router]);

  const completedCount = items.filter(i => i.status === 'completed').length;
  const progress = items.length > 0 ? completedCount / items.length : 0;

  const renderItem = useCallback(({ item, index }: { item: SupplierItem; index: number }) => {
    const originalData = item.original_data ?? {};
    const pkgId = originalData['PkgID'];
    const displayTitle = pkgId && pkgId.trim() !== '' ? pkgId : item.item_code;
    const EXCLUDED_PREVIEW_KEYS = new Set(['PkgID', 'AdjReason']);
    const dataEntries = Object.entries(originalData)
      .filter(([k]) => !EXCLUDED_PREVIEW_KEYS.has(k))
      .slice(0, 3);
    const previewText = dataEntries.map(([k, v]) => `${k}: ${v}`).join(' · ');

    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable onPress={() => handleItemPress(item.id, item.item_code)}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              padding: 14,
              marginBottom: 8,
              borderWidth: 1,
              borderColor: COLORS.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
                  {displayTitle}
                </Text>
                <ItemStatusBadge status={item.status} size="sm" />
              </View>
              {previewText ? (
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                  {previewText}
                </Text>
              ) : null}
            </View>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>›</Text>
            </View>
          </View>
        </AnimatedPressable>
      </AnimatedListItem>
    );
  }, [handleItemPress]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <Stack.Screen options={{ title: 'Dettaglio File', headerLargeTitle: false }} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        >
          <SkeletonList count={5} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen
        options={{
          title: file?.file_name ?? 'Dettaglio File',
          headerLargeTitle: false,
          headerSearchBarOptions: {
            placeholder: 'Cerca articolo...',
            onChangeText: (e) => {
              console.log('[FileDetail] search query changed:', e.nativeEvent.text);
              setSearchQuery(e.nativeEvent.text);
            },
            onCancelButtonPress: () => {
              console.log('[FileDetail] search canceled');
              setSearchQuery('');
            },
          },
        }}
      />

      <FlatList
        data={filteredItems}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
        ListHeaderComponent={
          <View style={{ marginBottom: 16, gap: 12 }}>
            {/* File info */}
            <View
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: 14,
                padding: 16,
                borderWidth: 1,
                borderColor: COLORS.border,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {file && <FileStatusBadge status={file.status} />}
                {file?.imported_by ? (
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    da {file.imported_by}
                  </Text>
                ) : null}
              </View>

              {/* Progress */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                    Progresso lavorazione
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text, fontVariant: ['tabular-nums'] }}>
                    {completedCount}/{items.length}
                  </Text>
                </View>
                <View style={{ height: 6, backgroundColor: COLORS.surfaceSecondary, borderRadius: 3, overflow: 'hidden' }}>
                  <View
                    style={{
                      height: '100%',
                      width: `${Math.round(progress * 100)}%`,
                      backgroundColor: progress === 1 ? COLORS.accent : COLORS.primary,
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>

              {/* Extra columns */}
              {(file?.extra_columns?.length ?? 0) > 0 && (
                <View>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
                    Colonne extra:
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {(file?.extra_columns ?? []).map(col => (
                      <View
                        key={col}
                        style={{
                          backgroundColor: COLORS.primaryMuted,
                          borderRadius: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: COLORS.primary, fontWeight: '600' }}>
                          {col}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {filteredItems.length > 0 && (
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] }}>
                {filteredItems.length} articoli{searchQuery ? ` trovati per "${searchQuery}"` : ''}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Search size={32} color={COLORS.textTertiary} />
            <Text style={{ fontSize: 15, color: COLORS.textSecondary, marginTop: 12 }}>
              {searchQuery ? 'Nessun articolo trovato' : 'Nessun articolo'}
            </Text>
          </View>
        }
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
