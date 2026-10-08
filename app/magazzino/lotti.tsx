import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Layers, Plus, ChevronRight, ArrowLeft, X } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { SkeletonList } from '@/components/SkeletonLoader';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

type LottoStato = 'magazzino' | 'caricato' | 'scaricato';
type FilterOption = 'Tutti' | 'Magazzino' | 'Caricato' | 'Scaricato';

interface LottoConArticoli {
  id: string;
  codice_lotto: string;
  stato: LottoStato;
  store_id: string | null;
  store_nome: string | null;
  total_articoli: number;
  note: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatoColor(stato: LottoStato): string {
  switch (stato) {
    case 'magazzino': return COLORS.statusImported;
    case 'caricato': return COLORS.primary;
    case 'scaricato': return COLORS.textSecondary;
    default: return COLORS.textSecondary;
  }
}

function getStatoBg(stato: LottoStato): string {
  switch (stato) {
    case 'magazzino': return COLORS.statusImportedBg;
    case 'caricato': return COLORS.primaryMuted;
    case 'scaricato': return COLORS.surfaceSecondary;
    default: return COLORS.surfaceSecondary;
  }
}

function getStatoLabel(stato: LottoStato): string {
  switch (stato) {
    case 'magazzino': return 'Magazzino';
    case 'caricato': return 'Caricato';
    case 'scaricato': return 'Scaricato';
    default: return stato;
  }
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
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LottiScreen() {
  const router = useRouter();
  const [lotti, setLotti] = useState<LottoConArticoli[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterOption>('Tutti');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCodice, setNewCodice] = useState('');
  const [newNote, setNewNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchLotti = useCallback(async () => {
    console.log('[Lotti] fetchLotti called');
    try {
      const { data, error } = await db
        .from('lotti_con_articoli')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.error('[Lotti] fetchLotti error:', error); throw error; }
      console.log('[Lotti] fetchLotti success, count:', data?.length ?? 0);
      setLotti((data as LottoConArticoli[]) ?? []);
    } catch (err) {
      console.error('[Lotti] fetchLotti exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchLotti(); }, [fetchLotti]));

  const handleRefresh = useCallback(() => {
    console.log('[Lotti] handleRefresh triggered');
    setRefreshing(true);
    fetchLotti();
  }, [fetchLotti]);

  const filteredLotti = lotti.filter(l => {
    if (activeFilter === 'Tutti') return true;
    if (activeFilter === 'Magazzino') return l.stato === 'magazzino';
    if (activeFilter === 'Caricato') return l.stato === 'caricato';
    if (activeFilter === 'Scaricato') return l.stato === 'scaricato';
    return true;
  });

  const handleFilterPress = (filter: FilterOption) => {
    console.log('[Lotti] filter changed to:', filter);
    setActiveFilter(filter);
  };

  const handleLottoPress = (lotto: LottoConArticoli) => {
    console.log('[Lotti] lotto pressed:', lotto.codice_lotto, 'id:', lotto.id);
    router.push(`/magazzino/lotto/${lotto.id}` as any);
  };

  const handleOpenCreate = () => {
    console.log('[Lotti] FAB pressed — open create modal');
    setNewCodice('');
    setNewNote('');
    setCreateError(null);
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    console.log('[Lotti] Crea Lotto button pressed, codice:', newCodice);
    if (!newCodice.trim()) {
      setCreateError('Il codice lotto è obbligatorio');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const { error } = await db.from('lotti').insert({
        codice_lotto: newCodice.trim(),
        stato: 'magazzino',
        note: newNote.trim() || null,
      });
      if (error) throw error;
      console.log('[Lotti] Lotto created successfully:', newCodice.trim());
      setShowCreateModal(false);
      fetchLotti();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore creazione lotto';
      console.error('[Lotti] create error:', msg);
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const renderItem = useCallback(({ item, index }: { item: LottoConArticoli; index: number }) => {
    const statoColor = getStatoColor(item.stato);
    const statoBg = getStatoBg(item.stato);
    const statoLabel = getStatoLabel(item.stato);
    const articoliLabel = `${item.total_articoli ?? 0} articoli`;

    return (
      <AnimatedListItem index={index}>
        <AnimatedPressable onPress={() => handleLottoPress(item)}>
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            padding: 16,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: COLORS.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}>
            <View style={{
              width: 42, height: 42, borderRadius: 11,
              backgroundColor: statoBg,
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Layers size={20} color={statoColor} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 3 }} numberOfLines={1}>
                {item.codice_lotto}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ backgroundColor: statoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: statoColor }}>{statoLabel}</Text>
                </View>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{articoliLabel}</Text>
                {item.store_nome ? (
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                    · {item.store_nome}
                  </Text>
                ) : null}
              </View>
            </View>
            <ChevronRight size={18} color={COLORS.textTertiary} />
          </View>
        </AnimatedPressable>
      </AnimatedListItem>
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: FilterOption[] = ['Tutti', 'Magazzino', 'Caricato', 'Scaricato'];

  const listHeader = (
    <View style={{ marginBottom: 8 }}>
      <View style={{
        flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 10,
        borderWidth: 1, borderColor: COLORS.border, padding: 3, marginBottom: 12, flexWrap: 'wrap', gap: 2,
      }}>
        {filters.map(filter => {
          const isActive = activeFilter === filter;
          return (
            <TouchableOpacity
              key={filter}
              onPress={() => handleFilterPress(filter)}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
                backgroundColor: isActive ? COLORS.primary : 'transparent',
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
      <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.statusImportedBg, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Layers size={32} color={COLORS.statusImported} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessun lotto trovato
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Crea il primo lotto con il pulsante +
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Lotti',
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[Lotti] back pressed'); router.back(); }}>
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
          data={filteredLotti}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        />
      )}

      {/* FAB */}
      <AnimatedPressable onPress={handleOpenCreate} style={{
        position: 'absolute', bottom: 32, right: 20,
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: COLORS.primary,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
      }}>
        <Plus size={26} color="#fff" />
      </AnimatedPressable>

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Nuovo Lotto</Text>
            <AnimatedPressable onPress={() => { console.log('[Lotti] create modal dismissed'); setShowCreateModal(false); }}>
              <View style={{ padding: 4 }}>
                <X size={22} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>
          <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Codice Lotto *
            </Text>
            <TextInput
              value={newCodice}
              onChangeText={setNewCodice}
              placeholder="es. LOT-2024-001"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
              }}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Note (opzionale)
            </Text>
            <TextInput
              value={newNote}
              onChangeText={setNewNote}
              placeholder="Note sul lotto..."
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, marginBottom: 24,
                minHeight: 80, textAlignVertical: 'top',
              }}
              multiline
            />
            {createError ? (
              <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ color: COLORS.danger, fontSize: 13 }}>{createError}</Text>
              </View>
            ) : null}
            <AnimatedPressable onPress={handleCreate} style={{ opacity: creating ? 0.7 : 1 }}>
              <View style={{
                backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
              }}>
                {creating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Crea Lotto</Text>
                }
              </View>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
