import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle, Clock, Camera, ChevronDown, ChevronUp, Search, X } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import { ScannerModal } from '@/components/ScannerModal';
import { COLORS } from '@/constants/AppColors';
import { ItemStatusBadge } from '@/components/StatusBadge';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ToastMessage, useToast } from '@/components/ToastMessage';
import { db } from '@/utils/db';
import { useAuth } from '@/contexts/AuthContext';
import type { SupplierItem, SupplierFile } from '@/types';

const CONDITIONS = [
  { label: 'NESSUNA SEGNALAZIONE',  value: 'no issue' },
  { label: 'PRODOTTO NON RICEVUTO', value: 'shortage' },
  { label: 'SCATOLA VUOTA',         value: 'empty box' },
  { label: 'PRODOTTO SBAGLIATO',    value: 'wrong device' },
  { label: 'DISPOSITIVO BLOCCATO',  value: 'cloud locked' },
  { label: 'SCADUTO',               value: 'expired' },
  { label: 'ALTRO',                 value: 'other' },
] as const;

const FIXED_VALUES = CONDITIONS.slice(0, 6).map(c => c.value);

const SELEZIONE_OPTIONS = [
  { value: 'A' as const, label: 'A', description: 'AMAZONPRICE −35%' },
  { value: 'B' as const, label: 'B', description: 'AMAZONPRICE −50%' },
  { value: 'C' as const, label: 'C', description: 'AMAZONPRICE −70%' },
];

type Lotto = {
  id: string;
  codice_lotto: string;
  note: string | null;
  stato: string;
};

