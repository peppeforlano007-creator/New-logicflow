import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Camera, ArrowLeft, Package, Trash2, CheckCircle } from 'lucide-react-native';
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
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScaricaScreen() {
  const router = useRouter();
  const { lotto_id } = useLocalSearchParams<{ lotto_id: string }>();

  const [scannerVisible, setScannerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  const lookupItem = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    console.log('[Scarico] lookupItem called for code:', trimmed, 'lotto_id:', lotto_id);
    setSearching(true);
    setSearchError(null);
    try {
      // Search by item_code or PkgID in extra_data
      const { data, error } = await db
        .from('supplier_items')
        .select('id, item_code, original_data, extra_data')
        .or(`item_code.eq.${trimmed},extra_data->>PkgID.eq.${trimmed}`)
        .limit(1)
        .single();

      if (error || !data) {
        console.log('[Scarico] item not found for code:', trimmed);
        setSearchError(`Articolo non trovato: ${trimmed}`);
        return;
      }

      const identifier = data.original_data?.['PkgID'] ?? data.original_data?.['LPN'] ?? data.item_code;
      const descKey = Object.keys(data.original_data ?? {}).find((k: string) => k.toLowerCase() === 'itemdesc');
      const desc = descKey ? ((data.original_data ?? {})[descKey] || '—') : '—';

      // Check duplicate
      if (scannedItems.some(i => i.id === data.id)) {
        console.log('[Scarico] item already scanned:', identifier);
        setSearchError(`Articolo già scansionato: ${identifier}`);
        return;
      }

      const newItem: ScannedItem = { id: data.id, item_code: data.item_code, identifier, desc };
      console.log('[Scarico] item added to list:', identifier);
      setScannedItems(prev => [newItem, ...prev]);
      setSearchQuery('');
    } catch (err) {
      console.error('[Scarico] lookupItem exception:', err);
      setSearchError('Errore durante la ricerca');
    } finally {
      setSearching(false);
    }
  }, [lotto_id, scannedItems]);

  const handleRemoveItem = (id: string) => {
    console.log('[Scarico] remove item pressed, id:', id);
    setScannedItems(prev => prev.filter(i => i.id !== id));
  };

  const handleConfermaScario = async () => {
    if (scannedItems.length === 0) {
      Alert.alert('Nessun articolo', 'Scansiona almeno un articolo prima di confermare.');
      return;
    }
    if (!lotto_id) {
      Alert.alert('Errore', 'Lotto non specificato.');
      return;
    }
    console.log('[Scarico] Conferma Scarico pressed — items:', scannedItems.length, 'lotto_id:', lotto_id);
    setConfirming(true);
    try {
      // INSERT movimenti tipo='scarico' per ogni articolo
      const movimenti = scannedItems.map(item => ({
        lotto_id,
        item_id: item.id,
        tipo: 'scarico',
      }));
      const { error: movErr } = await db.from('movimenti').insert(movimenti);
      if (movErr) throw movErr;

      // UPDATE lotto stato='scaricato', store_id=null
      const { error: lottoErr } = await db
        .from('lotti')
        .update({ stato: 'scaricato', store_id: null })
        .eq('id', lotto_id);
      if (lottoErr) throw lottoErr;

      console.log('[Scarico] Scarico completato con successo, items:', scannedItems.length);
      Alert.alert('Scarico completato', `${scannedItems.length} articoli scaricati con successo.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante lo scarico';
      console.error('[Scarico] conferma error:', msg);
      Alert.alert('Errore', msg);
    } finally {
      setConfirming(false);
    }
  };

  const renderItem = ({ item, index }: { item: ScannedItem; index: number }) => (
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
      <AnimatedPressable onPress={() => handleRemoveItem(item.id)}>
        <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: COLORS.dangerMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={16} color={COLORS.danger} />
        </View>
      </AnimatedPressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Scarico Lotto',
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

            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 }}>
              Articoli scansionati ({scannedItems.length})
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: COLORS.primaryMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
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
        <AnimatedPressable onPress={handleConfermaScario} style={{ opacity: confirming || scannedItems.length === 0 ? 0.6 : 1 }}>
          <View style={{
            backgroundColor: scannedItems.length === 0 ? COLORS.textTertiary : COLORS.primary,
            borderRadius: 14, paddingVertical: 16,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: scannedItems.length === 0 ? 0 : 0.25, shadowRadius: 8, elevation: scannedItems.length === 0 ? 0 : 4,
          }}>
            {confirming
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <CheckCircle size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    Conferma Scarico ({scannedItems.length})
                  </Text>
                </>
            }
          </View>
        </AnimatedPressable>
      </View>

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
    </View>
  );
}
