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
  TouchableOpacity,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Camera, ShoppingCart, Trash2, CheckCircle, X, DollarSign, Package, Store, List, Minus, Plus } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ScannerModal } from '@/components/ScannerModal';
import { db } from '@/utils/db';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SfogliaItem {
  id: string;
  item_code: string;
  identifier: string;
  desc: string;
  prezzo: number;
  lotto_id: string | null;
  lotto_codice: string;
  quantita_disponibile: number;
  sku: string;
}

interface CartItem {
  id: string;
  item_code: string;
  identifier: string;
  desc: string;
  prezzo: number;
  lotto_id: string | null;
  quantita: number;
  quantita_disponibile: number;
  status: string;
  unitIndex?: number | null;
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

  // Sfoglia articoli modal
  const [showSfogliaModal, setShowSfogliaModal] = useState(false);
  const [sfogliaItems, setSfogliaItems] = useState<SfogliaItem[]>([]);
  const [sfogliaLoading, setSfogliaLoading] = useState(false);
  const [sfogliaFilter, setSfogliaFilter] = useState('');

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

  const totaleOriginale = cart.reduce((sum, item) => sum + item.prezzo * item.quantita, 0);
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

  // ── Load sfoglia items ─────────────────────────────────────────────────────

  const loadSfogliaItems = useCallback(async () => {
    if (!storeId) return;
    console.log('[Cassa] loadSfogliaItems — storeId:', storeId);
    setSfogliaLoading(true);
    try {
      const { data: lottiData } = await db
        .from('lotti')
        .select('id, codice_lotto')
        .eq('store_id', storeId)
        .eq('stato', 'caricato');

      const lottiIds = (lottiData ?? []).map((l: any) => l.id);
      if (lottiIds.length === 0) { setSfogliaItems([]); return; }

      const lottiMap: Record<string, string> = {};
      (lottiData ?? []).forEach((l: any) => { lottiMap[l.id] = l.codice_lotto; });

      // Primary: items directly assigned to this store's lotti
      const { data: directItems } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id, status, quantita_disponibile, quantita')
        .in('lotto_id', lottiIds);

      console.log('[Cassa] sfoglia direct items loaded:', directItems?.length ?? 0);

      // Secondary: multi-unit items whose units[] reference one of this store's lotti (cross-store)
      const directIds = new Set((directItems ?? []).map((i: any) => i.id));

      const { data: multiItems } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id, status, quantita_disponibile, quantita')
        .gt('quantita', 1);

      const crossStoreItems = (multiItems ?? []).filter((item: any) => {
        if (directIds.has(item.id)) return false;
        const units: any[] = Array.isArray(item.extra_data?.units) ? item.extra_data.units : [];
        return units.some((u: any) => u?.LottoId && lottiIds.includes(u.LottoId));
      });

      console.log('[Cassa] sfoglia cross-store items found:', crossStoreItems.length);

      const allItems = [...(directItems ?? []), ...crossStoreItems];

      const result: SfogliaItem[] = allItems
        .map((item: any) => {
          const units: any[] = Array.isArray(item.extra_data?.units) ? item.extra_data.units : [];

          // Compute per-store available quantity
          let qtaPerStore: number;
          if (units.length > 0) {
            qtaPerStore = units.filter((u: any) => u?.LottoId && lottiIds.includes(u.LottoId)).length;
          } else {
            qtaPerStore = item.quantita_disponibile ?? 1;
          }

          if (qtaPerStore <= 0) return null;

          // Determine which lotto to show (prefer the one in this store)
          let displayLottoId = item.lotto_id;
          let displayLottoCodice = item.lotto_id ? (lottiMap[item.lotto_id] ?? '—') : '—';
          if (!lottiIds.includes(displayLottoId) && units.length > 0) {
            const unitInStore = units.find((u: any) => u?.LottoId && lottiIds.includes(u.LottoId));
            if (unitInStore?.LottoId) {
              displayLottoId = unitInStore.LottoId;
              displayLottoCodice = lottiMap[unitInStore.LottoId] ?? unitInStore.Lotto ?? '—';
            }
          }

          const identifier = item.original_data?.['LPN'] ?? item.original_data?.['PkgID'] ?? item.item_code;
          const origData = item.original_data ?? {};
          const legacyDescKey = Object.keys(origData).find((k: string) => k.toLowerCase() === 'itemdesc');
          const desc = origData['Title'] ?? origData['title'] ?? origData['descrizione'] ?? origData['Descrizione'] ?? (legacyDescKey ? (origData[legacyDescKey] || '—') : '—');
          const prezzo = extractPrezzo(item.extra_data ?? {});
          const sku = String((item.extra_data ?? {})['SKU'] ?? '').trim();

          return {
            id: item.id,
            item_code: item.item_code,
            identifier,
            desc,
            prezzo,
            lotto_id: displayLottoId,
            lotto_codice: displayLottoCodice,
            quantita_disponibile: qtaPerStore,
            sku,
          } as SfogliaItem;
        })
        .filter(Boolean) as SfogliaItem[];

      console.log('[Cassa] sfoglia loaded — items disponibili:', result.length);
      setSfogliaItems(result);
    } catch (err) {
      console.error('[Cassa] loadSfogliaItems error:', err);
    } finally {
      setSfogliaLoading(false);
    }
  }, [storeId]);

