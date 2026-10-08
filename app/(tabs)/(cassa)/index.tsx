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
import { Camera, ShoppingCart, Trash2, CheckCircle, X, DollarSign, Package } from 'lucide-react-native';
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
    const datoVendita = extraData?.['Dati di Vendita'];
    if (datoVendita && typeof datoVendita === 'object') {
      const dv = datoVendita as Record<string, unknown>;
      const raw = dv['PREZZO DI VENDITA'] ?? dv['Prezzo di Vendita'] ?? dv['prezzo_di_vendita'] ?? 0;
      return Number(raw) || 0;
    }
    const raw = extraData?.['PREZZO DI VENDITA'] ?? extraData?.['prezzo_di_vendita'] ?? 0;
    return Number(raw) || 0;
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
  const [scannerVisible, setScannerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Chiusura cassa modal
  const [showChiusuraModal, setShowChiusuraModal] = useState(false);
  const [incassatoOperatore, setIncassatoOperatore] = useState('');
  const [chiudendo, setChiudendo] = useState(false);
  const [chiusuraError, setChiusuraError] = useState<string | null>(null);
  const [totaleGiornaliero, setTotaleGiornaliero] = useState(0);

  const searchInputRef = useRef<TextInput>(null);

  const totaleCarrello = cart.reduce((sum, item) => sum + item.prezzo, 0);

  // ── Lookup item ────────────────────────────────────────────────────────────

  const lookupItem = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    console.log('[Cassa] lookupItem called for code:', trimmed);
    setSearching(true);
    setSearchError(null);
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data')
        .or(`item_code.eq.${trimmed},extra_data->>PkgID.eq.${trimmed}`)
        .limit(1)
        .single();

      if (error || !data) {
        console.log('[Cassa] item not found for code:', trimmed);
        setSearchError(`Articolo non trovato: ${trimmed}`);
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
  }, [cart]);

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
    console.log('[Cassa] Conferma Vendita pressed — items:', cart.length, 'totale:', totaleCarrello);
    setConfirming(true);
    try {
      const movimenti = cart.map(item => ({
        item_id: item.id,
        tipo: 'vendita',
        prezzo: item.prezzo,
      }));
      const { error: movErr } = await db.from('movimenti').insert(movimenti);
      if (movErr) throw movErr;

      // Update item status to sold
      const ids = cart.map(i => i.id);
      await db.from('supplier_items').update({ status: 'completed' }).in('id', ids);

      console.log('[Cassa] Vendita completata, items:', cart.length, 'totale:', totaleCarrello);
      Alert.alert('Vendita completata', `${cart.length} articoli venduti per ${formatCurrency(totaleCarrello)}`, [
        { text: 'OK', onPress: () => setCart([]) },
      ]);
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
    console.log('[Cassa] Chiusura Cassa button pressed');
    setChiusuraError(null);
    setIncassatoOperatore('');
    // Calcola totale giornaliero dalle vendite di oggi
    const today = new Date();
    const isoToday = today.toISOString().split('T')[0];
    const tomorrow = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    try {
      const { data, error } = await db
        .from('movimenti')
        .select('prezzo')
        .eq('tipo', 'vendita')
        .gte('created_at', isoToday)
        .lt('created_at', tomorrow);
      if (!error && data) {
        const tot = (data as { prezzo: number }[]).reduce((sum, m) => sum + (Number(m.prezzo) || 0), 0);
        console.log('[Cassa] totale giornaliero calcolato:', tot);
        setTotaleGiornaliero(tot);
      }
    } catch (err) {
      console.error('[Cassa] calcolo totale giornaliero error:', err);
    }
    setShowChiusuraModal(true);
  };

  const handleConfermaChiusura = async () => {
    console.log('[Cassa] Conferma Chiusura pressed — incassato operatore:', incassatoOperatore);
    if (!incassatoOperatore.trim()) {
      setChiusuraError("Inserisci l'importo incassato");
      return;
    }
    const incassato = Number(incassatoOperatore.replace(',', '.'));
    if (isNaN(incassato)) {
      setChiusuraError('Importo non valido');
      return;
    }
    setChiudendo(true);
    setChiusuraError(null);
    try {
      const { error } = await db.from('chiusure_cassa').insert({
        totale_calcolato: totaleGiornaliero,
        incassato_operatore: incassato,
        operatore: user?.username ?? null,
        data_chiusura: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
      console.log('[Cassa] Chiusura cassa salvata — calcolato:', totaleGiornaliero, 'incassato:', incassato);
      setShowChiusuraModal(false);
      Alert.alert('Chiusura completata', `Totale calcolato: ${formatCurrency(totaleGiornaliero)}\nIncassato: ${formatCurrency(incassato)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante la chiusura';
      console.error('[Cassa] chiusura error:', msg);
      setChiusuraError(msg);
    } finally {
      setChiudendo(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderCartItem = ({ item }: { item: CartItem }) => {
    const prezzoLabel = formatCurrency(item.prezzo);
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
        <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.primary, marginRight: 4 }}>{prezzoLabel}</Text>
        <AnimatedPressable onPress={() => handleRemove(item.id)}>
          <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={15} color={COLORS.danger} />
          </View>
        </AnimatedPressable>
      </View>
    );
  };

  const totaleLabel = formatCurrency(totaleCarrello);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Cassa' }} />

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
              <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 4 }}>
                Scansiona gli articoli da vendere
              </Text>
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
                borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ShoppingCart size={18} color={COLORS.primary} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>{cart.length} articoli</Text>
                </View>
                <Text style={{ fontSize: 18, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3 }}>{totaleLabel}</Text>
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
                    Conferma Vendita {cart.length > 0 ? `· ${totaleLabel}` : ''}
                  </Text>
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
            {/* Totale calcolato */}
            <View style={{
              backgroundColor: COLORS.primaryMuted, borderRadius: 14, padding: 18, marginBottom: 20,
              borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center',
            }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Totale Giornaliero Calcolato
              </Text>
              <Text style={{ fontSize: 32, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.5 }}>
                {formatCurrency(totaleGiornaliero)}
              </Text>
            </View>

            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Importo Incassato dall'Operatore *
            </Text>
            <TextInput
              value={incassatoOperatore}
              onChangeText={setIncassatoOperatore}
              placeholder="es. 1250.00"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="decimal-pad"
              style={{
                backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 18, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, marginBottom: 24,
                fontWeight: '600',
              }}
            />

            {chiusuraError ? (
              <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ color: COLORS.danger, fontSize: 13 }}>{chiusuraError}</Text>
              </View>
            ) : null}

            <AnimatedPressable onPress={handleConfermaChiusura} style={{ opacity: chiudendo ? 0.7 : 1 }}>
              <View style={{
                backgroundColor: COLORS.warning, borderRadius: 14, paddingVertical: 16,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: COLORS.warning, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
              }}>
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
