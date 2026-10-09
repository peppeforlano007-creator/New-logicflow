import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Package,
  Camera,
  ChevronDown,
  Search,
  X,
  TrendingDown,
} from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ScannerModal } from '@/components/ScannerModal';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreArticolo {
  id: string;
  item_code: string;
  identifier: string;
  desc: string;
  codice_lotto: string;
  lotto_id: string;
  skus: string[];
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
  const { store_id, store_nome } = useLocalSearchParams<{ store_id: string; store_nome: string }>();

  const { toast, showToast, hideToast } = useToast();

  // Store articles
  const [storeArticoli, setStoreArticoli] = useState<StoreArticolo[]>([]);
  const [loadingArticoli, setLoadingArticoli] = useState(true);

  // Search / filter
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  // Selection
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  // Scanner
  const [scannerVisible, setScannerVisible] = useState(false);

  // Lotto destinazione
  const [nuovoLotto, setNuovoLotto] = useState<Lotto | null>(null);
  const [lottiDisponibili, setLottiDisponibili] = useState<Lotto[]>([]);
  const [lottoModalVisible, setLottoModalVisible] = useState(false);
  const [lottoSearch, setLottoSearch] = useState('');
  const [loadingLotti, setLoadingLotti] = useState(false);

  // Confirming
  const [confirming, setConfirming] = useState(false);

  // ── Load store articles ──────────────────────────────────────────────────────
  const fetchStoreArticoli = useCallback(async () => {
    if (!store_id) return;
    console.log('[Scarico] fetchStoreArticoli called for store_id:', store_id);
    setLoadingArticoli(true);
    try {
      const { data: lottiStore, error: lottiErr } = await db
        .from('lotti')
        .select('id, codice_lotto')
        .eq('store_id', store_id)
        .eq('stato', 'caricato');

      if (lottiErr) {
        console.error('[Scarico] fetchStoreArticoli lotti error:', lottiErr);
        return;
      }

      const lottiIds = (lottiStore ?? []).map((l: { id: string; codice_lotto: string }) => l.id);
      console.log('[Scarico] lotti caricati trovati:', lottiIds.length);

      if (lottiIds.length === 0) {
        setStoreArticoli([]);
        return;
      }

      const lottoMap: Record<string, string> = {};
      (lottiStore ?? []).forEach((l: { id: string; codice_lotto: string }) => {
        lottoMap[l.id] = l.codice_lotto;
      });

      const { data: articoli, error: artErr } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id, quantita_disponibile, quantita')
        .in('lotto_id', lottiIds)
        .gt('quantita_disponibile', 0);

      if (artErr) {
        console.error('[Scarico] fetchStoreArticoli articoli error:', artErr);
        return;
      }

      // Also include multi-unit cross-store articles
      const directIds = new Set((articoli ?? []).map((a: any) => a.id));
      const { data: multiItems } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id, quantita_disponibile, quantita')
        .gt('quantita', 1)
        .gt('quantita_disponibile', 0);

      const crossStoreItems = (multiItems ?? []).filter((item: any) => {
        if (directIds.has(item.id)) return false;
        const units: any[] = Array.isArray(item.extra_data?.units) ? item.extra_data.units : [];
        return units.some((u: any) => u?.LottoId && lottiIds.includes(u.LottoId));
      });

      const allArticoli = [...(articoli ?? []), ...crossStoreItems];
      console.log('[Scarico] articoli diretti:', (articoli ?? []).length, '| cross-store:', crossStoreItems.length);

      const mapped: StoreArticolo[] = allArticoli.map((a: {
        id: string;
        item_code: string;
        original_data: Record<string, unknown> | null;
        extra_data: Record<string, unknown> | null;
        lotto_id: string;
        quantita_disponibile: number | null;
        quantita: number | null;
      }) => {
        const od = a.original_data ?? {};
        const identifier =
          (od['PkgID'] as string | undefined) ??
          (od['LPN'] as string | undefined) ??
          a.item_code;
        const legacyDescKey = Object.keys(od).find((k: string) => k.toLowerCase() === 'itemdesc');
        const desc = String(od['Title'] ?? od['title'] ?? od['descrizione'] ?? od['Descrizione'] ?? (legacyDescKey ? (od[legacyDescKey] || '—') : '—'));

        // Extract all SKUs (top-level + per-unit)
        const ed = a.extra_data ?? {};
        const skus: string[] = [];
        const topSku = ed['SKU'];
        if (topSku && String(topSku).trim()) skus.push(String(topSku).trim());
        const units: any[] = Array.isArray(ed['units']) ? ed['units'] : [];
        for (const u of units) {
          const uSku = u?.SKU;
          if (uSku && String(uSku).trim() && !skus.includes(String(uSku).trim())) {
            skus.push(String(uSku).trim());
          }
        }

        // Determine display lotto — prefer the one in this store
        let displayLottoId = a.lotto_id;
        if (!lottiIds.includes(displayLottoId)) {
          const unitInStore = units.find((u: any) => u?.LottoId && lottiIds.includes(u.LottoId));
          if (unitInStore?.LottoId) displayLottoId = unitInStore.LottoId;
        }

        return {
          id: a.id,
          item_code: a.item_code,
          identifier,
          desc,
          codice_lotto: lottoMap[displayLottoId] ?? '—',
          lotto_id: displayLottoId,
          skus,
        };
      });

      console.log('[Scarico] articoli caricati:', mapped.length);
      setStoreArticoli(mapped);
    } catch (err) {
      console.error('[Scarico] fetchStoreArticoli exception:', err);
    } finally {
      setLoadingArticoli(false);
    }
  }, [store_id]);

  // ── Load lotti ───────────────────────────────────────────────────────────────
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
    fetchStoreArticoli();
    fetchLotti();
  }, [fetchStoreArticoli, fetchLotti]);

  // ── Filtered articles ────────────────────────────────────────────────────────
  const queryLower = searchQuery.toLowerCase().trim();
  const filteredArticoli = queryLower === ''
    ? storeArticoli
    : storeArticoli.filter(a =>
        a.identifier.toLowerCase().includes(queryLower) ||
        a.item_code.toLowerCase().includes(queryLower) ||
        a.desc.toLowerCase().includes(queryLower) ||
        a.skus.some(s => s.toLowerCase().includes(queryLower))
      );

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleItem = (id: string) => {
    console.log('[Scarico] toggleItem:', id);
    setSelectedSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    console.log('[Scarico] selectAll pressed — filteredArticoli:', filteredArticoli.length);
    setSelectedSet(new Set(filteredArticoli.map(a => a.id)));
  };

  const deselectAll = () => {
    console.log('[Scarico] deselectAll pressed');
    setSelectedSet(new Set());
  };

  const allSelected = filteredArticoli.length > 0 && filteredArticoli.every(a => selectedSet.has(a.id));

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

  // ── Scanner barcode lookup ───────────────────────────────────────────────────
  const handleBarcodeScan = (code: string) => {
    console.log('[Scarico] barcode scanned:', code);
    setScannerVisible(false);
    const trimmed = code.trim();
    const found = storeArticoli.find(a =>
      a.item_code === trimmed ||
      a.identifier === trimmed ||
      a.skus.some(s => s === trimmed)
    );
    if (found) {
      console.log('[Scarico] barcode match found:', found.identifier);
      setSelectedSet(prev => {
        const next = new Set(prev);
        next.add(found.id);
        return next;
      });
      showToast(`Articolo selezionato: ${found.identifier}`, 'success');
    } else {
      console.log('[Scarico] barcode not found in store:', trimmed);
      showToast('Articolo non trovato in questo store', 'error');
    }
  };

  // ── Conferma scarico ─────────────────────────────────────────────────────────
  const handleConfermaScario = async () => {
    const selectedIds = [...selectedSet];
    console.log('[Scarico] Conferma Scarico pressed — items:', selectedIds.length, 'nuovoLotto:', nuovoLotto?.codice_lotto ?? 'none');
    if (selectedIds.length === 0 || !nuovoLotto) return;
    setConfirming(true);
    try {
      console.log('[Scarico] fetching current items for', selectedIds.length, 'items');
      const { data: currentItems, error: fetchErr } = await db
        .from('supplier_items')
        .select('id, extra_data, quantita')
        .in('id', selectedIds);
      if (fetchErr) throw fetchErr;

      // Build a map of id → quantita for quick lookup
      const qtaMap: Record<string, number> = {};
      (currentItems ?? []).forEach((ci: any) => {
        qtaMap[ci.id] = ci.quantita ?? 1;
      });

      console.log('[Scarico] inserting movimenti:', selectedIds.length);
      const { error: movErr } = await db.from('movimenti').insert(
        selectedIds.map(itemId => ({
          lotto_id: nuovoLotto.id,
          store_id: store_id,
          articolo_id: itemId,
          tipo: 'scarico',
          quantita: qtaMap[itemId] ?? 1,
        }))
      );
      if (movErr) throw movErr;

      console.log('[Scarico] building extra_data updates for lotto:', nuovoLotto.codice_lotto, 'id:', nuovoLotto.id);
      const updatePromises = (currentItems ?? []).map((ci: { id: string; extra_data: Record<string, unknown> | null; quantita: number | null }) => {
        const currentExtra: Record<string, unknown> = { ...(ci.extra_data ?? {}) };
        currentExtra['Lotto'] = nuovoLotto.codice_lotto;
        currentExtra['LottoId'] = nuovoLotto.id;

        const qty = ci.quantita ?? 1;
        if (qty > 1) {
          const units: Record<string, unknown>[] = Array.isArray(currentExtra['units'])
            ? (currentExtra['units'] as Record<string, unknown>[]).map(u => ({
                ...u,
                Lotto: nuovoLotto.codice_lotto,
                LottoId: nuovoLotto.id,
              }))
            : [];
          currentExtra['units'] = units;
          console.log('[Scarico] updated', units.length, 'units in extra_data for item:', ci.id);
        }

        return db
          .from('supplier_items')
          .update({ lotto_id: nuovoLotto.id, extra_data: currentExtra })
          .eq('id', ci.id);
      });

      console.log('[Scarico] updating supplier_items lotto_id + extra_data for', updatePromises.length, 'items → lotto:', nuovoLotto.codice_lotto);
      const results = await Promise.all(updatePromises);
      const siErr = results.find(r => r.error)?.error ?? null;
      if (siErr) throw siErr;

      console.log('[Scarico] scarico completato — items:', selectedIds.length, 'lotto:', nuovoLotto.codice_lotto);

      // ── Riporta i lotti di origine a "magazzino" se rimasti vuoti ──────────
      const originLottoIds = [...new Set(
        selectedIds
          .map(id => storeArticoli.find(a => a.id === id)?.lotto_id)
          .filter((lid): lid is string => !!lid)
      )];
      console.log('[Scarico] lotti di origine da verificare:', originLottoIds);

      for (const lottoId of originLottoIds) {
        const { count } = await db
          .from('supplier_items')
          .select('id', { count: 'exact', head: true })
          .eq('lotto_id', lottoId)
          .gt('quantita_disponibile', 0);

        if ((count ?? 0) === 0) {
          await db
            .from('lotti')
            .update({ stato: 'magazzino', store_id: null })
            .eq('id', lottoId);
          console.log('[Scarico] Lotto', lottoId, 'tornato a magazzino (vuoto dopo scarico)');
        }
      }

      router.back();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante lo scarico';
      console.error('[Scarico] conferma error:', msg);
      showToast(msg, 'error');
    } finally {
      setConfirming(false);
    }
  };

  // ── Derived labels ───────────────────────────────────────────────────────────
  const selectedCount = selectedSet.size;
  const totalCount = filteredArticoli.length;
  const canConfirm = selectedCount > 0 && nuovoLotto !== null;
  const lottoButtonLabel = nuovoLotto ? nuovoLotto.codice_lotto : 'Seleziona lotto destinazione...';
  const lottoButtonIsPlaceholder = !nuovoLotto;
  const confirmLabel = `Conferma Scarico (${selectedCount})`;
  const headerCountLabel = `${totalCount} articoli — ${selectedCount} selezionati`;
  const toggleAllLabel = allSelected ? 'Deseleziona tutti' : 'Seleziona tutti';
  const screenTitle = `Scarico — ${store_nome ?? ''}`;

  // ── Render article card ──────────────────────────────────────────────────────
  const renderArticolo = ({ item }: { item: StoreArticolo }) => {
    const isSelected = selectedSet.has(item.id);
    return (
      <AnimatedPressable onPress={() => toggleItem(item.id)}>
        <View style={{
          backgroundColor: COLORS.surface,
          borderRadius: 12,
          padding: 14,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isSelected ? COLORS.primary : COLORS.border,
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
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }} numberOfLines={1}>
              {item.identifier}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
              {item.desc}
            </Text>
            <View style={{
              alignSelf: 'flex-start',
              backgroundColor: COLORS.statusImportedBg,
              borderRadius: 5,
              paddingHorizontal: 6,
              paddingVertical: 2,
              marginTop: 2,
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.statusImported }}>
                {item.codice_lotto}
              </Text>
            </View>
          </View>
          {/* Checkbox */}
          <View style={{
            width: 24, height: 24, borderRadius: 7,
            backgroundColor: isSelected ? COLORS.primary : 'transparent',
            borderWidth: isSelected ? 0 : 2,
            borderColor: COLORS.border,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {isSelected && (
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#fff' }} />
            )}
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: screenTitle,
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
        data={filteredArticoli}
        keyExtractor={item => item.id}
        renderItem={renderArticolo}
        contentContainerStyle={{ padding: 16, paddingBottom: 200, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            {/* Search + Camera */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <View style={{
                flex: 1, backgroundColor: COLORS.surface, borderRadius: 12,
                borderWidth: 1, borderColor: COLORS.border,
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 12, paddingVertical: 10, gap: 8,
              }}>
                <Search size={16} color={COLORS.textSecondary} />
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={(v) => {
                    console.log('[Scarico] search query changed:', v);
                    setSearchQuery(v);
                  }}
                  placeholder="Cerca per codice, identifier, descrizione..."
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ flex: 1, fontSize: 14, color: COLORS.text, padding: 0 }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => { console.log('[Scarico] clear search pressed'); setSearchQuery(''); }}>
                    <X size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              <AnimatedPressable onPress={() => { console.log('[Scarico] scanner button pressed'); setScannerVisible(true); }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 12,
                  backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Camera size={22} color={COLORS.primary} />
                </View>
              </AnimatedPressable>
            </View>

            {/* Header: count + select all */}
            {loadingArticoli ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 8 }} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textSecondary }}>
                  {headerCountLabel}
                </Text>
                {filteredArticoli.length > 0 && (
                  <AnimatedPressable onPress={() => {
                    console.log('[Scarico] toggle all pressed — allSelected:', allSelected);
                    if (allSelected) { deselectAll(); } else { selectAll(); }
                  }}>
                    <View style={{
                      backgroundColor: COLORS.primaryMuted, borderRadius: 8,
                      paddingHorizontal: 10, paddingVertical: 5,
                    }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.primary }}>
                        {toggleAllLabel}
                      </Text>
                    </View>
                  </AnimatedPressable>
                )}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loadingArticoli ? (
            <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
              <View style={{
                width: 64, height: 64, borderRadius: 18,
                backgroundColor: COLORS.primaryMuted,
                alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <Package size={28} color={COLORS.primary} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 6, textAlign: 'center' }}>
                Nessun articolo trovato
              </Text>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 }}>
                {searchQuery.length > 0 ? 'Nessun articolo corrisponde alla ricerca' : 'Nessun articolo caricato in questo store'}
              </Text>
            </View>
          ) : null
        }
      />

      {/* Bottom bar: lotto selector + confirm */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: COLORS.surface, padding: 16,
        paddingBottom: Platform.OS === 'ios' ? 34 : 16,
        borderTopWidth: 1, borderTopColor: COLORS.border,
        gap: 10,
      }}>
        {/* Lotto destinazione selector */}
        <AnimatedPressable
          onPress={() => {
            console.log('[Scarico] lotto destinazione selector pressed');
            setLottoModalVisible(true);
          }}
        >
          <View style={{
            backgroundColor: COLORS.background,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: nuovoLotto ? COLORS.primary : COLORS.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{
                fontSize: 14,
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

        {/* Confirm button */}
        <AnimatedPressable
          onPress={() => {
            console.log('[Scarico] Conferma Scarico button pressed — selectedCount:', selectedCount, 'nuovoLotto:', nuovoLotto?.codice_lotto ?? 'none');
            handleConfermaScario();
          }}
          style={{ opacity: canConfirm && !confirming ? 1 : 0.5 }}
        >
          <View style={{
            backgroundColor: canConfirm ? COLORS.primary : COLORS.textTertiary,
            borderRadius: 14, paddingVertical: 15,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: canConfirm ? 0.25 : 0, shadowRadius: 8,
            elevation: canConfirm ? 4 : 0,
          }}>
            {confirming
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <>
                  <TrendingDown size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {confirmLabel}
                  </Text>
                </>
              )
            }
          </View>
        </AnimatedPressable>
      </View>

      {/* Scanner modal */}
      <ScannerModal
        visible={scannerVisible}
        onClose={() => { console.log('[Scarico] scanner modal closed'); setScannerVisible(false); }}
        onScanned={handleBarcodeScan}
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

            {/* Search */}
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: COLORS.surface,
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

      {/* Toast */}
      <ToastMessage
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onHide={hideToast}
      />
    </View>
  );
}
