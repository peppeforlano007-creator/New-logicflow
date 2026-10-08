import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Camera, ArrowLeft, Package, Trash2, CheckCircle, ChevronDown, Search, X } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScannedItem {
  id: string;
  item_code: string;
  identifier: string;
  desc: string;
  lotto_provenienza: string | null;
}

type Lotto = {
  id: string;
  codice_lotto: string;
  note: string | null;
  stato: string;
};

// ─── Lotto stato badge ────────────────────────────────────────────────────────

function LottoStatoBadge({ stato }: { stato: string }) {
  const isCaricato = stato === 'caricato';
  const isScaricato = stato === 'scaricato';
  const bgColor = isCaricato ? '#D1FAE5' : isScaricato ? '#FEE2E2' : '#DBEAFE';
  const textColor = isCaricato ? '#065F46' : isScaricato ? '#991B1B' : '#1E40AF';
  const label = isCaricato ? 'Caricato' : isScaricato ? 'Scaricato' : 'Magazzino';
  return (
    <View style={{ backgroundColor: bgColor, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: textColor }}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScaricaScreen() {
  const router = useRouter();

  const [scannerVisible, setScannerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  // Nuovo lotto destinazione
  const [nuovoLotto, setNuovoLotto] = useState<Lotto | null>(null);
  const [lottiDisponibili, setLottiDisponibili] = useState<Lotto[]>([]);
  const [lottoModalVisible, setLottoModalVisible] = useState(false);
  const [lottoSearch, setLottoSearch] = useState('');
  const [loadingLotti, setLoadingLotti] = useState(false);

  // ── Load lotti at mount ──────────────────────────────────────────────────────
  const fetchLotti = useCallback(async () => {
    console.log('[Scarico] fetchLotti called');
    setLoadingLotti(true);
    try {
      const { data, error } = await db
        .from('lotti')
        .select('id, codice_lotto, note, stato')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[Scarico] fetchLotti error:', error);
        return;
      }
      console.log('[Scarico] lotti fetched:', data?.length ?? 0);
      setLottiDisponibili((data ?? []) as Lotto[]);
    } finally {
      setLoadingLotti(false);
    }
  }, []);

  useEffect(() => {
    fetchLotti();
  }, [fetchLotti]);

  // ── Lookup item ──────────────────────────────────────────────────────────────
  const lookupItem = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    console.log('[Scarico] lookupItem called for code:', trimmed);
    setSearching(true);
    setSearchError(null);
    try {
      const { data, error } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id')
        .or(`item_code.eq.${trimmed},original_data->>PkgID.eq.${trimmed},original_data->>LPN.eq.${trimmed}`)
        .limit(1)
        .single();

      if (error || !data) {
        console.log('[Scarico] item not found for code:', trimmed);
        setSearchError(`Articolo non trovato: ${trimmed}`);
        return;
      }

      const identifier =
        data.original_data?.['PkgID'] ??
        data.original_data?.['LPN'] ??
        data.item_code;
      const descKey = Object.keys(data.original_data ?? {}).find(
        (k: string) => k.toLowerCase() === 'itemdesc'
      );
      const desc = descKey ? ((data.original_data ?? {})[descKey] || '—') : '—';

      // Check duplicate
      if (scannedItems.some(i => i.id === data.id)) {
        console.log('[Scarico] item already scanned:', identifier);
        setSearchError(`Articolo già scansionato: ${identifier}`);
        return;
      }

      // Fetch lotto provenienza if present
      let lotto_provenienza: string | null = null;
      if (data.lotto_id) {
        console.log('[Scarico] fetching lotto provenienza for lotto_id:', data.lotto_id);
        const { data: lottoData } = await db
          .from('lotti')
          .select('codice_lotto')
          .eq('id', data.lotto_id)
          .single();
        lotto_provenienza = lottoData?.codice_lotto ?? null;
        console.log('[Scarico] lotto provenienza:', lotto_provenienza);
      }

      const newItem: ScannedItem = {
        id: data.id,
        item_code: data.item_code,
        identifier,
        desc,
        lotto_provenienza,
      };
      console.log('[Scarico] item added to list:', identifier, 'lotto_provenienza:', lotto_provenienza);
      setScannedItems(prev => [newItem, ...prev]);
      setSearchQuery('');
    } catch (err) {
      console.error('[Scarico] lookupItem exception:', err);
      setSearchError('Errore durante la ricerca');
    } finally {
      setSearching(false);
    }
  }, [scannedItems]);

  const handleRemoveItem = (id: string) => {
    console.log('[Scarico] remove item pressed, id:', id);
    setScannedItems(prev => prev.filter(i => i.id !== id));
  };

  // ── Lotto selector ───────────────────────────────────────────────────────────
  const lottoSearchLower = lottoSearch.toLowerCase();
  const filteredLotti = lottoSearch.trim() === ''
    ? lottiDisponibili
    : lottiDisponibili.filter(l =>
        l.codice_lotto.toLowerCase().includes(lottoSearchLower) ||
        (l.note ?? '').toLowerCase().includes(lottoSearchLower)
      );

  const handleLottoSelect = (lotto: Lotto) => {
    console.log('[Scarico] lotto destinazione selected:', lotto.codice_lotto);
    setNuovoLotto(lotto);
    setLottoModalVisible(false);
    setLottoSearch('');
  };

  // ── Conferma scarico ─────────────────────────────────────────────────────────
  const handleConfermaScario = async () => {
    if (scannedItems.length === 0) {
      Alert.alert('Nessun articolo', 'Scansiona almeno un articolo prima di confermare.');
      return;
    }
    if (!nuovoLotto) {
      Alert.alert('Lotto mancante', 'Seleziona un lotto di destinazione prima di confermare.');
      return;
    }
    console.log('[Scarico] Conferma Scarico pressed — items:', scannedItems.length, 'nuovoLotto:', nuovoLotto.codice_lotto);
    setConfirming(true);
    try {
      // INSERT movimenti tipo='scarico' per ogni articolo
      const movimenti = scannedItems.map(item => ({
        lotto_id: nuovoLotto.id,
        articolo_id: item.id,
        tipo: 'scarico',
      }));
      console.log('[Scarico] inserting movimenti:', movimenti.length);
      const { error: movErr } = await db.from('movimenti').insert(movimenti);
      if (movErr) throw movErr;

      // UPDATE supplier_items — sposta articoli al nuovo lotto
      const itemIds = scannedItems.map(i => i.id);
      console.log('[Scarico] updating supplier_items lotto_id for', itemIds.length, 'items');
      const { error: siErr } = await db
        .from('supplier_items')
        .update({ lotto_id: nuovoLotto.id })
        .in('id', itemIds);
      if (siErr) throw siErr;

      console.log('[Scarico] Scarico completato con successo, items:', scannedItems.length, 'lotto:', nuovoLotto.codice_lotto);
      Alert.alert(
        'Scarico completato',
        `${scannedItems.length} articoli spostati nel lotto ${nuovoLotto.codice_lotto}.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante lo scarico';
      console.error('[Scarico] conferma error:', msg);
      Alert.alert('Errore', msg);
    } finally {
      setConfirming(false);
    }
  };

  // ── Render item card ─────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: ScannedItem }) => (
    <View style={{
      backgroundColor: COLORS.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: COLORS.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 9,
        backgroundColor: COLORS.primaryMuted,
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Package size={16} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>
          {item.identifier}
        </Text>
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
          {item.desc}
        </Text>
        {item.lotto_provenienza ? (
          <View style={{
            alignSelf: 'flex-start',
            backgroundColor: COLORS.statusImportedBg,
            borderRadius: 5,
            paddingHorizontal: 6,
            paddingVertical: 2,
            marginTop: 2,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.statusImported }}>
              {item.lotto_provenienza}
            </Text>
          </View>
        ) : null}
      </View>
      <AnimatedPressable onPress={() => handleRemoveItem(item.id)}>
        <View style={{
          width: 36, height: 36, borderRadius: 9,
          backgroundColor: COLORS.dangerMuted,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Trash2 size={16} color={COLORS.danger} />
        </View>
      </AnimatedPressable>
    </View>
  );

  // ── Lotto selector button ────────────────────────────────────────────────────
  const lottoButtonLabel = nuovoLotto ? nuovoLotto.codice_lotto : 'Seleziona lotto destinazione...';
  const lottoButtonIsPlaceholder = !nuovoLotto;

  // ── Footer: lotto selector + confirm button ──────────────────────────────────
  const ListFooter = scannedItems.length > 0 ? (
    <View style={{ marginTop: 8, gap: 10 }}>
      {/* Lotto destinazione selector */}
      <View style={{ gap: 6 }}>
        <Text style={{
          fontSize: 12, fontWeight: '600', color: COLORS.textSecondary,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          Lotto destinazione
        </Text>
        <AnimatedPressable
          onPress={() => {
            console.log('[Scarico] lotto destinazione selector pressed');
            setLottoModalVisible(true);
          }}
        >
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: nuovoLotto ? COLORS.primary : COLORS.border,
            paddingHorizontal: 14,
            paddingVertical: 13,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{
                fontSize: 15,
                color: lottoButtonIsPlaceholder ? COLORS.textTertiary : COLORS.text,
                fontWeight: lottoButtonIsPlaceholder ? '400' : '700',
              }} numberOfLines={1}>
                {lottoButtonLabel}
              </Text>
              {nuovoLotto?.note ? (
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                  {nuovoLotto.note}
                </Text>
              ) : null}
            </View>
            {loadingLotti
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <ChevronDown size={16} color={nuovoLotto ? COLORS.primary : COLORS.textSecondary} style={{ marginLeft: 6 }} />
            }
          </View>
        </AnimatedPressable>
      </View>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Scarico Articoli',
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[Scarico] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />

      <FlatList
        data={scannedItems}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 160, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
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
                    console.log('[Scarico] onSubmitEditing — code:', searchQuery);
                    lookupItem(searchQuery);
                  }}
                />
              </View>
              <AnimatedPressable onPress={() => { console.log('[Scarico] scanner button pressed'); setScannerVisible(true); }}>
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

            <Text style={{
              fontSize: 13, fontWeight: '600', color: COLORS.textSecondary,
              textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8,
            }}>
              Articoli scansionati ({scannedItems.length})
            </Text>
          </View>
        }
        ListFooterComponent={ListFooter}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 18,
              backgroundColor: COLORS.primaryMuted,
              alignItems: 'center', justifyContent: 'center', marginBottom: 12,
            }}>
              <Camera size={28} color={COLORS.primary} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 6, textAlign: 'center' }}>
              Nessun articolo scansionato
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 }}>
              Scansiona i barcode degli articoli da scaricare
            </Text>
          </View>
        }
      />

      {/* Bottom action */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: COLORS.surface, padding: 16, paddingBottom: 32,
        borderTopWidth: 1, borderTopColor: COLORS.border,
      }}>
        <AnimatedPressable
          onPress={() => {
            console.log('[Scarico] Conferma Scarico button pressed — items:', scannedItems.length, 'nuovoLotto:', nuovoLotto?.codice_lotto ?? 'none');
            handleConfermaScario();
          }}
          style={{ opacity: confirming || scannedItems.length === 0 ? 0.6 : 1 }}
        >
          <View style={{
            backgroundColor: scannedItems.length === 0 ? COLORS.textTertiary : COLORS.primary,
            borderRadius: 14, paddingVertical: 16,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: scannedItems.length === 0 ? 0 : 0.25, shadowRadius: 8,
            elevation: scannedItems.length === 0 ? 0 : 4,
          }}>
            {confirming
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <>
                  <CheckCircle size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    Conferma Scarico ({scannedItems.length})
                  </Text>
                </>
              )
            }
          </View>
        </AnimatedPressable>
      </View>

      {/* Article scanner modal */}
      <ScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={(code) => {
          console.log('[Scarico] barcode scanned from camera:', code);
          setScannerVisible(false);
          lookupItem(code);
        }}
        hint="Scansiona il barcode dell'articolo"
      />

      {/* Lotto destinazione modal */}
      <Modal
        visible={lottoModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          console.log('[Scarico] lotto modal closed');
          setLottoModalVisible(false);
          setLottoSearch('');
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{
            backgroundColor: COLORS.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '80%',
            paddingBottom: Platform.OS === 'ios' ? 34 : 16,
          }}>
            {/* Handle bar */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border }} />
            </View>

            {/* Header */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
            }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text }}>
                Seleziona Lotto Destinazione
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log('[Scarico] lotto modal close button pressed');
                  setLottoModalVisible(false);
                  setLottoSearch('');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search input */}
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.border,
                paddingHorizontal: 10,
                gap: 8,
              }}>
                <Search size={16} color={COLORS.textSecondary} />
                <TextInput
                  value={lottoSearch}
                  onChangeText={(v) => {
                    console.log('[Scarico] lotto search changed:', v);
                    setLottoSearch(v);
                  }}
                  placeholder="Cerca per codice o descrizione..."
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ flex: 1, paddingVertical: 9, fontSize: 14, color: COLORS.text }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* List */}
            <FlatList
              data={filteredLotti}
              keyExtractor={(l) => l.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: lotto }) => {
                const isSelected = nuovoLotto?.id === lotto.id;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      console.log('[Scarico] lotto row pressed:', lotto.codice_lotto);
                      handleLottoSelect(lotto);
                    }}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      backgroundColor: isSelected ? COLORS.primaryMuted : 'transparent',
                    }}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
                        {lotto.codice_lotto}
                      </Text>
                      {lotto.note ? (
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                          {lotto.note}
                        </Text>
                      ) : null}
                    </View>
                    <LottoStatoBadge stato={lotto.stato} />
                    {isSelected && (
                      <View style={{
                        width: 18, height: 18, borderRadius: 9,
                        backgroundColor: COLORS.primary,
                        alignItems: 'center', justifyContent: 'center',
                        marginLeft: 4,
                      }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>
                    {loadingLotti ? 'Caricamento...' : 'Nessun lotto trovato'}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
