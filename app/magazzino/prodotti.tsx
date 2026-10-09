import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Package, ChevronRight, ArrowLeft } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { ItemStatusBadge } from '@/components/StatusBadge';
import { SkeletonList } from '@/components/SkeletonLoader';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';
import type { SupplierItem } from '@/types';

type FilterOption = 'Tutti' | 'Ricevuti' | 'Lavorati';

interface ItemWithFile extends SupplierItem {
  supplier_files: { file_name: string; extra_columns: string[] } | null;
}

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

export default function ProdottiScreen() {
  const router = useRouter();
  const [allItems, setAllItems] = useState<ItemWithFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('Tutti');

  const fetchItems = useCallback(async () => {
    console.log('[Prodotti] fetchItems called');
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('*, supplier_files(file_name, extra_columns)')
        .filter('extra_data->>received', 'eq', 'true')
        .order('created_at', { ascending: false });
      if (error) { console.error('[Prodotti] fetchItems error:', error); throw error; }
      const nonShortage = ((data as ItemWithFile[]) ?? []).filter(
        item => (item.extra_data?.AdjReason ?? '') !== 'shortage',
      );
      console.log('[Prodotti] fetchItems success, count:', nonShortage.length);
      setAllItems(nonShortage);
    } catch (err) {
      console.error('[Prodotti] fetchItems exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchItems(); }, [fetchItems]));

  const handleRefresh = useCallback(() => {
    console.log('[Prodotti] handleRefresh triggered');
    setRefreshing(true);
    fetchItems();
  }, [fetchItems]);

  const filteredItems = activeFilter === 'Tutti'
    ? allItems
    : activeFilter === 'Ricevuti'
      ? allItems.filter(item => item.status !== 'completed')
      : allItems.filter(item => item.status === 'completed');

  const ricevutiCount = allItems.filter(item => item.status !== 'completed').length;
  const lavoratiCount = allItems.filter(item => item.status === 'completed').length;

  const handleFilterPress = useCallback((filter: FilterOption) => {
    console.log('[Prodotti] filter changed to:', filter);
    setActiveFilter(filter);
  }, []);

  const handleItemPress = useCallback((item: ItemWithFile) => {
    const identifier = item.original_data?.['PkgID'] ?? item.original_data?.['LPN'] ?? item.item_code;
    console.log('[Prodotti] item pressed:', { id: item.id, identifier });
    router.push(`/item/${item.id}` as any);
  }, [router]);

  const renderItem = useCallback(({ item, index }: { item: ItemWithFile; index: number }) => {
    const identifier = item.original_data?.['PkgID'] ?? item.original_data?.['LPN'] ?? item.item_code;
    const isCompleted = item.status === 'completed';
    const itemStatus = item.status as 'pending' | 'processing' | 'completed';
    const adjReason = item.extra_data?.AdjReason ?? '';
    const hasAdjReason = adjReason.trim().length > 0;
    const od = item.original_data ?? {};
    const legacyDescKey = Object.keys(od).find(k => k.toLowerCase() === 'itemdesc');
    const descValue =
      (od['Title'] as string | undefined) ??
      (od['title'] as string | undefined) ??
      (od['descrizione'] as string | undefined) ??
      (od['Descrizione'] as string | undefined) ??
      (legacyDescKey ? (od[legacyDescKey] as string | undefined) : undefined) ??
      '—';

    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable onPress={() => handleItemPress(item)}>
          <View style={{
            backgroundColor: isCompleted ? '#F0FDF4' : COLORS.surface,
            borderRadius: 14,
            padding: 16,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: isCompleted ? '#86EFAC' : COLORS.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}>
            <View style={{
              width: 40, height: 40, borderRadius: 10,
              backgroundColor: isCompleted ? '#DCFCE7' : COLORS.primaryMuted,
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Package size={18} color={isCompleted ? '#16A34A' : COLORS.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 2 }} numberOfLines={1}>
                {identifier}
              </Text>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                {descValue}
              </Text>
              <View style={{ marginTop: 6 }}>
                {hasAdjReason
                  ? <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' }}>{adjReason}</Text>
                  : <ItemStatusBadge status={itemStatus} size="sm" />
                }
              </View>
            </View>
            <ChevronRight size={18} color={COLORS.textTertiary} />
          </View>
        </AnimatedPressable>
      </AnimatedListItem>
    );
  }, [handleItemPress]);

  const totalCount = filteredItems.length;
  const countLabel = `${ricevutiCount} ricevuti · ${lavoratiCount} lavorati`;
  const filters: FilterOption[] = ['Tutti', 'Ricevuti', 'Lavorati'];

  const listHeader = (
    <View style={{ marginBottom: 8 }}>
      <View style={{
        backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 14,
        borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Package size={16} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
            {totalCount}
            <Text style={{ fontWeight: '400' }}> articoli</Text>
          </Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 1 }}>{countLabel}</Text>
        </View>
      </View>
      <View style={{
        flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 10,
        borderWidth: 1, borderColor: COLORS.border, padding: 3, marginBottom: 12, alignSelf: 'flex-start',
      }}>
        {filters.map(filter => {
          const isActive = activeFilter === filter;
          return (
            <TouchableOpacity
              key={filter}
              onPress={() => handleFilterPress(filter)}
              style={{
                paddingHorizontal: 18, paddingVertical: 7, borderRadius: 8,
                backgroundColor: isActive ? COLORS.primary : 'transparent',
                borderWidth: isActive ? 0 : 1,
                borderColor: isActive ? 'transparent' : COLORS.border,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? '#FFFFFF' : COLORS.textSecondary }}>
                {filter}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const emptyState = (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
      <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Package size={32} color={COLORS.primary} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessun articolo in magazzino
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Gli articoli ricevuti nella sezione Ricezione appariranno qui.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Prodotti',
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[Prodotti] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />
      {loading ? (
        <View style={{ padding: 16, paddingBottom: 120 }}>
          <SkeletonList count={5} />
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        />
      )}
    </View>
  );
}
