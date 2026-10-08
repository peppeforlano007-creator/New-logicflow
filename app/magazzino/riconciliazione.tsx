import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { BarChart3, ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Package } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreOption {
  id: string;
  nome: string;
}

interface RiconciliazioneData {
  caricato_count: number;
  caricato_valore: number;
  scaricato_count: number;
  scaricato_valore: number;
  venduto_count: number;
  venduto_valore: number;
  incassato: number;
  ammanchi: AmmancoItem[];
}

interface AmmancoItem {
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

function formatDate(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  count: number;
  valore: number;
  color: string;
  bg: string;
  icon: React.ReactNode;
}

function StatCard({ label, count, valore, color, bg, icon }: StatCardProps) {
  const countLabel = `${count} art.`;
  const valoreLabel = formatCurrency(valore);
  return (
    <View style={{
      flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: COLORS.border,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    }}>
      <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        {icon}
      </View>
      <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color, letterSpacing: -0.3 }}>{countLabel}</Text>
      <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{valoreLabel}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RiconciliazioneScreen() {
  const router = useRouter();

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [selectedStore, setSelectedStore] = useState<StoreOption | null>(null);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dataInizio, setDataInizio] = useState<Date>(firstOfMonth);
  const [dataFine, setDataFine] = useState<Date>(today);
  const [showPickerInizio, setShowPickerInizio] = useState(false);
  const [showPickerFine, setShowPickerFine] = useState(false);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RiconciliazioneData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load stores on mount
  React.useEffect(() => {
    console.log('[Riconciliazione] loading stores');
    db.from('stores').select('id, nome').order('nome').then(({ data: d, error: e }: { data: StoreOption[] | null; error: unknown; }) => {
      if (!e && d) {
        setStores(d);
        if (d.length > 0) setSelectedStore(d[0]);
      }
      setStoresLoaded(true);
    });
  }, []);

