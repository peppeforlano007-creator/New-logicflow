import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Store, Plus, ChevronRight, ArrowLeft, X, MapPin } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { SkeletonList } from '@/components/SkeletonLoader';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { db } from '@/utils/db';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreItem {
  id: string;
  nome: string;
  indirizzo: string | null;
  active: boolean;
  created_at: string;
}

// ─── AnimatedListItem ─────────────────────────────────────────────────────────

function AnimatedListItem({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, []);
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StoresScreen() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNome, setNewNome] = useState('');
  const [newIndirizzo, setNewIndirizzo] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    console.log('[Stores] fetchStores called');
    try {
      const { data, error } = await db.from('stores').select('*').order('nome');
      if (error) { console.error('[Stores] fetchStores error:', error); throw error; }
      console.log('[Stores] fetchStores success, count:', data?.length ?? 0);
      setStores((data as StoreItem[]) ?? []);
    } catch (err) {
      console.error('[Stores] fetchStores exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchStores(); }, [fetchStores]));

  const handleRefresh = useCallback(() => {
    console.log('[Stores] handleRefresh triggered');
    setRefreshing(true);
    fetchStores();
  }, [fetchStores]);

  const handleToggleActive = async (store: StoreItem) => {
    const newActive = !store.active;
    console.log('[Stores] toggle active for store:', store.nome, '->', newActive);
    try {
      const { error } = await db.from('stores').update({ active: newActive }).eq('id', store.id);
      if (error) throw error;
      setStores(prev => prev.map(s => s.id === store.id ? { ...s, active: newActive } : s));
    } catch (err) {
      console.error('[Stores] toggle active error:', err);
    }
  };

  const handleStorePress = (store: StoreItem) => {
    console.log('[Stores] store pressed:', store.nome, 'id:', store.id);
    router.push(`/magazzino/store/${store.id}` as any);
  };

  const handleOpenCreate = () => {
    console.log('[Stores] FAB pressed — open create modal');
    setNewNome('');
    setNewIndirizzo('');
    setCreateError(null);
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    console.log('[Stores] Crea Store button pressed, nome:', newNome);
    if (!newNome.trim()) {
      setCreateError('Il nome dello store è obbligatorio');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const { error } = await db.from('stores').insert({
        nome: newNome.trim(),
        indirizzo: newIndirizzo.trim() || null,
        active: true,
      });
      if (error) throw error;
      console.log('[Stores] Store created successfully:', newNome.trim());
      setShowCreateModal(false);
      fetchStores();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore creazione store';
      console.error('[Stores] create error:', msg);
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const renderItem = useCallback(({ item, index }: { item: StoreItem; index: number }) => {
    const activeBg = item.active ? COLORS.primaryMuted : COLORS.surfaceSecondary;
    const activeColor = item.active ? COLORS.primary : COLORS.textSecondary;
    const activeLabel = item.active ? 'Attivo' : 'Inattivo';

    return (
      <AnimatedListItem index={index}>
        <View style={{
          backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10,
          borderWidth: 1, borderColor: COLORS.border,
          shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <AnimatedPressable onPress={() => handleStorePress(item)} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 42, height: 42, borderRadius: 11,
                  backgroundColor: activeBg,
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Store size={20} color={activeColor} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 3 }} numberOfLines={1}>
                    {item.nome}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {item.indirizzo ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <MapPin size={11} color={COLORS.textTertiary} />
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary }} numberOfLines={1}>
                          {item.indirizzo}
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ backgroundColor: activeBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: activeColor }}>{activeLabel}</Text>
                    </View>
                  </View>
                </View>
                <ChevronRight size={18} color={COLORS.textTertiary} />
              </View>
            </AnimatedPressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.divider }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' }}>
              {item.active ? 'Store attivo' : 'Store disattivato'}
            </Text>
            <Switch
              value={item.active}
              onValueChange={() => handleToggleActive(item)}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </AnimatedListItem>
    );
  }, []);

  const emptyState = (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
      <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.statusProcessingBg, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Store size={32} color={COLORS.statusProcessing} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
        Nessuno store configurato
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
        Aggiungi il primo punto vendita con il pulsante +
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{
        title: 'Stores',
        headerShown: true,
        headerLeft: () => (
          <AnimatedPressable onPress={() => { console.log('[Stores] back pressed'); router.back(); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 }}>
              <ArrowLeft size={20} color={COLORS.primary} />
            </View>
          </AnimatedPressable>
        ),
      }} />

      {loading ? (
        <View style={{ padding: 16, paddingBottom: 120 }}>
          <SkeletonList count={4} />
        </View>
      ) : (
        <FlatList
          data={stores}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
          ListHeaderComponent={
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {stores.length} store{stores.length !== 1 ? 's' : ''}
            </Text>
          }
          ListEmptyComponent={emptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        />
      )}

      {/* FAB */}
      <AnimatedPressable onPress={handleOpenCreate} style={{
        position: 'absolute', bottom: 32, right: 20,
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: COLORS.primary,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
      }}>
        <Plus size={26} color="#fff" />
      </AnimatedPressable>

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>Nuovo Store</Text>
            <AnimatedPressable onPress={() => { console.log('[Stores] create modal dismissed'); setShowCreateModal(false); }}>
              <View style={{ padding: 4 }}>
                <X size={22} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>
          <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Nome Store *
            </Text>
            <TextInput
              value={newNome}
              onChangeText={setNewNome}
              placeholder="es. Store Milano Centro"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16,
              }}
              autoCorrect={false}
            />
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Indirizzo (opzionale)
            </Text>
            <TextInput
              value={newIndirizzo}
              onChangeText={setNewIndirizzo}
              placeholder="Via Roma 1, Milano"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, marginBottom: 24,
              }}
              autoCorrect={false}
            />
            {createError ? (
              <View style={{ backgroundColor: COLORS.dangerMuted, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ color: COLORS.danger, fontSize: 13 }}>{createError}</Text>
              </View>
            ) : null}
            <AnimatedPressable onPress={handleCreate} style={{ opacity: creating ? 0.7 : 1 }}>
              <View style={{
                backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
              }}>
                {creating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Crea Store</Text>
                }
              </View>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
