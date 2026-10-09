import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  RefreshControl,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Layers, ArrowLeft, Store, X, Check, Package } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { SkeletonList } from '@/components/SkeletonLoader';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

type LottoStato = 'magazzino' | 'caricato' | 'scaricato';

interface Lotto {
  id: string;
  codice_lotto: string;
  stato: LottoStato;
  store_id: string | null;
  note: string | null;
  created_at: string;
}

interface LottoArticolo {
  id: string;
  item_code: string;
  original_data: Record<string, string>;
  extra_data: Record<string, string>;
  status: string;
  venduto?: boolean;
  quantita?: number;
  quantita_disponibile?: number;
}

interface StoreItem {
  id: string;
  nome: string;
  indirizzo: string | null;
  active: boolean;
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
    case 'magazzino': return 'In Magazzino';
    case 'caricato': return 'Caricato';
    case 'scaricato': return 'Scaricato';
    default: return stato;
  }
}

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, delay: index * 50, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []);
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DettaglioLottoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [lotto, setLotto] = useState<Lotto | null>(null);
  const [articoli, setArticoli] = useState<LottoArticolo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Carica a Store modal
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [selectedStore, setSelectedStore] = useState<StoreItem | null>(null);
  const [caricando, setCaricando] = useState(false);
  const [caricaError, setCaricaError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    console.log('[DettaglioLotto] fetchData called for id:', id);
    try {
      const [lottoRes, articoliRes] = await Promise.all([
        db.from('lotti').select('*').eq('id', id).single(),
        db.rpc('get_lotto_articoli', { p_lotto_id: id }),
      ]);
      if (lottoRes.error) { console.error('[DettaglioLotto] lotto error:', lottoRes.error); throw lottoRes.error; }
      if (articoliRes.error) { console.error('[DettaglioLotto] articoli error:', articoliRes.error); throw articoliRes.error; }
      console.log('[DettaglioLotto] lotto:', lottoRes.data?.codice_lotto, '| articoli:', articoliRes.data?.length ?? 0);
      setLotto(lottoRes.data as Lotto);
      setArticoli((articoliRes.data as LottoArticolo[]) ?? []);
    } catch (err) {
      console.error('[DettaglioLotto] fetchData exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const handleRefresh = useCallback(() => {
    console.log('[DettaglioLotto] handleRefresh triggered');
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // ── Carica a Store ─────────────────────────────────────────────────────────

  const handleOpenStoreModal = async () => {
    console.log('[DettaglioLotto] "Carica a Store" button pressed');
    setSelectedStore(null);
    setCaricaError(null);
    setShowStoreModal(true);
    setLoadingStores(true);
    try {
      const { data, error } = await db.from('stores').select('*').eq('active', true).order('nome');
      if (error) throw error;
      console.log('[DettaglioLotto] stores loaded:', data?.length ?? 0);
      setStores((data as StoreItem[]) ?? []);
    } catch (err) {
      console.error('[DettaglioLotto] load stores error:', err);
    } finally {
      setLoadingStores(false);
    }
  };

  const handleConfermaCarico = async () => {
    if (!selectedStore || !lotto) return;
    setCaricando(true);
    setCaricaError(null);
    try {
      // For each article, compute how many units belong to THIS lotto
      const articoliConQta = articoli.map(a => {
        const ed = (a as any).extra_data ?? {};
        const units: any[] = Array.isArray(ed.units) ? ed.units : [];
        let qtaPerLotto: number;
        if (units.length > 0) {
          // Multi-unit: count only units whose LottoId matches this lotto
          qtaPerLotto = units.filter(u => u?.LottoId === lotto.id).length;
          // If no units match (e.g. single-unit article assigned via lotto_id), fall back to 1
          if (qtaPerLotto === 0) qtaPerLotto = 1;
        } else {
          // Single-unit article: use quantita, capped at 1 for safety
          qtaPerLotto = (a as any).quantita ?? 1;
        }
        return { ...a, qtaPerLotto };
      });

      const totalUnits = articoliConQta.reduce((s, a) => s + a.qtaPerLotto, 0);
      console.log('[DettaglioLotto] Conferma carico — store:', selectedStore.nome, 'lotto:', lotto.codice_lotto, 'articoli:', articoli.length, 'unità per lotto:', totalUnits);

      // INSERT movimenti with per-lotto quantity
      const movimenti = articoliConQta.map(a => ({
        lotto_id: lotto.id,
        store_id: selectedStore.id,
        articolo_id: a.id,
        tipo: 'carico',
        quantita: a.qtaPerLotto,
      }));
      if (movimenti.length > 0) {
        const { error: movErr } = await db.from('movimenti').insert(movimenti);
        if (movErr) throw movErr;
      }

      // UPDATE quantita_disponibile for each article to the per-lotto count
      for (const a of articoliConQta) {
        const currentQtaDisp = (a as any).quantita_disponibile ?? 0;
        const totalQta = (a as any).quantita ?? 1;
        // If quantita_disponibile already equals totalQta, it was set by a previous (wrong) carico — correct it
        // If quantita_disponibile is less than totalQta, accumulate correctly
        const finalQtaDisp = currentQtaDisp >= totalQta
          ? a.qtaPerLotto
          : currentQtaDisp + a.qtaPerLotto;
        await db
          .from('supplier_items')
          .update({ quantita_disponibile: finalQtaDisp })
          .eq('id', a.id);
      }

      // UPDATE lotto stato
      const { error: lottoErr } = await db
        .from('lotti')
        .update({ store_id: selectedStore.id, stato: 'caricato' })
        .eq('id', lotto.id);
      if (lottoErr) throw lottoErr;

      console.log('[DettaglioLotto] Carico completato — store:', selectedStore.nome, 'unità:', totalUnits);
      setShowStoreModal(false);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante il carico';
      console.error('[DettaglioLotto] carico error:', msg);
      setCaricaError(msg);
    } finally {
      setCaricando(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderArticolo = useCallback(({ item, index }: { item: LottoArticolo; index: number }) => {
    const identifier = item.original_data?.['PkgID'] ?? item.original_data?.['LPN'] ?? item.item_code;
    const descKey = Object.keys(item.original_data ?? {}).find(k => k.toLowerCase() === 'itemdesc');
    const descValue = descKey ? ((item.original_data ?? {})[descKey] || '—') : '—';
    const isVenduto = item.venduto === true;
    const qtaTot = (item as any).quantita ?? 1;
    const qtaDisp = (item as any).quantita_disponibile ?? 0;
    const ed = (item as any).extra_data ?? {};
    const units: any[] = Array.isArray(ed.units) ? ed.units : [];
    const qtaPerLotto = units.length > 0
      ? units.filter((u: any) => u?.LottoId === lotto?.id).length || 1
      : qtaTot;
    const showQtyBadge = qtaPerLotto > 1 || (qtaTot > 1 && units.length === 0);
    const isEsaurito = qtaDisp === 0 && qtaTot > 0;

    return (
      <AnimatedListItem index={index}>
        <View style={{
          backgroundColor: isVenduto ? '#F0FDF4' : COLORS.surface,
          borderRadius: 12,
          padding: 14,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isVenduto ? '#86EFAC' : COLORS.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}>
          <View style={{
            width: 36, height: 36, borderRadius: 9,
            backgroundColor: isVenduto ? '#DCFCE7' : COLORS.primaryMuted,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {isVenduto
              ? <Check size={16} color={COLORS.primary} />
              : <Package size={16} color={COLORS.primary} />
            }
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>
              {identifier}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
              {descValue}
            </Text>
            {showQtyBadge && (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {isEsaurito ? (
                  <View style={{ backgroundColor: '#FEE2E2', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#DC2626' }}>Esaurito</Text>
                  </View>
                ) : (
                  <View style={{ backgroundColor: COLORS.primaryMuted, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.primary }}>
                      Qtà: {qtaDisp}/{qtaPerLotto}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
          {isVenduto && (
            <View style={{ backgroundColor: COLORS.primaryMuted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.primary }}>Venduto</Text>
            </View>
          )}
        </View>
      </AnimatedListItem>
    );
  }, [lotto]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <Stack.Screen options={{ title: 'Dettaglio Lotto', headerShown: true }} />
        <View style={{ padding: 16 }}>
          <SkeletonList count={4} />
        </View>
      </View>
    );
  }

  if (!lotto) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Lotto non trovato', headerShown: true }} />
        <Text style={{ color: COLORS.textSecondary, fontSize: 16 }}>Lotto non trovato</Text>
      </View>
    );
  }

  const statoColor = getStatoColor(lotto.stato);
  const statoBg = getStatoBg(lotto.stato);
  const statoLabel = getStatoLabel(lotto.stato);

  // Totale unità e SKU per header
  const totalUnita = articoli.reduce((s, a) => s + ((a as any).quantita ?? 1), 0);
  const totalSku = articoli.length;
  const headerCountLabel = totalUnita !== totalSku
    ? `${totalUnita} unità in ${totalSku} SKU`
    : `${totalSku} articoli`;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: lotto.codice_lotto,
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[DettaglioLotto] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />

      <FlatList
        data={articoli}
        keyExtractor={item => item.id}
        renderItem={renderArticolo}
        contentContainerStyle={{ padding: 16, paddingBottom: 140, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            {/* Header card */}
            <View style={{
              backgroundColor: COLORS.surface, borderRadius: 16, padding: 18,
              borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
              shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: statoBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={22} color={statoColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: COLORS.text, letterSpacing: -0.2 }}>
                    {lotto.codice_lotto}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <View style={{ backgroundColor: statoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: statoColor }}>{statoLabel}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{headerCountLabel}</Text>
                  </View>
                </View>
              </View>
              {lotto.note ? (
                <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontStyle: 'italic' }}>{lotto.note}</Text>
              ) : null}
            </View>

            {/* Action buttons */}
            {lotto.stato === 'magazzino' && (
              <AnimatedPressable onPress={handleOpenStoreModal}>
                <View style={{
                  backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15,
                  alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                  marginBottom: 12,
                  shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
                }}>
                  <Store size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Carica a Store</Text>
                </View>
              </AnimatedPressable>
            )}

            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Articoli ({totalSku})
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>Nessun articolo in questo lotto</Text>
          </View>
        }
      />

      {/* Carica a Store Modal */}
      <Modal visible={showStoreModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Seleziona Store</Text>
            <AnimatedPressable onPress={() => { console.log('[DettaglioLotto] store modal dismissed'); setShowStoreModal(false); }}>
              <View style={{ padding: 4 }}>
                <X size={22} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>

          {loadingStores ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {stores.map(store => {
                const isSelected = selectedStore?.id === store.id;
                return (
                  <AnimatedPressable key={store.id} onPress={() => {
                    console.log('[DettaglioLotto] store selected:', store.nome);
                    setSelectedStore(store);
                  }}>
                    <View style={{
                      backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                      borderRadius: 12, padding: 16, marginBottom: 10,
                      borderWidth: 1.5, borderColor: isSelected ? COLORS.primary : COLORS.border,
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}>
                      <View style={{
                        width: 36, height: 36, borderRadius: 9,
                        backgroundColor: isSelected ? COLORS.primary : COLORS.surfaceSecondary,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Store size={18} color={isSelected ? '#fff' : COLORS.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text }}>{store.nome}</Text>
                        {store.indirizzo ? (
                          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{store.indirizzo}</Text>
                        ) : null}
                      </View>
                      {isSelected && <Check size={20} color={COLORS.primary} />}
                    </View>
                  </AnimatedPressable>
                );
              })}

              {stores.length === 0 && (
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>Nessuno store disponibile</Text>
                </View>
              )}

              {caricaError ? (
                <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginTop: 8 }}>
                  <Text style={{ color: COLORS.danger, fontSize: 13 }}>{caricaError}</Text>
                </View>
              ) : null}

              {selectedStore && (
                <AnimatedPressable onPress={handleConfermaCarico} style={{ marginTop: 16, opacity: caricando ? 0.7 : 1 }}>
                  <View style={{
                    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
                  }}>
                    {caricando
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                          Conferma carico a {selectedStore.nome}
                        </Text>
                    }
                  </View>
                </AnimatedPressable>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