  const handleCalcola = useCallback(async () => {
    if (!selectedStore) return;
    console.log('[Riconciliazione] Calcola pressed — store:', selectedStore.nome, 'dal:', formatDate(dataInizio), 'al:', formatDate(dataFine));
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const isoInizio = dataInizio.toISOString().split('T')[0];
      const isoFine = new Date(dataFine.getTime() + 86400000).toISOString().split('T')[0]; // +1 day inclusive

      // Fetch lotti for this store to scope movimenti
      const { data: lottiStore, error: lottiErr } = await db
        .from('lotti')
        .select('id')
        .eq('store_id', selectedStore.id);
      if (lottiErr) throw lottiErr;
      const lottiIds = ((lottiStore ?? []) as { id: string }[]).map(l => l.id);

      // Fetch movimenti for lotti of this store in period
      let movimentiQuery = db
        .from('movimenti')
        .select('*, supplier_items!item_id(id, item_code, original_data, extra_data)')
        .gte('created_at', isoInizio)
        .lt('created_at', isoFine);
      if (lottiIds.length > 0) {
        movimentiQuery = movimentiQuery.in('lotto_id', lottiIds);
      } else {
        // No lotti for this store — return empty result
        setData({ caricato_count: 0, caricato_valore: 0, scaricato_count: 0, scaricato_valore: 0, venduto_count: 0, venduto_valore: 0, incassato: 0, ammanchi: [] });
        setLoading(false);
        return;
      }
      const { data: movimenti, error: movErr } = await movimentiQuery;
      if (movErr) throw movErr;

      // Fetch chiusure_cassa in period (global, filtered by operatore if needed)
      const { data: chiusure, error: chiErr } = await db
        .from('chiusure_cassa')
        .select('incassato_operatore')
        .gte('created_at', isoInizio)
        .lt('created_at', isoFine);

      if (chiErr) throw chiErr;

      type MovimentoRow = {
        tipo: string;
        // Supabase returns the joined table under the FK column name when using !fk syntax
        supplier_items: { id: string; item_code: string; original_data: Record<string, string>; extra_data: Record<string, unknown> } | null;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const movList = ((movimenti ?? []) as any[]).map((m: any) => ({
        tipo: m.tipo as string,
        supplier_items: (m.supplier_items ?? null) as MovimentoRow['supplier_items'],
      })) as MovimentoRow[];

      const incassato = ((chiusure ?? []) as { incassato_operatore: number }[])
        .reduce((sum, c) => sum + (Number(c.incassato_operatore) || 0), 0);

      const carichi = movList.filter(m => m.tipo === 'carico');
      const scarichi = movList.filter(m => m.tipo === 'scarico');
      const vendite = movList.filter(m => m.tipo === 'vendita');

      const sumValore = (items: typeof movList) =>
        items.reduce((sum, m) => sum + extractPrezzo(m.supplier_items?.extra_data ?? {}), 0);

      // Ammanchi: articoli caricati non venduti né scaricati
      const vendutoIds = new Set(vendite.map(m => m.supplier_items?.id).filter(Boolean));
      const scaricoIds = new Set(scarichi.map(m => m.supplier_items?.id).filter(Boolean));
      const ammanchi: AmmancoItem[] = carichi
        .filter(m => m.supplier_items && !vendutoIds.has(m.supplier_items.id) && !scaricoIds.has(m.supplier_items.id))
        .map(m => {
          const si = m.supplier_items!;
          const identifier = si.original_data?.['PkgID'] ?? si.original_data?.['LPN'] ?? si.item_code;
          const descKey = Object.keys(si.original_data ?? {}).find(k => k.toLowerCase() === 'itemdesc');
          const desc = descKey ? ((si.original_data ?? {})[descKey] || '—') : '—';
          return { id: si.id, item_code: si.item_code, identifier, desc, prezzo: extractPrezzo(si.extra_data) };
        });

      console.log('[Riconciliazione] result — carichi:', carichi.length, 'scarichi:', scarichi.length, 'vendite:', vendite.length, 'ammanchi:', ammanchi.length, 'incassato:', incassato);

      setData({
        caricato_count: carichi.length,
        caricato_valore: sumValore(carichi),
        scaricato_count: scarichi.length,
        scaricato_valore: sumValore(scarichi),
        venduto_count: vendite.length,
        venduto_valore: sumValore(vendite),
        incassato,
        ammanchi,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante la riconciliazione';
      console.error('[Riconciliazione] error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedStore, dataInizio, dataFine]);

  const differenza = data ? data.incassato - data.venduto_valore : 0;
  const differenzaLabel = formatCurrency(Math.abs(differenza));
  const differenzaPositiva = differenza >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Riconciliazione',
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[Riconciliazione] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Filters */}
        <View style={{
          backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
          borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
          shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
        }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Filtri
          </Text>

          {/* Store selector */}
          <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 }}>Store</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {stores.map(s => {
                const isSelected = selectedStore?.id === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => { console.log('[Riconciliazione] store selected:', s.nome); setSelectedStore(s); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: isSelected ? COLORS.primary : COLORS.surfaceSecondary,
                      borderWidth: 1, borderColor: isSelected ? COLORS.primary : COLORS.border,
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? '#fff' : COLORS.textSecondary }}>
                      {s.nome}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {!storesLoaded && <ActivityIndicator size="small" color={COLORS.primary} />}
            </View>
          </ScrollView>

          {/* Date range */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 }}>Dal</Text>
              <TouchableOpacity
                onPress={() => { console.log('[Riconciliazione] date inizio picker opened'); setShowPickerInizio(true); }}
                style={{
                  backgroundColor: COLORS.surfaceSecondary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
                  borderWidth: 1, borderColor: COLORS.border,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, color: COLORS.text, fontWeight: '500' }}>{formatDate(dataInizio)}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 }}>Al</Text>
              <TouchableOpacity
                onPress={() => { console.log('[Riconciliazione] date fine picker opened'); setShowPickerFine(true); }}
                style={{
                  backgroundColor: COLORS.surfaceSecondary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
                  borderWidth: 1, borderColor: COLORS.border,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, color: COLORS.text, fontWeight: '500' }}>{formatDate(dataFine)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {(showPickerInizio || Platform.OS === 'ios') && showPickerInizio && (
            <DateTimePicker
              value={dataInizio}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, d) => {
                setShowPickerInizio(false);
                if (d) { console.log('[Riconciliazione] dataInizio changed:', d.toISOString()); setDataInizio(d); }
              }}
              maximumDate={dataFine}
            />
          )}
          {(showPickerFine || Platform.OS === 'ios') && showPickerFine && (
            <DateTimePicker
              value={dataFine}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, d) => {
                setShowPickerFine(false);
                if (d) { console.log('[Riconciliazione] dataFine changed:', d.toISOString()); setDataFine(d); }
              }}
              minimumDate={dataInizio}
              maximumDate={today}
            />
          )}