  // ── Sfoglia select ─────────────────────────────────────────────────────────

  const handleSfogliaSelect = useCallback((item: SfogliaItem) => {
    if (cart.some(i => i.id === item.id)) {
      setSearchError(`Articolo già nel carrello: ${item.identifier}`);
      setShowSfogliaModal(false);
      return;
    }
    const newItem: CartItem = {
      id: item.id,
      item_code: item.item_code,
      identifier: item.identifier,
      desc: item.desc,
      prezzo: item.prezzo,
      lotto_id: item.lotto_id,
      quantita: 1,
      quantita_disponibile: item.quantita_disponibile,
      status: 'processing',
    };
    console.log('[Cassa] sfoglia item selected:', item.identifier, 'qtaDisp:', item.quantita_disponibile);
    setCart(prev => [newItem, ...prev]);
    setShowSfogliaModal(false);
    setSfogliaFilter('');
  }, [cart]);

  // ── Lookup item ────────────────────────────────────────────────────────────

  const lookupItem = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    console.log('[Cassa] lookupItem called for code:', trimmed, 'storeId:', storeId);
    setSearching(true);
    setSearchError(null);
    try {
      // Primary query: item_code, LPN, ASIN, PkgID, top-level extra_data.SKU
      const { data: primaryData, error: primaryError } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data, lotto_id, status, quantita_disponibile')
        .or(`item_code.eq.${trimmed},original_data->>LPN.eq.${trimmed},original_data->>ASIN.eq.${trimmed},original_data->>PkgID.eq.${trimmed},extra_data->>SKU.eq.${trimmed}`)
        .limit(5);

      let data: any = null;
      let matchedUnitIndex: number | null = null;

      if (!primaryError && primaryData && primaryData.length > 0) {
        data = primaryData[0];
        console.log('[Cassa] primary lookup found — id:', data.id);
      } else {
        // Fallback: search units[].SKU client-side within this store's lotti
        console.log('[Cassa] primary lookup empty, trying unit SKU fallback for:', trimmed);
        const { data: lottiData } = await db
          .from('lotti')
          .select('id')
          .eq('store_id', storeId)
          .eq('stato', 'caricato');
        const lottiIds = (lottiData ?? []).map((l: any) => l.id);
        if (lottiIds.length > 0) {
          const { data: allItems } = await db
            .from('supplier_items')
            .select('id, item_code, original_data, extra_data, lotto_id, status, quantita_disponibile')
            .in('lotto_id', lottiIds);
          const found = (allItems ?? []).find((item: any) => {
            const units: any[] = Array.isArray(item.extra_data?.units) ? item.extra_data.units : [];
            return units.some((u: any) => u?.SKU === trimmed);
          });
          if (found) {
            data = found;
            matchedUnitIndex = (found.extra_data?.units ?? []).findIndex((u: any) => u?.SKU === trimmed);
            console.log('[Cassa] unit SKU fallback found — id:', data.id, 'unitIndex:', matchedUnitIndex);
          }
        }
      }

      // Also check primary results for unit SKU match (in case primary found the item but via another field)
      if (data && matchedUnitIndex === null) {
        const units: any[] = Array.isArray(data.extra_data?.units) ? data.extra_data.units : [];
        if (units.length > 0) {
          const unitIdx = units.findIndex((u: any) => u?.SKU === trimmed);
          if (unitIdx !== -1) {
            matchedUnitIndex = unitIdx;
            console.log('[Cassa] matched unit SKU in primary result — unitIndex:', matchedUnitIndex);
          }
        }
      }

      if (!data) {
        console.log('[Cassa] item not found for code:', trimmed);
        setSearchError(`Articolo non trovato: ${trimmed}`);
        return;
      }

      const qtaDisp = (data as any).quantita_disponibile ?? 1;
      console.log('[Cassa] item found — id:', data.id, 'quantita_disponibile:', qtaDisp, 'matchedUnitIndex:', matchedUnitIndex);

      // Verifica disponibilità tramite quantita_disponibile
      if (qtaDisp <= 0) {
        console.log('[Cassa] item not available (quantita_disponibile <= 0):', data.id);
        setSearchError(`Articolo non disponibile (esaurito)`);
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

        const directlyInStore = lottoData && lottoData.store_id === storeId && lottoData.stato === 'caricato';

        if (!directlyInStore) {
          // Check if any unit belongs to this store (multi-unit cross-store article)
          const units: any[] = Array.isArray(data.extra_data?.units) ? data.extra_data.units : [];
          if (units.length > 0) {
            const { data: storeLotti } = await db
              .from('lotti')
              .select('id')
              .eq('store_id', storeId)
              .eq('stato', 'caricato');
            const storeLottiIds = new Set((storeLotti ?? []).map((l: any) => l.id));
            const hasUnitInStore = units.some((u: any) => u?.LottoId && storeLottiIds.has(u.LottoId));
            console.log('[Cassa] cross-store unit check — hasUnitInStore:', hasUnitInStore, 'units:', units.length);
            if (!hasUnitInStore) {
              console.log('[Cassa] item not available in this store — lotto store_id:', lottoData?.store_id, 'expected:', storeId, 'stato:', lottoData?.stato);
              setSearchError(`Articolo non disponibile in questo store`);
              return;
            }
          } else {
            console.log('[Cassa] item not available in this store — lotto store_id:', lottoData?.store_id, 'expected:', storeId, 'stato:', lottoData?.stato);
            setSearchError(`Articolo non disponibile in questo store`);
            return;
          }
        }
      }

      // Compute per-store available quantity for multi-unit articles
      const unitsForQta: any[] = Array.isArray(data.extra_data?.units) ? data.extra_data.units : [];
      let effectiveQtaDisp = qtaDisp;
      if (unitsForQta.length > 0 && storeId) {
        const { data: storeLottiForQta } = await db
          .from('lotti')
          .select('id')
          .eq('store_id', storeId)
          .eq('stato', 'caricato');
        const storeLottiIdsForQta = new Set((storeLottiForQta ?? []).map((l: any) => l.id));
        const unitsInStore = unitsForQta.filter((u: any) => u?.LottoId && storeLottiIdsForQta.has(u.LottoId)).length;
        console.log('[Cassa] per-store unit count:', unitsInStore, 'of', unitsForQta.length, 'total units');
        if (unitsInStore > 0) effectiveQtaDisp = unitsInStore;
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

      const identifier = data.original_data?.['LPN'] ?? data.original_data?.['PkgID'] ?? data.item_code;
      const origData = data.original_data ?? {};
      const legacyDescKey = Object.keys(origData).find((k: string) => k.toLowerCase() === 'itemdesc');
      const desc = origData['Title'] ?? origData['title'] ?? origData['descrizione'] ?? origData['Descrizione'] ?? (legacyDescKey ? (origData[legacyDescKey] || '—') : '—');

      // Use unit-specific price if matched by unit SKU
      const units: any[] = Array.isArray(data.extra_data?.units) ? data.extra_data.units : [];
      const prezzo = matchedUnitIndex !== null && units[matchedUnitIndex]?.PrezzoVendita
        ? Number(String(units[matchedUnitIndex].PrezzoVendita).replace(',', '.')) || 0
        : extractPrezzo(data.extra_data ?? {});

      if (cart.some(i => i.id === data.id)) {
        console.log('[Cassa] item already in cart:', identifier);
        setSearchError(`Articolo già nel carrello: ${identifier}`);
        return;
      }

      const newItem: CartItem = {
        id: data.id,
        item_code: data.item_code,
        identifier,
        desc,
        prezzo,
        lotto_id: data.lotto_id ?? null,
        quantita: 1,
        quantita_disponibile: effectiveQtaDisp,
        status: (data as any).status ?? 'processing',
        unitIndex: matchedUnitIndex,
      };
      console.log('[Cassa] item added to cart:', identifier, 'prezzo:', prezzo, 'qtaDisp:', qtaDisp, 'effectiveQtaDisp:', effectiveQtaDisp, 'unitIndex:', matchedUnitIndex);
      setCart(prev => [newItem, ...prev]);
      setSearchQuery('');
    } catch (err) {
      console.error('[Cassa] lookupItem exception:', err);
      setSearchError('Errore durante la ricerca');
    } finally {
      setSearching(false);
    }
  }, [cart, storeId]);

  // ── Change quantity in cart ────────────────────────────────────────────────

  const handleChangeQty = useCallback((id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = Math.max(1, Math.min(item.quantita + delta, item.quantita_disponibile));
      console.log('[Cassa] handleChangeQty — id:', id, 'delta:', delta, 'newQty:', newQty, 'qtaDisp:', item.quantita_disponibile);
      return { ...item, quantita: newQty };
    }));
  }, []);

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

      // Insert movimenti with quantita
      const movimenti = cart.map(item => ({
        articolo_id: item.id,
        store_id: storeId,
        lotto_id: item.lotto_id ?? null,
        tipo: 'vendita',
        prezzo: item.prezzo * prezzoUnitarioMoltiplicatore,
        quantita: item.quantita,
      }));
      console.log('[Cassa] inserting movimenti:', movimenti.length, 'total units:', cart.reduce((s, i) => s + i.quantita, 0));
      const { error: movErr } = await db.from('movimenti').insert(movimenti);
      if (movErr) throw movErr;

      // Update quantita_disponibile for each item and set status if exhausted
      for (const item of cart) {
        const newQtaDisp = item.quantita_disponibile - item.quantita;
        const newStatus = newQtaDisp <= 0 ? 'completed' : item.status;
        console.log('[Cassa] updating supplier_item:', item.id, 'quantita_disponibile:', newQtaDisp, 'status:', newStatus);
        await db.from('supplier_items')
          .update({
            quantita_disponibile: newQtaDisp,
            status: newStatus,
          })
          .eq('id', item.id);
      }

      const totalUnits = cart.reduce((s, i) => s + i.quantita, 0);
      console.log('[Cassa] Vendita completata — items:', cart.length, 'unità:', totalUnits, 'totale scontato:', totaleCarrello);
      setCart([]);
      setSearchQuery('');
      Alert.alert('Vendita completata', `${totalUnits} unità vendute per ${formatCurrency(totaleCarrello)}`);
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

    // Totale operatore = POS + Contanti + Spese + Sconti + Buoni + Restituiti
    const totaleOperatore = pos + contanti + speseVal + scontiVal + buoniVal + restituitiVal;
    const diff = totaleGiornaliero - totaleOperatore;

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
      const diffLabel = diff > 0 ? `-${formatCurrency(diff)}` : `+${formatCurrency(Math.abs(diff))}`;
      Alert.alert(
        diff === 0 || Math.abs(diff) < 0.01 ? 'Chiusura OK ✓' : diff > 0 ? 'Chiusura con ammanco' : 'Chiusura con eccedenza',
        `Venduto calcolato: ${formatCurrency(totaleGiornaliero)}\nTotale operatore: ${formatCurrency(totaleOperatore)}\nDifferenza: ${Math.abs(diff) < 0.01 ? '✓ Quadra' : diffLabel}`
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
    const itemTotale = item.prezzo * item.quantita;
    const itemTotaleScontato = hasSconto ? itemTotale * (1 - scontoPercentuale / 100) : null;
    const prezzoLabel = formatCurrency(item.prezzo);
    const totaleLabel = formatCurrency(hasSconto ? (itemTotaleScontato ?? itemTotale) : itemTotale);
    const canDecrement = item.quantita > 1;
    const canIncrement = item.quantita < item.quantita_disponibile;

    return (
      <View style={{
        backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
        borderWidth: 1, borderColor: COLORS.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={16} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>{item.identifier}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>{item.desc}</Text>
            {item.unitIndex != null && (
              <View style={{ alignSelf: 'flex-start', backgroundColor: '#DBEAFE', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#1E40AF' }}>
                  {'Unità '}
                  {item.unitIndex + 1}
                </Text>
              </View>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
            {hasSconto ? (
              <>
                <Text style={{ fontSize: 10, color: COLORS.textTertiary, textDecorationLine: 'line-through' }}>{prezzoLabel}</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#22c55e' }}>{totaleLabel}</Text>
              </>
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.primary }}>{totaleLabel}</Text>
            )}
          </View>
          <AnimatedPressable onPress={() => handleRemove(item.id)}>
            <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={15} color={COLORS.danger} />
            </View>
          </AnimatedPressable>
        </View>

        {/* Quantity controls */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
            Disp: {item.quantita_disponibile}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
            <TouchableOpacity
              onPress={() => {
                console.log('[Cassa] qty decrement pressed — id:', item.id, 'current:', item.quantita);
                handleChangeQty(item.id, -1);
              }}
              disabled={!canDecrement}
              activeOpacity={0.7}
              style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: canDecrement ? COLORS.surfaceSecondary : COLORS.background,
                borderWidth: 1, borderColor: COLORS.border,
                alignItems: 'center', justifyContent: 'center',
                opacity: canDecrement ? 1 : 0.4,
              }}
            >
              <Minus size={14} color={COLORS.text} />
            </TouchableOpacity>
            <View style={{ minWidth: 36, alignItems: 'center', paddingHorizontal: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, fontVariant: ['tabular-nums'] }}>
                {item.quantita}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                console.log('[Cassa] qty increment pressed — id:', item.id, 'current:', item.quantita, 'max:', item.quantita_disponibile);
                handleChangeQty(item.id, 1);
              }}
              disabled={!canIncrement}
              activeOpacity={0.7}
              style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: canIncrement ? COLORS.primaryMuted : COLORS.background,
                borderWidth: 1, borderColor: canIncrement ? COLORS.primary : COLORS.border,
                alignItems: 'center', justifyContent: 'center',
                opacity: canIncrement ? 1 : 0.4,
              }}
            >
              <Plus size={14} color={canIncrement ? COLORS.primary : COLORS.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
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
              <AnimatedPressable onPress={() => {
                console.log('[Cassa] sfoglia button pressed');
                setSfogliaFilter('');
                loadSfogliaItems();
                setShowSfogliaModal(true);
              }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 12,
                  backgroundColor: COLORS.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: COLORS.border,
                }}>
                  <List size={22} color={COLORS.textSecondary} />
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
                    <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>SKU</Text>
                    <Text style={{ fontSize: 14, color: COLORS.textTertiary }}>·</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                      {cart.reduce((s, i) => s + i.quantita, 0)}
                    </Text>
                    <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>unità</Text>
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

      {/* Sfoglia Articoli Modal */}
      <Modal visible={showSfogliaModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Sfoglia Articoli</Text>
            <AnimatedPressable onPress={() => { console.log('[Cassa] sfoglia modal dismissed'); setShowSfogliaModal(false); setSfogliaFilter(''); }}>
              <View style={{ padding: 4 }}>
                <X size={22} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>

          {/* Search bar */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <TextInput
              value={sfogliaFilter}
              onChangeText={setSfogliaFilter}
              placeholder="Cerca per descrizione o codice..."
              placeholderTextColor={COLORS.textTertiary}
              style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border }}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {sfogliaLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <FlatList
              data={sfogliaItems.filter(item => {
                if (!sfogliaFilter.trim()) return true;
                const q = sfogliaFilter.toLowerCase();
                return item.desc.toLowerCase().includes(q) || item.identifier.toLowerCase().includes(q) || item.item_code.toLowerCase().includes(q) || item.lotto_codice.toLowerCase().includes(q) || (item.sku && item.sku.toLowerCase().includes(q));
              })}
              keyExtractor={item => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Package size={32} color={COLORS.textTertiary} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.textSecondary, marginTop: 12 }}>Nessun articolo disponibile</Text>
                </View>
              }
              renderItem={({ item }) => {
                const prezzoLabel = formatCurrency(item.prezzo);
                const alreadyInCart = cart.some(c => c.id === item.id);
                const descLabel = item.desc !== '—' ? item.desc : item.identifier;
                const subLabel = `${item.identifier} · ${item.lotto_codice}`;
                const qtaDisp = item.quantita_disponibile;
                return (
                  <AnimatedPressable onPress={() => {
                    console.log('[Cassa] sfoglia item tapped:', item.identifier, 'alreadyInCart:', alreadyInCart);
                    if (!alreadyInCart) handleSfogliaSelect(item);
                  }} style={{ opacity: alreadyInCart ? 0.4 : 1 }}>
                    <View style={{
                      backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                      borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10,
                    }}>
                      <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={16} color={COLORS.primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>{descLabel}</Text>
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>{subLabel}</Text>
                        {qtaDisp > 1 && (
                          <View style={{
                            backgroundColor: COLORS.primaryMuted, borderRadius: 5,
                            paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4,
                          }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.primary }}>
                              Qtà disp: {qtaDisp}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.primary }}>{prezzoLabel}</Text>
                    </View>
                  </AnimatedPressable>
                );
              }}
            />
          )}
        </View>
      </Modal>

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
              const totOp = toNum(incassatoPos) + toNum(incassatoContanti) + toNum(spese) + toNum(scontiCassa) + toNum(buoni) + toNum(restituiti);
              const diff = totaleGiornaliero - totOp;
              const isOk = Math.abs(diff) < 0.01;
              const isAmmanco = diff > 0.01;   // venduto > operatore = ammanco
              const isEccedenza = diff < -0.01; // venduto < operatore = eccedenza
              const bgColor = isOk ? COLORS.statusCompletedBg : isAmmanco ? COLORS.dangerMuted : COLORS.statusImportedBg;
              const borderColor = isOk ? COLORS.statusCompleted : isAmmanco ? COLORS.danger : COLORS.statusImported;
              const diffColor = isOk ? COLORS.statusCompleted : isAmmanco ? COLORS.danger : COLORS.statusImported;
              const diffLabel = isOk ? '✓ Quadra' : isAmmanco ? `-${formatCurrency(diff)}` : `+${formatCurrency(Math.abs(diff))}`;
              return (
                <View style={{ backgroundColor: bgColor, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: borderColor }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Totale operatore</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>{formatCurrency(totOp)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Differenza</Text>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: diffColor }}>
                      {diffLabel}
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
