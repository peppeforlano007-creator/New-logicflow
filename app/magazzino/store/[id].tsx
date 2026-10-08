import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Animated,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Store, ArrowLeft, Layers, Package } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';

interface StoreItem {
  id: string;
  nome: string;
  indirizzo: string | null;
  active: boolean;
}

interface LottoAttivo {
  id: string;
  codice_lotto: string;
  stato: string;
  total_articoli: number;
}

interface MovimentoRecente {
  id: string;
  tipo: string;
  created_at: string;
  lotto_id: string;
}

function AnimatedSection({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

export default function DettaglioStoreScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [store, setStore] = useState<StoreItem | null>(null);
  const [lottiAttivi, setLottiAttivi] = useState<LottoAttivo[]>([]);
  const [movimentiRecenti, setMovimentiRecenti] = useState<MovimentoRecente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    console.log('[DettaglioStore] fetchData called for id:', id);
    try {
      const [storeRes, lottiRes, movRes] = await Promise.all([
        db.from('stores').select('*').eq('id', id).single(),
        db.from('lotti_con_articoli').select('*').eq('store_id', id).in('stato', ['caricato']),
        db.from('movimenti').select('*').eq('store_id', id).order('created_at', { ascending: false }).limit(20),
      ]);
      if (storeRes.error) throw storeRes.error;
      console.log('[DettaglioStore] store:', storeRes.data?.nome, '| lotti attivi:', lottiRes.data?.length ?? 0, '| movimenti:', movRes.data?.length ?? 0);
      setStore(storeRes.data as StoreItem);
      setLottiAttivi((lottiRes.data as LottoAttivo[]) ?? []);
      setMovimentiRecenti((movRes.data as MovimentoRecente[]) ?? []);
    } catch (err) {
      console.error('[DettaglioStore] fetchData exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const handleRefresh = useCallback(() => {
    console.log('[DettaglioStore] handleRefresh triggered');
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getTipoColor = (tipo: string) => {
    switch (tipo) {
      case 'carico': return COLORS.primary;
      case 'scarico': return COLORS.warning;
      case 'vendita': return COLORS.statusProcessing;
      default: return COLORS.textSecondary;
    }
  };

  const getTipoBg = (tipo: string) => {
    switch (tipo) {
      case 'carico': return COLORS.primaryMuted;
      case 'scarico': return COLORS.warningMuted;
      case 'vendita': return COLORS.statusProcessingBg;
      default: return COLORS.surfaceSecondary;
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Store', headerShown: true }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!store) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Store non trovato', headerShown: true }} />
        <Text style={{ color: COLORS.textSecondary, fontSize: 16 }}>Store non trovato</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: store.nome,
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[DettaglioStore] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
      >
        {/* Store header card */}
        <AnimatedSection index={0}>
          <View style={{
            backgroundColor: COLORS.surface, borderRadius: 16, padding: 18,
            borderWidth: 1, borderColor: COLORS.border, marginBottom: 20,
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: store.active ? COLORS.primaryMuted : COLORS.surfaceSecondary,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Store size={24} color={store.active ? COLORS.primary : COLORS.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.text, letterSpacing: -0.2 }}>
                  {store.nome}
                </Text>
                {store.indirizzo ? (
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{store.indirizzo}</Text>
                ) : null}
                <View style={{ marginTop: 6 }}>
                  <View style={{
                    backgroundColor: store.active ? COLORS.primaryMuted : COLORS.surfaceSecondary,
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start',
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: store.active ? COLORS.primary : COLORS.textSecondary }}>
                      {store.active ? 'Attivo' : 'Inattivo'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </AnimatedSection>

        {/* Lotti attivi */}
        <AnimatedSection index={1}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Lotti Attivi ({lottiAttivi.length})
          </Text>
          {lottiAttivi.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' }}>Nessun lotto attivo</Text>
            </View>
          ) : (
            lottiAttivi.map(lotto => (
              <AnimatedPressable key={lotto.id} onPress={() => {
                console.log('[DettaglioStore] lotto pressed:', lotto.codice_lotto);
                router.push(`/magazzino/lotto/${lotto.id}` as any);
              }}>
                <View style={{
                  backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                  borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
                }}>
                  <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center' }}>
                    <Layers size={18} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>{lotto.codice_lotto}</Text>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{lotto.total_articoli ?? 0} articoli</Text>
                  </View>
                </View>
              </AnimatedPressable>
            ))
          )}
        </AnimatedSection>

        {/* Movimenti recenti */}
        <AnimatedSection index={2}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 8 }}>
            Movimenti Recenti ({movimentiRecenti.length})
          </Text>
          {movimentiRecenti.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' }}>Nessun movimento</Text>
            </View>
          ) : (
            movimentiRecenti.map(mov => {
              const tipoColor = getTipoColor(mov.tipo);
              const tipoBg = getTipoBg(mov.tipo);
              const dateLabel = formatDate(mov.created_at);
              return (
                <View key={mov.id} style={{
                  backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                  borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
                }}>
                  <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: tipoBg, alignItems: 'center', justifyContent: 'center' }}>
                    <Package size={16} color={tipoColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ backgroundColor: tipoBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 }}>
                        <Text style={{ fontSize: 11, fontWeight: '600', color: tipoColor, textTransform: 'capitalize' }}>{mov.tipo}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{dateLabel}</Text>
                  </View>
                </View>
              );
            })
          )}
        </AnimatedSection>
      </ScrollView>
    </View>
  );
}