          <AnimatedPressable onPress={handleCalcola} style={{ marginTop: 16, opacity: loading || !selectedStore ? 0.6 : 1 }}>
            <View style={{
              backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            }}>
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <BarChart3 size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Calcola Riconciliazione</Text>
                  </>
              }
            </View>
          </AnimatedPressable>
        </View>

        {error ? (
          <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <Text style={{ color: COLORS.danger, fontSize: 14 }}>{error}</Text>
          </View>
        ) : null}

        {data && (
          <>
            {/* Stats grid */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <StatCard
                label="Caricato"
                count={data.caricato_count}
                valore={data.caricato_valore}
                color={COLORS.statusImported}
                bg={COLORS.statusImportedBg}
                icon={<TrendingUp size={18} color={COLORS.statusImported} />}
              />
              <StatCard
                label="Scaricato"
                count={data.scaricato_count}
                valore={data.scaricato_valore}
                color={COLORS.textSecondary}
                bg={COLORS.surfaceSecondary}
                icon={<TrendingDown size={18} color={COLORS.textSecondary} />}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <StatCard
                label="Venduto"
                count={data.venduto_count}
                valore={data.venduto_valore}
                color={COLORS.primary}
                bg={COLORS.primaryMuted}
                icon={<Package size={18} color={COLORS.primary} />}
              />
              <View style={{
                flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
                borderWidth: 1, borderColor: COLORS.border,
              }}>
                <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.warningMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                  <BarChart3 size={18} color={COLORS.warning} />
                </View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                  Incassato
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.warning, letterSpacing: -0.3 }}>
                  {formatCurrency(data.incassato)}
                </Text>
              </View>
            </View>

            {/* Differenza */}
            <View style={{
              backgroundColor: differenzaPositiva ? COLORS.primaryMuted : COLORS.dangerMuted,
              borderRadius: 14, padding: 16, marginBottom: 16,
              borderWidth: 1, borderColor: differenzaPositiva ? COLORS.primary : COLORS.danger,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 10,
                  backgroundColor: differenzaPositiva ? COLORS.primary : COLORS.danger,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {differenzaPositiva
                    ? <TrendingUp size={20} color="#fff" />
                    : <AlertTriangle size={20} color="#fff" />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: differenzaPositiva ? COLORS.primary : COLORS.danger }}>
                    {differenzaPositiva ? 'Surplus incassato' : 'Ammanco incassato'}
                  </Text>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: differenzaPositiva ? COLORS.primary : COLORS.danger, letterSpacing: -0.3 }}>
                    {differenzaPositiva ? '+' : '-'}{differenzaLabel}
                  </Text>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                    Incassato {formatCurrency(data.incassato)} vs Venduto {formatCurrency(data.venduto_valore)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Ammanchi */}
            {data.ammanchi.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={16} color={COLORS.warning} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.warning, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Ammanchi ({data.ammanchi.length})
                  </Text>
                </View>
                {data.ammanchi.map(item => {
                  const prezzoLabel = formatCurrency(item.prezzo);
                  return (
                    <View key={item.id} style={{
                      backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                      borderWidth: 1, borderColor: COLORS.warningMuted,
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                    }}>
                      <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.warningMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={16} color={COLORS.warning} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }} numberOfLines={1}>{item.identifier}</Text>
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>{item.desc}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.warning }}>{prezzoLabel}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {!data && !loading && !error && (
          <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
            <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.warningMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <BarChart3 size={32} color={COLORS.warning} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
              Seleziona store e periodo
            </Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              Scegli lo store e il periodo di riferimento, poi premi Calcola.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
