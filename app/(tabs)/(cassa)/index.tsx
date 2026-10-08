import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Camera, ShoppingCart, Trash2, CheckCircle, X, DollarSign, Package, Store } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  id: string;
  item_code: string;
  identifier: string;
  desc: string;
  prezzo: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPrezzo(extraData: Record<string, unknown>): number {
  try {
    const diretto = extraData?.['PrezzoVendita'];
    if (diretto !== undefined && diretto !== '') {
      const n = Number(String(diretto).replace(',', '.'));
      if (!isNaN(n) && n > 0) return n;
    }
    const datoVendita = extraData?.['Dati di Vendita'];
    if (datoVendita && typeof datoVendita === 'object') {
      const dv = datoVendita as Record<string, unknown>;
      const raw = dv['PREZZO DI VENDITA'] ?? dv['Prezzo di Vendita'] ?? 0;
      return Number(raw) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

function formatCurrency(val: number): string {
  return `€ ${Number(val).toFixed(2)}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CassaScreen() {
  const { user } = useAuth();

  // Store state
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeNome, setStoreNome] = useState<string>('');
  const [scontoPercentuale, setScontoPercentuale] = useState<number>(0);
  const [storeError, setStoreError] = useState(false);
  const [loadingStore, setLoadingStore] = useState(true);

  // Cart state
  const [scannerVisible, setScannerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Chiusura cassa modal
  const [showChiusuraModal, setShowChiusuraModal] = useState(false);
  const [incassatoPos, setIncassatoPos] = useState('');
  const [incassatoContanti, setIncassatoContanti] = useState('');
  const [spese, setSpese] = useState('');
  const [scontiCassa, setScontiCassa] = useState('');
  const [buoni, setBuoni] = useState('');
  const [restituiti, setRestituiti] = useState('');
  const [chiudendo, setChiudendo] = useState(false);
  const [chiusuraError, setChiusuraError] = useState<string | null>(null);
  const [totaleGiornaliero, setTotaleGiornaliero] = useState(0);

  const searchInputRef = useRef<TextInput>(null);

  // ── Totale con sconto ───────────────────────────────────────────────────────

  const totaleOriginale = cart.reduce((sum, item) => sum + item.prezzo, 0);
  const totaleCarrello = scontoPercentuale > 0
    ? totaleOriginale * (1 - scontoPercentuale / 100)
    : totaleOriginale;

  // ── Load store assignment ───────────────────────────────────────────────────

  const loadStoreAssignment = useCallback(async () => {
    if (!user?.id) return;
    console.log('[Cassa] loadStoreAssignment — user.id:', user.id);
    setLoadingStore(true);
    setStoreError(false);
    try {
      const { data: suData, error } = await db
        .from('store_utenti')
        .select('store_id, sconto_percentuale, stores(id, nome)')
        .eq('user_id', user.id)
        .single();

      if (error || !suData) {
        console.log('[Cassa] store assignment not found for user:', user.id, error?.message);
        setStoreError(true);
        return;
      }

      const storeRecord = Array.isArray(suData.stores) ? suData.stores[0] : suData.stores;
      const nome = (storeRecord as { nome?: string } | null)?.nome ?? '';
      const sconto = Number(suData.sconto_percentuale) || 0;

      console.log('[Cassa] store loaded — id:', suData.store_id, 'nome:', nome, 'sconto:', sconto);
      setStoreId(suData.store_id);
      setStoreNome(nome);
      setScontoPercentuale(sconto);
    } catch (err) {
      console.error('[Cassa] loadStoreAssignment exception:', err);
      setStoreError(true);
    } finally {
      setLoadingStore(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      console.log('[Cassa] tab focused — reloading store assignment');
      loadStoreAssignment();
    }, [loadStoreAssignment])
  );

  // ── Lookup item ────────────────────────────────────────────────────────────

  const lookupItem = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    console.log('[Cassa] lookupItem called for code:', trimmed, 'storeId:', storeId);
    setSearching(true);
    setSearchError(null);
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id')
        .or(`item_code.eq.${trimmed},original_data->>LPN.eq.${trimmed},extra_data->>SKU.eq.${trimmed}`)
        .limit(1)
        .single();

      if (error || !data) {
        console.log('[Cassa] item not found for code:', trimmed);
        setSearchError(`Articolo non trovato: ${trimmed}`);
        return;
      }

      // Verifica che l'articolo sia in un lotto di questo store
      if (data.lotto_id) {
        console.log('[Cassa] verifying lotto store scope — lotto_id:', data.lotto_id);
        const { data: lottoData } = await db
          .from('lotti')
          .select('store_id, stato')
          .eq('id', data.lotto_id)
          .single();

        if (!lottoData || lottoData.store_id !== storeId || lottoData.stato !== 'caricato') {
          console.log('[Cassa] item not available in this store — lotto store_id:', lottoData?.store_id, 'expected:', storeId, 'stato:', lottoData?.stato);
          setSearchError(`Articolo non disponibile in questo store`);
          return;
        }
      }

      // Verifica che l'articolo non sia già stato venduto in questo store
      const { data: vendutoCheck } = await db
        .from('movimenti')
        .select('id')
        .eq('articolo_id', data.id)
        .eq('store_id', storeId)
        .eq('tipo', 'vendita')
        .limit(1)
        .single();

      if (vendutoCheck) {
        console.log('[Cassa] item already sold in this store — articolo_id:', data.id, 'store_id:', storeId);
        setSearchError(`Articolo già venduto in questo store`);
        return;
      }

      const identifier = data.original_data?.['PkgID'] ?? data.original_data?.['LPN'] ?? data.item_code;
      const descKey = Object.keys(data.original_data ?? {}).find((k: string) => k.toLowerCase() === 'itemdesc');
      const desc = descKey ? ((data.original_data ?? {})[descKey] || '—') : '—';
      const prezzo = extractPrezzo(data.extra_data ?? {});

      if (cart.some(i => i.id === data.id)) {
        console.log('[Cassa] item already in cart:', identifier);
        setSearchError(`Articolo già nel carrello: ${identifier}`);
        return;
      }

      const newItem: CartItem = { id: data.id, item_code: data.item_code, identifier, desc, prezzo };
      console.log('[Cassa] item added to cart:', identifier, 'prezzo:', prezzo);
      setCart(prev => [newItem, ...prev]);
      setSearchQuery('');
    } catch (err) {
      console.error('[Cassa] lookupItem exception:', err);
      setSearchError('Errore durante la ricerca');
    } finally {
      setSearching(false);
    }
  }, [cart, storeId]);

  // ── Remove from cart ───────────────────────────────────────────────────────

  const handleRemove = (id: string) => {
    console.log('[Cassa] remove item from cart, id:', id);
    setCart(prev => prev.filter(i => i.id !== id));
  };

  // ── Conferma vendita ───────────────────────────────────────────────────────

  const handleConfermaVendita = async () => {
    if (cart.length === 0) {
      Alert.alert('Carrello vuoto', 'Aggiungi almeno un articolo prima di confermare.');
      return;
    }
    console.log('[Cassa] Conferma Vendita pressed — items:', cart.length, 'totaleOriginale:', totaleOriginale, 'totaleCarrello:', totaleCarrello, 'sconto:', scontoPercentuale);
    setConfirming(true);
    try {
      const prezzoUnitarioMoltiplicatore = scontoPercentuale > 0 ? (1 - scontoPercentuale / 100) : 1;
      const movimenti = cart.map(item => ({
        articolo_id: item.id,
        store_id: storeId,
        tipo: 'vendita',
        prezzo: item.prezzo * prezzoUnitarioMoltiplicatore,
      }));
      const { error: movErr } = await db.from('movimenti').insert(movimenti);
      if (movErr) throw movErr;

      // Update item status to sold
      const ids = cart.map(i => i.id);
      await db.from('supplier_items').update({ status: 'completed' }).in('id', ids);

      console.log('[Cassa] Vendita completata — items:', cart.length, 'totale scontato:', totaleCarrello);
      setCart([]);
      setSearchQuery('');
      Alert.alert('Vendita completata', `${cart.length} articoli venduti per ${formatCurrency(totaleCarrello)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante la vendita';
      console.error('[Cassa] conferma vendita error:', msg);
      Alert.alert('Errore', msg);
    } finally {
      setConfirming(false);
    }
  };

  // ── Chiusura cassa ─────────────────────────────────────────────────────────

  const handleOpenChiusura = async () => {
    console.log('[Cassa] Chiusura Cassa button pressed — storeId:', storeId);
    setChiusuraError(null);
    setIncassatoPos('');
    setIncassatoContanti('');
    setSpese('');
    setScontiCassa('');
    setBuoni('');
    setRestituiti('');
    const today = new Date();
    const isoToday = today.toISOString().split('T')[0];
    const tomorrow = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    try {
      let query = db
        .from('movimenti')
        .select('prezzo')
        .eq('tipo', 'vendita')
        .gte('created_at', isoToday)
        .lt('created_at', tomorrow);

      if (storeId) {
        query = query.eq('store_id', storeId);
      }

      const { data, error } = await query;
      if (!error && data) {
        const tot = (data as { prezzo: number }[]).reduce((sum, m) => sum + (Number(m.prezzo) || 0), 0);
        console.log('[Cassa] totale giornaliero calcolato per store', storeId, ':', tot);
        setTotaleGiornaliero(tot);
      }
    } catch (err) {
      console.error('[Cassa] calcolo totale giornaliero error:', err);
    }
    setShowChiusuraModal(true);
  };

  const handleConfermaChiusura = async () => {
    const toNum = (v: string) => Number(v.replace(',', '.')) || 0;
    const pos = toNum(incassatoPos);
    const contanti = toNum(incassatoContanti);
    const speseVal = toNum(spese);
    const scontiVal = toNum(scontiCassa);
    const buoniVal = toNum(buoni);
    const restituitiVal = toNum(restituiti);

    // Totale operatore = POS + Contanti - Spese - Sconti - Buoni - Restituiti
    const totaleOperatore = pos + contanti - speseVal - scontiVal - buoniVal - restituitiVal;
    const diff = totaleOperatore - totaleGiornaliero;

    console.log('[Cassa] Conferma Chiusura pressed — pos:', pos, 'contanti:', contanti, 'spese:', speseVal, 'sconti:', scontiVal, 'buoni:', buoniVal, 'restituiti:', restituitiVal, 'totaleOperatore:', totaleOperatore, 'diff:', diff, 'storeId:', storeId);

    setChiudendo(true);
    setChiusuraError(null);
    try {
      const { error } = await db.from('chiusure_cassa').insert({
        store_id: storeId,
        data: new Date().toISOString().split('T')[0],
        venduto_calcolato: totaleGiornaliero,
        incassato_operatore: totaleOperatore,
        incassato_pos: pos,
        incassato_contanti: contanti,
        spese: speseVal,
        sconti: scontiVal,
        buoni: buoniVal,
        restituiti: restituitiVal,
      });
      if (error) throw error;
      console.log('[Cassa] Chiusura cassa salvata — calcolato:', totaleGiornaliero, 'totaleOperatore:', totaleOperatore, 'diff:', diff, 'store:', storeId);
      setShowChiusuraModal(false);
      const diffLabel = diff >= 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff);
      Alert.alert(
        diff === 0 ? 'Chiusura OK ✓' : diff > 0 ? 'Chiusura con eccedenza' : 'Chiusura con ammanco',
        `Venduto calcolato: ${formatCurrency(totaleGiornaliero)}\nTotale operatore: ${formatCurrency(totaleOperatore)}\nDifferenza: ${diffLabel}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante la chiusura';
      console.error('[Cassa] chiusura error:', msg);
      setChiusuraError(msg);
    } finally {
      setChiudendo(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const screenTitle = storeNome ? `Cassa · ${storeNome}` : 'Cassa';
  const totaleLabel = formatCurrency(totaleCarrello);
  const totaleOriginaleLabel = formatCurrency(totaleOriginale);
  const scontoLabel = `Sconto ${scontoPercentuale}%`;
  const hasSconto = scontoPercentuale > 0;

  // ── Loading store ──────────────────────────────────────────────────────────

  if (loadingStore) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Cassa' }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // ── Store error ────────────────────────────────────────────────────────────

  if (storeError) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Stack.Screen options={{ title: 'Cassa' }} />
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Store size={32} color={COLORS.danger} />
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 8 }}>
          Store non assegnato
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
          Non sei assegnato a nessuno store. Contatta il tuo store manager.
        </Text>
      </View>
    );
  }

  // ── Cart item renderer ─────────────────────────────────────────────────────

  const renderCartItem = ({ item }: { item: CartItem }) => {
    const prezzoLabel = formatCurrency(item.prezzo);
    const prezzScontato = hasSconto ? formatCurrency(item.prezzo * (1 - scontoPercentuale / 100)) : null;
    return (
      <View style={{
        backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
        borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Package size={16} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>{item.identifier}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>{item.desc}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
          {hasSconto ? (
            <>
              <Text style={{ fontSize: 11, color: COLORS.textTertiary, textDecorationLine: 'line-through' }}>{prezzoLabel}</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.success ?? '#22c55e' }}>{prezzScontato}</Text>
            </>
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.primary }}>{prezzoLabel}</Text>
          )}
        </View>
        <AnimatedPressable onPress={() => handleRemove(item.id)}>
          <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={15} color={COLORS.danger} />
          </View>
        </AnimatedPressable>
      </View>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: screenTitle }} />

      <FlatList
        data={cart}
        keyExtractor={item => item.id}
        renderItem={renderCartItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 220, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            {/* Header */}
            <View style={{ marginBottom: 20, marginTop: 8 }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 }}>
                Cassa
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>
                  {storeNome}
                </Text>
                {hasSconto && (
                  <View style={{ backgroundColor: '#dcfce7', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#16a34a' }}>{scontoLabel}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Scan input */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={{
                flex: 1, backgroundColor: COLORS.surface, borderRadius: 12,
                borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12,
              }}>
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Scansiona o inserisci codice..."
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ fontSize: 14, color: COLORS.text, padding: 0 }}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    console.log('[Cassa] onSubmitEditing — code:', searchQuery);
                    lookupItem(searchQuery);
                  }}
                />
              </View>
              <AnimatedPressable onPress={() => { console.log('[Cassa] scanner button pressed'); setScannerVisible(true); }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 12,
                  backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center',
                }}>
                  {searching
                    ? <ActivityIndicator size="small" color={COLORS.primary} />
                    : <Camera size={22} color={COLORS.primary} />
                  }
                </View>
              </AnimatedPressable>
            </View>

            {searchError ? (
              <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <Text style={{ color: COLORS.danger, fontSize: 13 }}>{searchError}</Text>
              </View>
            ) : null}

            {cart.length > 0 && (
              <View style={{
                backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginTop: 8,
                borderWidth: 1, borderColor: COLORS.border,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ShoppingCart size={18} color={COLORS.primary} />
                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>{cart.length}</Text>
                    <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>articoli</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {hasSconto ? (
                      <>
                        <Text style={{ fontSize: 12, color: COLORS.textTertiary, textDecorationLine: 'line-through' }}>{totaleOriginaleLabel}</Text>
                        <Text style={{ fontSize: 20, fontWeight: '800', color: '#16a34a', letterSpacing: -0.3 }}>{totaleLabel}</Text>
                      </>
                    ) : (
                      <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3 }}>{totaleLabel}</Text>
                    )}
                  </View>
                </View>
                {hasSconto && (
                  <View style={{ marginTop: 8, backgroundColor: '#dcfce7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#16a34a' }}>{scontoLabel}</Text>
                  </View>
                )}
              </View>
            )}

            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 4 }}>
              Carrello ({cart.length})
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <ShoppingCart size={28} color={COLORS.primary} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 6, textAlign: 'center' }}>
              Carrello vuoto
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 }}>
              Scansiona il barcode di un articolo per aggiungerlo
            </Text>
          </View>
        }
      />

      {/* Bottom actions */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: COLORS.surface, padding: 16, paddingBottom: 32,
        borderTopWidth: 1, borderTopColor: COLORS.border, gap: 10,
      }}>
        <AnimatedPressable onPress={handleConfermaVendita} style={{ opacity: confirming || cart.length === 0 ? 0.6 : 1 }}>
          <View style={{
            backgroundColor: cart.length === 0 ? COLORS.textTertiary : COLORS.primary,
            borderRadius: 14, paddingVertical: 15,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: cart.length === 0 ? 0 : 0.25, shadowRadius: 8, elevation: cart.length === 0 ? 0 : 4,
          }}>
            {confirming
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <CheckCircle size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    Conferma Vendita
                  </Text>
                  {cart.length > 0 && (
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '700' }}>
                      · {totaleLabel}
                    </Text>
                  )}
                </>
            }
          </View>
        </AnimatedPressable>

        <AnimatedPressable onPress={handleOpenChiusura}>
          <View style={{
            backgroundColor: COLORS.warningMuted, borderRadius: 14, paddingVertical: 13,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            borderWidth: 1, borderColor: COLORS.warning,
          }}>
            <DollarSign size={16} color={COLORS.warning} />
            <Text style={{ color: COLORS.warning, fontSize: 14, fontWeight: '700' }}>Chiusura Cassa</Text>
          </View>
        </AnimatedPressable>
      </View>

      {/* Scanner */}
      <ScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={(code) => {
          console.log('[Cassa] barcode scanned from camera:', code);
          setScannerVisible(false);
          lookupItem(code);
        }}
        hint="Scansiona il barcode dell'articolo"
      />

      {/* Chiusura Cassa Modal */}
      <Modal visible={showChiusuraModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Chiusura Cassa</Text>
            <AnimatedPressable onPress={() => { console.log('[Cassa] chiusura modal dismissed'); setShowChiusuraModal(false); }}>
              <View style={{ padding: 4 }}>
                <X size={22} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {storeNome ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <Store size={14} color={COLORS.textSecondary} />
                <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{storeNome}</Text>
              </View>
            ) : null}

            {/* Totale calcolato */}
            <View style={{ backgroundColor: COLORS.primaryMuted, borderRadius: 14, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Venduto Calcolato</Text>
              <Text style={{ fontSize: 32, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.5 }}>{formatCurrency(totaleGiornaliero)}</Text>
            </View>

            {/* Campi incasso */}
            {[
              { label: 'Incassato POS', value: incassatoPos, setter: setIncassatoPos },
              { label: 'Incassato Contanti', value: incassatoContanti, setter: setIncassatoContanti },
              { label: 'Spese', value: spese, setter: setSpese },
              { label: 'Sconti', value: scontiCassa, setter: setScontiCassa },
              { label: 'Buoni', value: buoni, setter: setBuoni },
              { label: 'Restituiti', value: restituiti, setter: setRestituiti },
            ].map(({ label, value, setter }) => {
              const fieldKey = label;
              return (
                <View key={fieldKey} style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</Text>
                  <TextInput
                    value={value}
                    onChangeText={(text) => { console.log('[Cassa] chiusura field changed —', label, ':', text); setter(text); }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType="decimal-pad"
                    style={{ backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, fontWeight: '600' }}
                  />
                </View>
              );
            })}

            {/* Totale operatore calcolato in tempo reale */}
            {(() => {
              const toNum = (v: string) => Number(v.replace(',', '.')) || 0;
              const totOp = toNum(incassatoPos) + toNum(incassatoContanti) - toNum(spese) - toNum(scontiCassa) - toNum(buoni) - toNum(restituiti);
              const diff = totOp - totaleGiornaliero;
              const isOk = Math.abs(diff) < 0.01;
              const isPos = diff > 0.01;
              return (
                <View style={{ backgroundColor: isOk ? COLORS.statusCompletedBg : isPos ? COLORS.statusImportedBg : COLORS.dangerMuted, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: isOk ? COLORS.statusCompleted : isPos ? COLORS.statusImported : COLORS.danger }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Totale operatore</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>{formatCurrency(totOp)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Differenza</Text>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: isOk ? COLORS.statusCompleted : isPos ? COLORS.statusImported : COLORS.danger }}>
                      {isOk ? '✓ Quadra' : (diff > 0 ? '+' : '') + formatCurrency(diff)}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {chiusuraError ? (
              <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ color: COLORS.danger, fontSize: 13 }}>{chiusuraError}</Text>
              </View>
            ) : null}

            <AnimatedPressable onPress={handleConfermaChiusura} style={{ opacity: chiudendo ? 0.7 : 1 }}>
              <View style={{ backgroundColor: COLORS.warning, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.warning, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }}>
                {chiudendo
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Salva Chiusura Cassa</Text>
                }
              </View>
            </AnimatedPressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
