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
  }, []);

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


  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    console.log('[Lavorazione] fetchItems called');
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('*, supplier_files(file_name, extra_columns)')
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
    setSelectedColumn(col);
    setSearchQuery('');
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    console.log('[Lavorazione] search query changed:', text);
    setSearchQuery(text);
  }, []);

  const handleItemPress = useCallback((item: ItemWithFile) => {
    const identifier = item.original_data?.['PkgID'] ?? item.original_data?.['LPN'] ?? item.item_code;
    console.log('[Lavorazione] item pressed:', { id: item.id, identifier });
    router.push(`/item/${item.id}` as any);
  }, [router]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item, index }: { item: ItemWithFile; index: number }) => {
    const identifier = item.original_data?.['PkgID'] ?? item.original_data?.['LPN'] ?? item.item_code;
    const fileName = item.supplier_files?.file_name ?? '—';
    const itemStatus = item.status as 'pending' | 'processing' | 'completed';
    const isCompleted = item.status === 'completed';

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
                {(() => {
                    const data = item.original_data ?? {};
                    const key = Object.keys(data).find(k => k.toLowerCase() === 'itemdesc');
                    return key ? (data[key] || '—') : '—';
                  })()}
              </Text>
              <View style={{ marginTop: 6 }}>
                <ItemStatusBadge status={itemStatus} size="sm" />
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
          console.log('[Lavorazione] barcode scanned:', code);
          setSearchQuery(code);
          setScannerVisible(false);
        }}
        hint="Scansiona il codice articolo"
      />
    </View>
  );
}
