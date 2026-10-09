import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  TextInput,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Wrench, ChevronRight, Package, Camera } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { ItemStatusBadge } from '@/components/StatusBadge';
import { SkeletonList } from '@/components/SkeletonLoader';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import type { SupplierItem } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type ToggleColumn = 'PkgID' | 'LPN';

interface ItemWithFile extends SupplierItem {
  supplier_files: {
    file_name: string;
    extra_columns: string[];
  } | null;
  quantita?: number;
  quantita_disponibile?: number;
}

// ─── AnimatedListItem ─────────────────────────────────────────────────────────

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LavorazioneScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ItemWithFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<ToggleColumn>('PkgID');
  const [searchQuery, setSearchQuery] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref to items so the debounce callback always reads the latest value
  const itemsRef = useRef<ItemWithFile[]>([]);
  const selectedColumnRef = useRef<ToggleColumn>('PkgID');


  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    console.log('[Lavorazione] fetchItems called');
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('id, file_id, row_index, item_code, original_data, extra_data, status, quantita, quantita_disponibile, processed_at, processed_by, created_at, supplier_files(file_name, extra_columns)')
        .in('status', ['processing', 'completed'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Lavorazione] fetchItems error:', error);
        throw error;
      }

      console.log('[Lavorazione] fetchItems success, count:', data?.length ?? 0);
      const sorted = [...((data as ItemWithFile[]) ?? [])].sort((a, b) => {
        if (a.status === b.status) return 0;
        if (a.status === 'processing') return -1;
        return 1;
      });
      setItems(sorted);
      itemsRef.current = sorted;
    } catch (err) {
      console.error('[Lavorazione] fetchItems exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchItems();
    }, [fetchItems]),
  );

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }, []),
  );

  const handleRefresh = useCallback(() => {
    console.log('[Lavorazione] handleRefresh triggered');
    setRefreshing(true);
    fetchItems();
  }, [fetchItems]);

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredItems = searchQuery.trim() === ''
    ? items
    : items.filter(item => {
        const value = String(item.original_data?.[selectedColumn] ?? '');
        return value.toLowerCase().includes(searchQuery.toLowerCase());
      });

  const processingCount = items.filter(i => i.status === 'processing').length;
  const completedCount = items.filter(i => i.status === 'completed').length;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleToggle = useCallback((col: ToggleColumn) => {
    console.log('[Lavorazione] toggle column:', col);
    selectedColumnRef.current = col;
    setSelectedColumn(col);
    setSearchQuery('');
  }, []);

  const navigateIfSingleMatch = useCallback((code: string, col: ToggleColumn) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const currentItems = itemsRef.current;
    const matches = currentItems.filter(item => {
      const value = String(item.original_data?.[col] ?? '');
      return value.toLowerCase().includes(trimmed.toLowerCase());
    });
    console.log('[Lavorazione] debounce/submit — matches:', matches.length, 'for code:', trimmed, '| column:', col);
    if (matches.length === 1) {
      console.log('[Lavorazione] single match — navigating to item:', matches[0].id);
      router.push(`/item/${matches[0].id}` as any);
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [router]);

  const handleSearchChange = useCallback((text: string) => {
    console.log('[Lavorazione] search query changed:', text);
    setSearchQuery(text);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (text.trim().length > 0) {
      debounceTimerRef.current = setTimeout(() => {
        navigateIfSingleMatch(text, selectedColumnRef.current);
      }, 600);
    }
  }, [navigateIfSingleMatch]);

  const handleItemPress = useCallback((item: ItemWithFile) => {
    const identifier = item.original_data?.['LPN'] ?? item.original_data?.['PkgID'] ?? item.item_code;
    console.log('[Lavorazione] item pressed:', { id: item.id, identifier, quantita_disponibile: item.quantita_disponibile });
    router.push(`/item/${item.id}` as any);
  }, [router]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item, index }: { item: ItemWithFile; index: number }) => {
    // Prefer standard keys: LPN first, then PkgID, then item_code
    const identifier = item.original_data?.['LPN'] ?? item.original_data?.['PkgID'] ?? item.item_code;
    const fileName = item.supplier_files?.file_name ?? '—';
    const itemStatus = item.status as 'pending' | 'processing' | 'completed';
    const isCompleted = item.status === 'completed';
    const qtaDisp = item.quantita_disponibile ?? 1;
    const showQtyBadge = qtaDisp > 1;
    const processedUnitsCount = (item.extra_data as any)?.units?.length ?? 0;
    const eanReceived = (item.extra_data as any)?.ean_received_qty;
    const totalLav = (typeof eanReceived === 'number' && eanReceived > 0)
      ? Math.min(eanReceived, item.quantita ?? 1)
      : (item.quantita ?? 1);

    // Use standard Title key, fallback to legacy itemdesc auto-detection, then item_code
    const descValue = (() => {
      const data = item.original_data ?? {};
      if (data['Title']) return data['Title'];
      if (data['title']) return data['title'];
      const key = Object.keys(data).find(k => k.toLowerCase() === 'itemdesc');
      return key ? (data[key] || '—') : '—';
    })();

    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable onPress={() => handleItemPress(item)}>
          <View
            style={{
              backgroundColor: isCompleted ? '#F0FDF4' : COLORS.surface,
              borderRadius: 14,
              padding: 16,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: isCompleted ? '#86EFAC' : COLORS.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {/* Icon */}
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: isCompleted ? '#DCFCE7' : COLORS.statusProcessingBg,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Package size={18} color={isCompleted ? '#16A34A' : COLORS.statusProcessing} />
            </View>

            {/* Text block */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{ fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 2 }}
                numberOfLines={1}
              >
                {identifier}
              </Text>
              <Text
                style={{ fontSize: 12, color: COLORS.textSecondary }}
                numberOfLines={1}
              >
                {descValue}
              </Text>
              <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <ItemStatusBadge status={itemStatus} size="sm" />
                {(totalLav > 1 || (typeof eanReceived === 'number' && eanReceived > 0)) ? (
                  <View style={{
                    backgroundColor: processedUnitsCount === totalLav ? '#D1FAE5' : '#DBEAFE',
                    borderRadius: 6,
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                  }}>
                    <Text style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: processedUnitsCount === totalLav ? '#065F46' : '#1E40AF',
                    }}>
                      {processedUnitsCount}/{totalLav} lav.
                    </Text>
                  </View>
                ) : showQtyBadge ? (
                  <View style={{
                    backgroundColor: COLORS.primaryMuted,
                    borderRadius: 5,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    alignSelf: 'flex-start',
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.primary }}>
                      Qtà: {qtaDisp}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Chevron */}
            <ChevronRight size={18} color={COLORS.textTertiary} />
          </View>
        </AnimatedPressable>
      </AnimatedListItem>
    );
  }, [handleItemPress]);

  // ── Header (summary + toggle + search) ───────────────────────────────────

  const countLabel = `${processingCount} da lavorare · ${completedCount} completati`;

  const listHeader = (
    <View style={{ marginBottom: 8 }}>
      {/* Summary card */}
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
          borderWidth: 1,
          borderColor: COLORS.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            backgroundColor: COLORS.statusProcessingBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Wrench size={16} color={COLORS.statusProcessing} />
        </View>
        <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
          {processingCount}
          <Text style={{ fontWeight: '400' }}> da lavorare · </Text>
          {completedCount}
          <Text style={{ fontWeight: '400' }}> completati</Text>
        </Text>
      </View>

      {/* Toggle label */}
      <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, letterSpacing: 0.4 }}>
        Cerca per:
      </Text>

      {/* PkgID / LPN pill toggle */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: COLORS.surface,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: COLORS.border,
          padding: 3,
          marginBottom: 12,
          alignSelf: 'flex-start',
        }}
      >
        {(['PkgID', 'LPN'] as ToggleColumn[]).map(col => {
          const isActive = selectedColumn === col;
          return (
            <TouchableOpacity
              key={col}
              onPress={() => handleToggle(col)}
              style={{
                paddingHorizontal: 20,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: isActive ? COLORS.primary : 'transparent',
                borderWidth: isActive ? 0 : 1,
                borderColor: isActive ? 'transparent' : COLORS.border,
              }}
              activeOpacity={0.8}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: isActive ? '#FFFFFF' : COLORS.textSecondary,
                }}
              >
                {col}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search input + camera */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: COLORS.surface,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.border,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <TextInput
            ref={searchInputRef}
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Inserisci codice..."
            placeholderTextColor={COLORS.textTertiary}
            style={{ fontSize: 14, color: COLORS.text, padding: 0 }}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => {
              console.log('[Lavorazione] onSubmitEditing — immediate search for:', searchQuery);
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
              navigateIfSingleMatch(searchQuery, selectedColumnRef.current);
            }}

          />
        </View>
        <AnimatedPressable onPress={() => { console.log('[Lavorazione] scanner button pressed'); setScannerVisible(true); }}>
          <View style={{
            width: 44, height: 44,
            borderRadius: 10,
            backgroundColor: COLORS.primaryMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Camera size={22} color={COLORS.primary} />
          </View>
        </AnimatedPressable>
      </View>
    </View>
  );

  // ── Empty state ───────────────────────────────────────────────────────────

  const emptyState = (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: COLORS.statusProcessingBg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Wrench size={32} color={COLORS.statusProcessing} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessun articolo in lavorazione
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Scansiona i colli nella sezione Ricezione per iniziare.
      </Text>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Lavorazione' }} />

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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}
      <ScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={(code) => {
          console.log('[Lavorazione] barcode scanned from camera:', code);
          setScannerVisible(false);
          setSearchQuery(code);
          // Attempt immediate navigation if single match
          setTimeout(() => navigateIfSingleMatch(code, selectedColumnRef.current), 50);
        }}
        hint="Scansiona il codice articolo"
      />
    </View>
  );
}