type UnitData = {
  unitIndex: number;
  Selezione: 'A' | 'B' | 'C' | '';
  PrezzoVendita: string;
  AdjReason: string;
  SKU: string;
  Lotto: string;
  LottoId: string;
  EANCorretto: string;
  ASINCorretto: string;
  processed_at: string;
  processed_by: string;
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getOriginalField(data: Record<string, any>, fieldName: string): string {
  const key = Object.keys(data).find(k => k.toLowerCase() === fieldName.toLowerCase());
  return key ? String(data[key] ?? '') : '';
}

function normalizeEAN(raw: string): string {
  if (!raw || raw.trim() === '') return '';
  const trimmed = raw.trim();
  // Detect scientific notation: contains E+ or E- (case insensitive), optionally with comma as decimal
  if (/[eE][+\-]/.test(trimmed)) {
    // Replace comma decimal separator with dot before parsing
    const normalized = trimmed.replace(',', '.');
    const num = parseFloat(normalized);
    if (!isNaN(num)) {
      // Convert to integer string (EANs are always integers)
      return Math.round(num).toString();
    }
  }
  return trimmed;
}

function parseUnitCost(data: Record<string, any>): number | null {
  const key = Object.keys(data).find(k => k.toLowerCase() === 'unitcost');
  if (!key) return null;
  const raw = String(data[key] ?? '').replace(',', '.');
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

function parseAmazonPrice(data: Record<string, any>): number | null {
  // Priority 1: exact normalized key 'AmazonPrice' (set by new import mapping)
  // Priority 2: any key that normalizes to 'amazonprice' (handles spaces/underscores)
  // Priority 3: any key containing 'amazon' (case-insensitive)
  // Priority 4: any key containing 'price' or 'prezzo' (case-insensitive fallback)
  const keys = Object.keys(data);
  const key =
    keys.find(k => k === 'AmazonPrice') ??
    keys.find(k => k.toLowerCase().replace(/[\s_]/g, '') === 'amazonprice') ??
    keys.find(k => k.toLowerCase().includes('amazon')) ??
    keys.find(k => k.toLowerCase().includes('price') || k.toLowerCase().includes('prezzo'));
  if (!key) return null;
  const raw = String(data[key] ?? '').replace(',', '.').trim();
  const n = parseFloat(raw);
  console.log('[parseAmazonPrice] key:', key, 'raw:', raw, 'parsed:', n);
  return isNaN(n) || n <= 0 ? null : n;
}

function formatPrice(n: number): string {
  return n.toFixed(2); // punto, non virgola
}

function LottoStatoBadge({ stato }: { stato: string }) {
  const isCaricato = stato === 'caricato';
  const bgColor = isCaricato ? '#D1FAE5' : '#DBEAFE';
  const textColor = isCaricato ? '#065F46' : '#1E40AF';
  const label = isCaricato ? 'Caricato' : 'Magazzino';
  return (
    <View style={{ backgroundColor: bgColor, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: textColor }}>{label}</Text>
    </View>
  );
}

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const { user } = useAuth();

  const [item, setItem] = useState<SupplierItem | null>(null);
  const [file, setFile] = useState<SupplierFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [originalData, setOriginalData] = useState<Record<string, any>>({});
  const [extraData, setExtraData] = useState<Record<string, any>>({});

  // AdjReason condition picker state
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [altroText, setAltroText] = useState('');

  // Selezione state
  const [selezione, setSelezione] = useState<'A' | 'B' | 'C' | null>(null);

  // Prezzo di Vendita state
  const [prezzoVendita, setPrezzoVendita] = useState('');

  // SKU state
  const [skuVendita, setSkuVendita] = useState('');

  // Lotto selector state
  const [lotti, setLotti] = useState<Lotto[]>([]);
  const [selectedLotto, setSelectedLotto] = useState<Lotto | null>(null);
  const [selectedLottoId, setSelectedLottoId] = useState<string | null>(null);
  const [lottoModalVisible, setLottoModalVisible] = useState(false);
  const [lottoSearch, setLottoSearch] = useState('');

  // EAN Corretto and ASIN Corretto state
  const [eanCorretto, setEanCorretto] = useState('');
  const [asinCorretto, setAsinCorretto] = useState('');

  // Scanner state
  const [scanTarget, setScanTarget] = useState<'sku' | 'lotto' | null>(null);

  // Dati Fornitore collapsible state
  const [datiFornitoreOpen, setDatiFornitoreOpen] = useState(false);

  // Multi-unit workflow state
  const [totalUnits, setTotalUnits] = useState(1);
  const [currentUnitIndex, setCurrentUnitIndex] = useState(1);
  const [processedUnits, setProcessedUnits] = useState<UnitData[]>([]);

  // Track whether we've mounted so the selezione effect doesn't overwrite a restored price
  const isMounted = useRef(false);

  const fetchLotti = useCallback(async () => {
    console.log('[ItemDetail] fetchLotti called');
    const { data, error } = await db
      .from('lotti')
      .select('id, codice_lotto, note, stato')
      .in('stato', ['magazzino', 'caricato'])
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[ItemDetail] fetchLotti error:', error);
      return [];
    }
    console.log('[ItemDetail] lotti fetched:', data?.length ?? 0);
    return (data ?? []) as Lotto[];
  }, []);

  const fetchData = useCallback(async () => {
    console.log('[ItemDetail] fetchData called', { id });
    try {
      const [{ data: itemData, error: itemError }, lottiList] = await Promise.all([
        db.from('supplier_items').select('*').eq('id', id).single(),
        fetchLotti(),
      ]);

      setLotti(lottiList);

      if (itemError) {
        console.error('[ItemDetail] item fetch error:', itemError);
        throw itemError;
      }

      const fetchedItem = itemData as SupplierItem;
      console.log('[ItemDetail] item fetched:', fetchedItem.item_code);
      setItem(fetchedItem);
      setOriginalData({ ...(fetchedItem.original_data ?? {}) });
      setExtraData({ ...(fetchedItem.extra_data ?? {}) });

      // Pre-select AdjReason condition from loaded data
      const adjValue: string = fetchedItem.original_data?.['AdjReason'] ?? '';
      if (adjValue === '') {
        setSelectedCondition(null);
        setAltroText('');
      } else if ((FIXED_VALUES as readonly string[]).includes(adjValue)) {
        setSelectedCondition(adjValue);
        setAltroText('');
      } else {
        // Non-empty value that doesn't match a fixed condition → ALTRO with free text
        setSelectedCondition('other');
        setAltroText(adjValue);
      }

      // Restore Selezione from extraData
      const savedSelezione = fetchedItem.extra_data?.['Selezione'];
      if (savedSelezione === 'A' || savedSelezione === 'B' || savedSelezione === 'C') {
        console.log('[ItemDetail] restoring selezione from extraData:', savedSelezione);
        setSelezione(savedSelezione);
      }

      // Restore PrezzoVendita from extraData (takes priority over computed value)
      const savedPrezzo = fetchedItem.extra_data?.['PrezzoVendita'];
      if (savedPrezzo !== undefined && savedPrezzo !== '') {
        console.log('[ItemDetail] restoring prezzoVendita from extraData:', savedPrezzo);
        setPrezzoVendita(savedPrezzo);
      }

      // Restore SKU from extraData
      setSkuVendita(fetchedItem.extra_data?.['SKU'] ?? '');

      // Restore Lotto selector from extraData
      const savedLottoCodice = fetchedItem.extra_data?.['Lotto'] ?? '';
      const savedLottoId = fetchedItem.extra_data?.['LottoId'] ?? '';
      console.log('[ItemDetail] restoring SKU:', fetchedItem.extra_data?.['SKU'], 'Lotto:', savedLottoCodice, 'LottoId:', savedLottoId);
      if (savedLottoCodice && lottiList.length > 0) {
        const found = lottiList.find(l => l.codice_lotto === savedLottoCodice) ?? null;
        setSelectedLotto(found);
        setSelectedLottoId((found?.id ?? savedLottoId) || null);
        console.log('[ItemDetail] restored lotto:', found?.codice_lotto ?? 'not found in active lotti');
      } else if (savedLottoId) {
        setSelectedLottoId(savedLottoId);
      }

      // EAN Corretto: restore from extraData if saved, otherwise pull from originalData
      const savedEan = (fetchedItem.extra_data?.['EANCorretto'] ?? '');
      setEanCorretto(savedEan !== '' ? savedEan : normalizeEAN(getOriginalField(fetchedItem.original_data ?? {}, 'EAN')));

      const savedAsin = (fetchedItem.extra_data?.['ASINCorretto'] ?? '');
      setAsinCorretto(savedAsin !== '' ? savedAsin : getOriginalField(fetchedItem.original_data ?? {}, 'ASIN'));

      // Fetch file for extra_columns
      const { data: fileData, error: fileError } = await db
        .from('supplier_files')
        .select('*')
        .eq('id', fetchedItem.file_id)
        .single();

      if (!fileError && fileData) {
        console.log('[ItemDetail] file fetched:', fileData.file_name);
        setFile(fileData as SupplierFile);
        // Initialize extra_data with empty strings for any missing extra columns
        const extraCols: string[] = fileData.extra_columns ?? [];
        const currentExtra = { ...(fetchedItem.extra_data ?? {}) };
        extraCols.forEach(col => {
          if (!(col in currentExtra)) currentExtra[col] = '';
        });
        setExtraData(currentExtra);
        setSkuVendita(currentExtra['SKU'] ?? '');
        setPrezzoVendita(currentExtra['PrezzoVendita'] ?? '');

        // Re-restore lotto from merged extra
        const mergedLottoCodice = currentExtra['Lotto'] ?? '';
        const mergedLottoId = currentExtra['LottoId'] ?? '';
        if (mergedLottoCodice && lottiList.length > 0) {
          const found = lottiList.find(l => l.codice_lotto === mergedLottoCodice) ?? null;
          setSelectedLotto(found);
          setSelectedLottoId((found?.id ?? mergedLottoId) || null);
        } else if (mergedLottoId) {
          setSelectedLottoId(mergedLottoId);
        }

        const savedEan2 = currentExtra['EANCorretto'] ?? '';
        setEanCorretto(savedEan2 !== '' ? savedEan2 : normalizeEAN(getOriginalField(fetchedItem.original_data ?? {}, 'EAN')));

        const savedAsin2 = currentExtra['ASINCorretto'] ?? '';
        setAsinCorretto(savedAsin2 !== '' ? savedAsin2 : getOriginalField(fetchedItem.original_data ?? {}, 'ASIN'));
      }

      // Multi-unit workflow initialization
      const qty = fetchedItem.quantita ?? 1;
      setTotalUnits(qty);
      console.log('[ItemDetail] totalUnits:', qty);

      if (qty > 1) {
        const units: UnitData[] = (fetchedItem.extra_data as any)?.units ?? [];
        setProcessedUnits(units);
        const nextUnit = units.length + 1;
        const resumeIndex = Math.min(nextUnit, qty);
        setCurrentUnitIndex(resumeIndex);
        console.log('[ItemDetail] multi-unit: processedUnits:', units.length, 'resuming at unit:', resumeIndex);

        // If resuming mid-way, clear form fields for the new unit
        if (units.length > 0 && units.length < qty) {
          setSelezione(null);
          setPrezzoVendita('');
          setSelectedCondition(null);
          setAltroText('');
          setSkuVendita('');
          setSelectedLotto(null);
          setSelectedLottoId('');
          setEanCorretto(normalizeEAN(getOriginalField(fetchedItem.original_data ?? {}, 'EAN')));
          setAsinCorretto(getOriginalField(fetchedItem.original_data ?? {}, 'ASIN'));
        }
      }
    } catch (err) {
      console.error('[ItemDetail] fetchData exception:', err);
    } finally {
      setLoading(false);
      // Mark as mounted after data is loaded so the selezione effect can run
      isMounted.current = true;
    }
  }, [id, fetchLotti]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Recompute prezzoVendita when selezione changes, but only after mount
  useEffect(() => {
    if (!isMounted.current) return;

    console.log('[ItemDetail] selezione changed, recomputing prezzoVendita:', selezione);
    const amazonPrice = parseAmazonPrice(originalData);

    if (selezione === null) {
      setPrezzoVendita('');
    } else if (amazonPrice === null) {
      setPrezzoVendita('');
    } else if (selezione === 'A') {
      setPrezzoVendita(formatPrice(amazonPrice * 0.65));
    } else if (selezione === 'B') {
      setPrezzoVendita(formatPrice(amazonPrice * 0.50));
    } else if (selezione === 'C') {
      setPrezzoVendita(formatPrice(amazonPrice * 0.30));
    }
  }, [selezione]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConditionPress = useCallback((value: string) => {
    if (selectedCondition === value) {
      console.log('[ItemDetail] condition deselected:', value);
      setSelectedCondition(null);
      setAltroText('');
    } else {
      console.log('[ItemDetail] condition selected:', value);
      setSelectedCondition(value);
      if (value !== 'other') setAltroText('');
    }
  }, [selectedCondition]);

  const handleSelezionePress = useCallback((value: 'A' | 'B' | 'C') => {
    if (selezione === value) {
      console.log('[ItemDetail] selezione deselected:', value);
      setSelezione(null);
    } else {
      console.log('[ItemDetail] selezione selected:', value);
      setSelezione(value);
    }
  }, [selezione]);

  const handleLottoSelect = useCallback((lotto: Lotto | null) => {
    console.log('[ItemDetail] lotto selected:', lotto?.codice_lotto ?? 'none');
    setSelectedLotto(lotto);
    setSelectedLottoId(lotto?.id ?? null);
    setLottoModalVisible(false);
    setLottoSearch('');
  }, []);

  const handleSave = useCallback(async () => {
    console.log('[ItemDetail] handleSave called', { id, processedBy: user?.username ?? '', selectedCondition, altroText, selezione, prezzoVendita, selectedLottoId, selectedLottoCodice: selectedLotto?.codice_lotto, totalUnits, currentUnitIndex });
    setSaving(true);
    try {
      // Compute final AdjReason value
      let adjReason = '';
      if (selectedCondition === null || selectedCondition === 'no issue') {
        adjReason = '';
      } else if (selectedCondition === 'other') {
        adjReason = altroText.trim();
      } else {
        adjReason = selectedCondition;
      }

      const updatedOriginalData = { ...originalData, AdjReason: adjReason };
      console.log('[ItemDetail] saving AdjReason:', adjReason);

      const updatedExtraData = {
        ...extraData,
        Selezione: selezione ?? '',
        PrezzoVendita: prezzoVendita,
        SKU: skuVendita,
        Lotto: selectedLotto?.codice_lotto ?? '',
        LottoId: selectedLottoId ?? '',
        EANCorretto: eanCorretto,
        ASINCorretto: asinCorretto,
      };

      if (totalUnits > 1) {
        // Multi-unit flow
        const unitData: UnitData = {
          unitIndex: currentUnitIndex,
          Selezione: selezione ?? '',
          PrezzoVendita: prezzoVendita,
          AdjReason: adjReason,
          SKU: skuVendita,
          Lotto: selectedLotto?.codice_lotto ?? '',
          LottoId: selectedLottoId ?? '',
          EANCorretto: eanCorretto,
          ASINCorretto: asinCorretto,
          processed_at: new Date().toISOString(),
          processed_by: user?.username ?? '',
        };

        const newUnits = [...processedUnits, unitData];
        const isLastUnit = currentUnitIndex >= totalUnits;

        console.log('[ItemDetail] multi-unit save: unit', currentUnitIndex, 'of', totalUnits, '| isLastUnit:', isLastUnit);

        const updatePayload: Record<string, unknown> = {
          extra_data: {
            ...updatedExtraData,
            units: newUnits,
            ...(isLastUnit ? {
              Selezione: selezione ?? '',
              PrezzoVendita: prezzoVendita,
              AdjReason: adjReason,
              SKU: skuVendita,
              Lotto: selectedLotto?.codice_lotto ?? '',
              LottoId: selectedLottoId ?? '',
              EANCorretto: eanCorretto,
              ASINCorretto: asinCorretto,
            } : {}),
          },
          original_data: updatedOriginalData,
          status: isLastUnit ? 'completed' : 'processing',
          processed_at: isLastUnit ? new Date().toISOString() : (item?.processed_at ?? null),
          processed_by: isLastUnit ? (user?.username || null) : (item?.processed_by ?? null),
        };

        const { error } = await db.from('supplier_items').update(updatePayload).eq('id', id);
        if (error) {
          console.error('[ItemDetail] multi-unit save error:', error);
          throw error;
        }

        if (isLastUnit) {
          console.log('[ItemDetail] all units processed, lavorazione completata');
          showToast('Lavorazione completata!', 'success');
          router.back();
        } else {
          // Advance to next unit — reset form fields
          setProcessedUnits(newUnits);
          setCurrentUnitIndex(currentUnitIndex + 1);
          setSelezione(null);
          setPrezzoVendita('');
          setSelectedCondition(null);
          setAltroText('');
          setSkuVendita('');
          setSelectedLotto(null);
          setSelectedLottoId('');
          setEanCorretto(normalizeEAN(getOriginalField(originalData, 'EAN')));
          setAsinCorretto(getOriginalField(originalData, 'ASIN'));
          console.log('[ItemDetail] advanced to unit', currentUnitIndex + 1);
          showToast(`Unità ${currentUnitIndex} salvata`, 'success');
        }
        return;
      }

      // Single-unit flow (unchanged)
      console.log('[ItemDetail] saving extraData:', { Selezione: updatedExtraData.Selezione, PrezzoVendita: updatedExtraData.PrezzoVendita, SKU: updatedExtraData.SKU, Lotto: updatedExtraData.Lotto, LottoId: updatedExtraData.LottoId, EANCorretto: updatedExtraData.EANCorretto, ASINCorretto: updatedExtraData.ASINCorretto });

      const { error } = await db
        .from('supplier_items')
        .update({
          original_data: updatedOriginalData,
          extra_data: updatedExtraData,
          lotto_id: selectedLottoId ?? null,
          status: 'completed',
          processed_at: new Date().toISOString(),
          processed_by: user?.username || null,
        })
        .eq('id', id);

      if (error) {
        console.error('[ItemDetail] save error:', error);
        throw error;
      }

      setOriginalData(updatedOriginalData);
      setExtraData(updatedExtraData);
      console.log('[ItemDetail] item saved successfully');
      showToast('Articolo salvato con successo', 'success');
      setTimeout(() => router.back(), 1200);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('[ItemDetail] handleSave error:', err);
      showToast(e?.message ?? 'Errore durante il salvataggio', 'error');
    } finally {
      setSaving(false);
    }
  }, [id, originalData, extraData, user, selectedCondition, altroText, selezione, prezzoVendita, skuVendita, selectedLotto, selectedLottoId, eanCorretto, asinCorretto, totalUnits, currentUnitIndex, processedUnits, item, showToast, router]);

  const itemDesc =
    (originalData['Title'] as string | undefined) ??
    (originalData['title'] as string | undefined) ??
    getOriginalField(originalData, 'ITEMDESC') ??
    item?.item_code ??
    '';
  console.log('[ItemDetail] itemDesc resolved:', itemDesc);
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(itemDesc + ' prezzo')}`;

  // Filtered lotti for modal
  const lottoSearchLower = lottoSearch.toLowerCase();
  const filteredLotti = lottoSearch.trim() === ''
    ? lotti
    : lotti.filter(l =>
        l.codice_lotto.toLowerCase().includes(lottoSearchLower) ||
        (l.note ?? '').toLowerCase().includes(lottoSearchLower)
      );

  // Display values for lotto selector button
  const lottoButtonLabel = selectedLotto ? selectedLotto.codice_lotto : 'Seleziona lotto...';
  const lottoButtonDesc = selectedLotto?.note ?? null;
  const lottoButtonIsPlaceholder = !selectedLotto;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Articolo', headerLargeTitle: false }} />
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const extraColumns = file?.extra_columns ?? [];
  const processedAtDisplay = item?.processed_at ? formatDate(item.processed_at) : null;
  const saveButtonLabel = totalUnits > 1
    ? (currentUnitIndex >= totalUnits ? 'Completa lavorazione' : `Salva e prossima unità (${currentUnitIndex}/${totalUnits})`)
    : 'Salva';
  const progressPercent = totalUnits > 0 ? (processedUnits.length / totalUnits) * 100 : 0;
  const allUnitsProcessed = processedUnits.length === totalUnits;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: item?.item_code ?? 'Articolo',
          headerLargeTitle: false,
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}
      >
        {/* Multi-unit progress indicator */}
        {totalUnits > 1 && (
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 16,
            gap: 12,
          }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>
                Unità {Math.min(currentUnitIndex, totalUnits)} di {totalUnits}
              </Text>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                {processedUnits.length} lavorate
              </Text>
            </View>

            {/* Progress bar */}
            <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: allUnitsProcessed ? '#16A34A' : COLORS.primary,
                width: `${progressPercent}%`,
              }} />
            </View>

            {/* Already processed units summary */}
            {processedUnits.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>
                  Già lavorate:
                </Text>
                {processedUnits.map((u, i) => {
                  const unitBgColor = u.Selezione === 'A' ? '#D1FAE5' : u.Selezione === 'B' ? '#DBEAFE' : '#FEF3C7';
                  const unitTextColor = u.Selezione === 'A' ? '#065F46' : u.Selezione === 'B' ? '#1E40AF' : '#92400E';
                  const priceDisplay = u.PrezzoVendita ? `€${u.PrezzoVendita}` : '—';
                  return (
                    <View key={i} style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 4,
                      paddingHorizontal: 8,
                      backgroundColor: COLORS.background,
                      borderRadius: 8,
                    }}>
                      <Text style={{ fontSize: 12, color: COLORS.textTertiary, width: 24 }}>#{u.unitIndex}</Text>
                      {u.Selezione ? (
                        <View style={{
                          backgroundColor: unitBgColor,
                          borderRadius: 4,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}>
                          <Text style={{
                            fontSize: 11,
                            fontWeight: '700',
                            color: unitTextColor,
                          }}>
                            {u.Selezione}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={{ fontSize: 12, color: COLORS.text, flex: 1 }}>
                        {priceDisplay}
                      </Text>
                      <Text style={{ fontSize: 11, color: COLORS.textTertiary }}>
                        {u.processed_by}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Status + processed info */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            padding: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {item && <ItemStatusBadge status={item.status} />}
          {processedAtDisplay && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Clock size={13} color={COLORS.textSecondary} />
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                {processedAtDisplay}
              </Text>
            </View>
          )}
          {item?.processed_by && (
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              da {item.processed_by}
            </Text>
          )}
        </View>

        {/* Condizione Articolo (AdjReason picker) */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            overflow: 'hidden',
          }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>
              Condizione Articolo
            </Text>
          </View>

          {CONDITIONS.map((condition, index) => {
            const isSelected = selectedCondition === condition.value;
            const isLast = index === CONDITIONS.length - 1;
            const isAltro = condition.value === 'other';

            return (
              <View key={condition.value}>
                <AnimatedPressable
                  onPress={() => handleConditionPress(condition.value)}
                >
                  <View
                    style={{
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      borderBottomWidth: isLast && !(isAltro && isSelected) ? 0 : 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    {/* Radio circle */}
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 2,
                        backgroundColor: isSelected ? COLORS.primary : 'transparent',
                        borderColor: isSelected ? COLORS.primary : COLORS.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSelected && (
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: '#FFFFFF',
                          }}
                        />
                      )}
                    </View>

                    {/* Labels */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>
                        {condition.label}
                      </Text>
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 1 }}>
                        {condition.value}
                      </Text>
                    </View>
                  </View>
                </AnimatedPressable>

                {/* ALTRO free-text input */}
                {isAltro && isSelected && (
                  <View style={{ marginTop: 8, marginHorizontal: 16, marginBottom: 12 }}>
                    <TextInput
                      value={altroText}
                      onChangeText={(v) => {
                        console.log('[ItemDetail] altroText changed:', v);
                        setAltroText(v);
                      }}
                      placeholder="Descrivi il motivo..."
                      placeholderTextColor={COLORS.textTertiary}
                      autoFocus
                      style={{
                        backgroundColor: COLORS.surfaceSecondary,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        fontSize: 14,
                        color: COLORS.text,
                      }}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Selezione card */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            overflow: 'hidden',
          }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>
              Selezione
            </Text>
          </View>

          {SELEZIONE_OPTIONS.map((opt, index) => {
            const isSelected = selezione === opt.value;
            const isLast = index === SELEZIONE_OPTIONS.length - 1;

            return (
              <AnimatedPressable
                key={opt.value}
                onPress={() => handleSelezionePress(opt.value)}
              >
                <View
                  style={{
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: COLORS.border,
                  }}
                >
                  {/* Radio circle */}
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      backgroundColor: isSelected ? COLORS.primary : 'transparent',
                      borderColor: isSelected ? COLORS.primary : COLORS.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSelected && (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: '#FFFFFF',
                        }}
                      />
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.text }}>{opt.label}</Text>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{opt.description}</Text>
                  </View>
                </View>
              </AnimatedPressable>
            );
          })}
        </View>

        {/* Original data section — collapsible */}
        {(() => {
          const VISIBLE_COLUMNS = ['EAN', 'ASIN', 'LPN', 'PKGID', 'UNITS', 'GLDESC', 'ITEMDESC', 'UNITCOST', 'AMAZONPRICE', 'REMOVALREASON', 'CATEGORYDESC', 'RECOVERYRETE'];
          const visibleEntries = Object.entries(originalData).filter(
            ([key]) =>
              key !== 'AdjReason' &&
              VISIBLE_COLUMNS.some(v => v.toLowerCase() === key.toLowerCase())
          );
          if (visibleEntries.length === 0) return null;
          return (
            <View
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: COLORS.border,
                overflow: 'hidden',
              }}
            >
              {/* Header — tappable to toggle */}
              <AnimatedPressable onPress={() => {
                console.log('[DatiFornitore] toggle pressed, opening:', !datiFornitoreOpen);
                setDatiFornitoreOpen(prev => !prev);
              }}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>
                    Dati Fornitore
                  </Text>
                  {datiFornitoreOpen
                    ? <ChevronUp size={18} color={COLORS.textSecondary} />
                    : <ChevronDown size={18} color={COLORS.textSecondary} />}
                </View>
              </AnimatedPressable>

              {/* Collapsible content */}
              {datiFornitoreOpen && (
                <View style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                  gap: 14,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.border,
                }}>
                  {visibleEntries.map(([key, value]) => (
                    <View key={key} style={{ gap: 4, marginTop: 14 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {key}
                      </Text>
                      <View
                        style={{
                          backgroundColor: COLORS.surfaceSecondary,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          minHeight: 40,
                        }}
                      >
                        <Text style={{ fontSize: 14, color: value ? COLORS.text : COLORS.textTertiary }}>
                          {value || '—'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })()}

        {/* Dati di Vendita card */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            padding: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            gap: 14,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>
            Dati di Vendita
          </Text>

          <View style={{ gap: 5 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Prezzo di Vendita
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={prezzoVendita}
                onChangeText={(v) => {
                  console.log('[ItemDetail] prezzoVendita changed:', v);
                  setPrezzoVendita(v);
                }}
                placeholder="0.00"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
                style={{
                  flex: 1,
                  backgroundColor: COLORS.surfaceSecondary,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 15,
                  color: COLORS.text,
                }}
              />
              <AnimatedPressable
                onPress={() => {
                  console.log('[ItemDetail] web search pressed, url:', googleSearchUrl);
                  WebBrowser.openBrowserAsync(googleSearchUrl);
                }}
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 10,
                  padding: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Search size={18} color="#fff" />
              </AnimatedPressable>
            </View>
          </View>

          {/* EAN Corretto */}
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              EAN Corretto
            </Text>
            <TextInput
              value={eanCorretto}
              onChangeText={(v) => {
                console.log('[ItemDetail] eanCorretto changed:', v);
                setEanCorretto(v);
              }}
              placeholder="EAN corretto"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.border,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 15,
                color: COLORS.text,
              }}
            />
          </View>

          {/* ASIN Corretto */}
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              ASIN Corretto
            </Text>
            <TextInput
              value={asinCorretto}
              onChangeText={(v) => {
                console.log('[ItemDetail] asinCorretto changed:', v);
                setAsinCorretto(v);
              }}
              placeholder="ASIN corretto"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.border,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 15,
                color: COLORS.text,
              }}
            />
          </View>

          {/* SKU */}
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              SKU
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={skuVendita}
                onChangeText={(v) => {
                  console.log('[ItemDetail] skuVendita changed:', v);
                  setSkuVendita(v);
                }}
                placeholder="Inserisci SKU"
                placeholderTextColor={COLORS.textTertiary}
                style={{
                  flex: 1,
                  backgroundColor: COLORS.surfaceSecondary,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 15,
                  color: COLORS.text,
                }}
              />
              <AnimatedPressable onPress={() => {
                console.log('[ItemDetail] scan SKU button pressed');
                setScanTarget('sku');
              }}>
                <View style={{
                  width: 42, height: 42,
                  borderRadius: 10,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Camera size={20} color={COLORS.primary} />
                </View>
              </AnimatedPressable>
            </View>
          </View>

          {/* LOTTO — selector */}
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              LOTTO
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AnimatedPressable
                style={{ flex: 1 }}
                onPress={() => {
                  console.log('[ItemDetail] lotto selector pressed, opening modal');
                  setLottoModalVisible(true);
                }}
              >
                <View
                  style={{
                    flex: 1,
                    backgroundColor: COLORS.surfaceSecondary,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 42,
                  }}
                >
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        color: lottoButtonIsPlaceholder ? COLORS.textTertiary : COLORS.text,
                        fontWeight: lottoButtonIsPlaceholder ? '400' : '600',
                      }}
                      numberOfLines={1}
                    >
                      {lottoButtonLabel}
                    </Text>
                    {lottoButtonDesc ? (
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                        {lottoButtonDesc}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronDown size={16} color={COLORS.textSecondary} style={{ marginLeft: 6 }} />
                </View>
              </AnimatedPressable>

              {/* Camera button — scan lotto barcode */}
              <AnimatedPressable onPress={() => {
                console.log('[ItemDetail] scan LOTTO button pressed');
                setScanTarget('lotto');
              }}>
                <View style={{
                  width: 42, height: 42,
                  borderRadius: 10,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Camera size={20} color={COLORS.primary} />
                </View>
              </AnimatedPressable>
            </View>
          </View>
        </View>

        {/* Processed by + Save */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            padding: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            gap: 14,
          }}
        >
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text }}>
              Lavorato da
            </Text>
            <View
              style={{
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text style={{ fontSize: 15, color: COLORS.text, fontWeight: '600' }}>
                {user?.username ?? '—'}
              </Text>
            </View>
          </View>

          <AnimatedPressable onPress={handleSave} disabled={saving}>
            <View
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 12,
                paddingVertical: 15,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <CheckCircle size={18} color="#FFFFFF" />
              )}
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                {saving ? 'Salvataggio...' : saveButtonLabel}
              </Text>
            </View>
          </AnimatedPressable>
        </View>
      </ScrollView>

      <ToastMessage
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onHide={hideToast}
      />

      {/* SKU Scanner */}
      <ScannerModal
        visible={scanTarget === 'sku'}
        onClose={() => setScanTarget(null)}
        onScanned={(code) => {
          console.log('[ItemDetail] SKU barcode scanned:', code);
          setSkuVendita(code);
          setScanTarget(null);
        }}
        hint="Scansiona barcode SKU"
      />

      {/* Lotto Scanner — cerca nel DB e seleziona automaticamente */}
      <ScannerModal
        visible={scanTarget === 'lotto'}
        onClose={() => setScanTarget(null)}
        onScanned={async (code) => {
          console.log('[ItemDetail] LOTTO barcode scanned:', code);
          setScanTarget(null);
          const found = lotti.find(l => l.codice_lotto === code) ?? null;
          if (found) {
            console.log('[ItemDetail] lotto found by scan:', found.codice_lotto);
            setSelectedLotto(found);
            setSelectedLottoId(found.id);
          } else {
            console.warn('[ItemDetail] lotto not found for scanned code:', code);
            showToast(`Lotto "${code}" non trovato`, 'error');
          }
        }}
        hint="Scansiona barcode LOTTO"
      />

      {/* Lotto Selector Modal */}
      <Modal
        visible={lottoModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          console.log('[ItemDetail] lotto modal closed');
          setLottoModalVisible(false);
          setLottoSearch('');
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View
            style={{
              backgroundColor: COLORS.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '80%',
              paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            }}
          >
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
                Seleziona Lotto
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log('[ItemDetail] lotto modal close button pressed');
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
                    console.log('[ItemDetail] lotto search changed:', v);
                    setLottoSearch(v);
                  }}
                  placeholder="Cerca per codice o descrizione..."
                  placeholderTextColor={COLORS.textTertiary}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    fontSize: 14,
                    color: COLORS.text,
                  }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* List */}
            <FlatList
              data={filteredLotti}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <TouchableOpacity
                  onPress={() => {
                    console.log('[ItemDetail] lotto deselected (Nessun lotto)');
                    handleLottoSelect(null);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: COLORS.textSecondary, fontStyle: 'italic' }}>
                      Nessun lotto
                    </Text>
                  </View>
                  {selectedLotto === null && (
                    <View style={{
                      width: 18, height: 18, borderRadius: 9,
                      backgroundColor: COLORS.primary,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                    </View>
                  )}
                </TouchableOpacity>
              }
              renderItem={({ item: lotto }) => {
                const isSelected = selectedLotto?.id === lotto.id;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      console.log('[ItemDetail] lotto row pressed:', lotto.codice_lotto);
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
                    Nessun lotto trovato
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}
