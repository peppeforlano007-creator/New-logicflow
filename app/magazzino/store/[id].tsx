import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Animated,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Store, ArrowLeft, Layers, Package, TrendingDown, Users, Trash2, X, Plus } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';
import { useAuth } from '@/contexts/AuthContext';

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

interface CassaUtente {
  id: string;
  user_id: string;
  username: string;
  sconto_percentuale: number;
}

function AnimatedSection({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

export default function DettaglioStoreScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [store, setStore] = useState<StoreItem | null>(null);
  const [lottiAttivi, setLottiAttivi] = useState<LottoAttivo[]>([]);
  const [movimentiRecenti, setMovimentiRecenti] = useState<MovimentoRecente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [cassaUtenti, setCassaUtenti] = useState<CassaUtente[]>([]);
  const [showAddCassiere, setShowAddCassiere] = useState(false);
  const [utentiDisponibili, setUtentiDisponibili] = useState<{ id: string; username: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [scontoInput, setScontoInput] = useState('0');
  const [addingCassiere, setAddingCassiere] = useState(false);
  const [addCassiereError, setAddCassiereError] = useState<string | null>(null);

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'store_manager';

  const fetchData = useCallback(async () => {
    if (!id) return;
    console.log('[DettaglioStore] fetchData called for id:', id);
    try {
      const [storeRes, lottiRes, movRes, cassaRes] = await Promise.all([
        db.from('stores').select('*').eq('id', id).single(),
        db.from('lotti_con_articoli').select('*').eq('store_id', id).in('stato', ['caricato']),
        db.from('movimenti').select('*').eq('store_id', id).order('created_at', { ascending: false }).limit(20),
        db.from('store_utenti').select('id, user_id, sconto_percentuale, app_users(username)').eq('store_id', id),
      ]);
      if (storeRes.error) throw storeRes.error;
      console.log('[DettaglioStore] store:', storeRes.data?.nome, '| lotti attivi:', lottiRes.data?.length ?? 0, '| movimenti:', movRes.data?.length ?? 0, '| cassieri:', cassaRes.data?.length ?? 0);
      setStore(storeRes.data as StoreItem);
      setLottiAttivi((lottiRes.data as LottoAttivo[]) ?? []);
      setMovimentiRecenti((movRes.data as MovimentoRecente[]) ?? []);
      const mappedCassa: CassaUtente[] = (cassaRes.data ?? []).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        username: (row.app_users as any)?.username ?? '—',
        sconto_percentuale: Number(row.sconto_percentuale),
      }));
      setCassaUtenti(mappedCassa);
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

  const handleOpenAddCassiere = useCallback(async () => {
    console.log('[DettaglioStore] handleOpenAddCassiere pressed — store_id:', id);
    try {
      const { data } = await db
        .from('app_users')
        .select('id, username, tab_permissions')
        .contains('tab_permissions', ['cassa']);
      const disponibili = (data ?? []).filter((u: any) => !cassaUtenti.some(cu => cu.user_id === u.id));
      console.log('[DettaglioStore] utenti disponibili per cassa:', disponibili.length);
      setUtentiDisponibili(disponibili.map((u: any) => ({ id: u.id, username: u.username })));
      setSelectedUserId(disponibili[0]?.id ?? null);
      setScontoInput('0');
      setAddCassiereError(null);
      setShowAddCassiere(true);
    } catch (err) {
      console.error('[DettaglioStore] handleOpenAddCassiere error:', err);
    }
  }, [id, cassaUtenti]);

  const handleAddCassiere = useCallback(async () => {
    if (!selectedUserId) return;
    console.log('[DettaglioStore] handleAddCassiere — user_id:', selectedUserId, 'sconto:', scontoInput);
    setAddingCassiere(true);
    setAddCassiereError(null);
    try {
      const { error } = await db.from('store_utenti').insert({
        store_id: id,
        user_id: selectedUserId,
        sconto_percentuale: Number(scontoInput.replace(',', '.')) || 0,
      });
      if (error) throw error;
      console.log('[DettaglioStore] cassiere aggiunto con successo');
      setShowAddCassiere(false);
      fetchData();
    } catch (err: any) {
      console.error('[DettaglioStore] handleAddCassiere error:', err);
      setAddCassiereError(err?.message ?? 'Errore durante l\'aggiunta');
    } finally {
      setAddingCassiere(false);
    }
  }, [id, selectedUserId, scontoInput, fetchData]);

  const handleRemoveCassiere = useCallback(async (suId: string) => {
    console.log('[DettaglioStore] handleRemoveCassiere — store_utenti.id:', suId);
    try {
      const { error } = await db.from('store_utenti').delete().eq('id', suId);
      if (error) throw error;
      console.log('[DettaglioStore] cassiere rimosso con successo');
      fetchData();
    } catch (err) {
      console.error('[DettaglioStore] handleRemoveCassiere error:', err);
    }
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

  const cassaCount = cassaUtenti.length;

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

        {/* Inizia Scarico */}
        {lottiAttivi.length > 0 && (
          <AnimatedSection index={2}>
            <AnimatedPressable
              onPress={() => {
                console.log('[DettaglioStore] Inizia Scarico pressed — store_id:', id, 'store_nome:', store.nome);
                router.push({ pathname: '/magazzino/scarico', params: { store_id: id, store_nome: store?.nome ?? '' } } as any);
              }}
            >
              <View style={{
                backgroundColor: COLORS.primary, borderRadius: 14, padding: 16,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginBottom: 20,
                shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
              }}>
                <TrendingDown size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Inizia Scarico</Text>
              </View>
            </AnimatedPressable>
          </AnimatedSection>
        )}

        {/* Gestione Cassa — solo admin e store_manager */}
        {isAdminOrManager && (
          <AnimatedSection index={3}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4 }}>
              Gestione Cassa ({cassaCount})
            </Text>

            {cassaUtenti.length === 0 ? (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' }}>Nessun cassiere assegnato</Text>
              </View>
            ) : (
              cassaUtenti.map(cu => {
                const hasSconto = cu.sconto_percentuale > 0;
                const scontoBg = hasSconto ? COLORS.primaryMuted : COLORS.surfaceSecondary;
                const scontoColor = hasSconto ? COLORS.primary : COLORS.textSecondary;
                const scontoLabel = cu.sconto_percentuale + '%';
                return (
                  <View key={cu.id} style={{
                    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                    borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
                  }}>
                    <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={18} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>{cu.username}</Text>
                      <View style={{ marginTop: 4 }}>
                        <View style={{ backgroundColor: scontoBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, alignSelf: 'flex-start' }}>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: scontoColor }}>
                            Sconto {scontoLabel}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <AnimatedPressable onPress={() => {
                      console.log('[DettaglioStore] remove cassiere pressed — store_utenti.id:', cu.id, 'username:', cu.username);
                      handleRemoveCassiere(cu.id);
                    }}>
                      <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center' }}>
                        <Trash2 size={16} color={COLORS.danger} />
                      </View>
                    </AnimatedPressable>
                  </View>
                );
              })
            )}

            <AnimatedPressable onPress={handleOpenAddCassiere}>
              <View style={{
                borderRadius: 12, padding: 13, marginBottom: 20,
                borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <Plus size={16} color={COLORS.primary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.primary }}>Aggiungi Cassiere</Text>
              </View>
            </AnimatedPressable>
          </AnimatedSection>
        )}

        {/* Movimenti recenti */}
        <AnimatedSection index={isAdminOrManager ? 4 : 3}>
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

      {/* Modal Aggiungi Cassiere */}
      <Modal
        visible={showAddCassiere}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          console.log('[DettaglioStore] modal aggiungi cassiere closed');
          setShowAddCassiere(false);
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: COLORS.background }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Modal header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Aggiungi Cassiere</Text>
            <TouchableOpacity
              onPress={() => {
                console.log('[DettaglioStore] modal X pressed');
                setShowAddCassiere(false);
              }}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {utentiDisponibili.length === 0 ? (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginBottom: 20 }}>
                <Users size={32} color={COLORS.textTertiary} style={{ marginBottom: 10 }} />
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' }}>
                  Nessun utente con permesso cassa disponibile
                </Text>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Seleziona Utente
                </Text>
                <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', marginBottom: 20 }}>
                  {utentiDisponibili.map((u, idx) => {
                    const isSelected = selectedUserId === u.id;
                    const isLast = idx === utentiDisponibili.length - 1;
                    return (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => {
                          console.log('[DettaglioStore] utente selezionato:', u.username, u.id);
                          setSelectedUserId(u.id);
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
                          backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                          borderBottomWidth: isLast ? 0 : 1, borderBottomColor: COLORS.border,
                        }}
                      >
                        <View style={{
                          width: 20, height: 20, borderRadius: 10,
                          borderWidth: 2, borderColor: isSelected ? COLORS.primary : COLORS.border,
                          backgroundColor: isSelected ? COLORS.primary : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSelected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: isSelected ? '600' : '400', color: isSelected ? COLORS.primary : COLORS.text }}>
                          {u.username}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Sconto %
                </Text>
                <View style={{
                  backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
                  paddingHorizontal: 14, paddingVertical: 4, marginBottom: 20,
                }}>
                  <TextInput
                    value={scontoInput}
                    onChangeText={(v) => {
                      console.log('[DettaglioStore] sconto input changed:', v);
                      setScontoInput(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={COLORS.textTertiary}
                    style={{ fontSize: 16, color: COLORS.text, paddingVertical: 12 }}
                  />
                </View>

                {addCassiereError ? (
                  <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                    <Text style={{ color: COLORS.danger, fontSize: 13 }}>{addCassiereError}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={() => {
                    console.log('[DettaglioStore] Aggiungi button pressed — selectedUserId:', selectedUserId, 'sconto:', scontoInput);
                    handleAddCassiere();
                  }}
                  disabled={addingCassiere || !selectedUserId}
                  style={{
                    backgroundColor: addingCassiere || !selectedUserId ? COLORS.surfaceSecondary : COLORS.primary,
                    borderRadius: 14, padding: 16,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: addingCassiere || !selectedUserId ? 0 : 0.25, shadowRadius: 8, elevation: addingCassiere || !selectedUserId ? 0 : 4,
                  }}
                >
                  {addingCassiere ? (
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  ) : (
                    <Text style={{ color: addingCassiere || !selectedUserId ? COLORS.textSecondary : '#fff', fontSize: 16, fontWeight: '700' }}>
                      Aggiungi
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
