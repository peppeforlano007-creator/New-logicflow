import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Package, ChevronRight, Clock } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/utils/db';

interface Supplier {
  id: string;
  name: string;
  slug: string;
  color: string;
  has_full_flow: boolean;
  sort_order: number;
}

const FLOW_STEPS = [
  { key: 'import', label: 'Import', route: 'import', permission: 'import' },
  { key: 'ricezione', label: 'Ricezione', route: 'ricezione', permission: 'ricezione' },
  { key: 'lavorazione', label: 'Lavorazione', route: 'lavorazione', permission: 'lavorazione' },
  { key: 'export', label: 'Export', route: 'export', permission: 'export' },
] as const;

export default function FornitoriHubScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = user?.role === 'admin';
  const permissions = user?.tab_permissions ?? [];

  const hasPermission = useCallback(
    (permKey: string) => {
      if (isAdmin) return true;
      return permissions.includes(permKey);
    },
    [isAdmin, permissions],
  );

  const fetchSuppliers = useCallback(async () => {
    console.log('[FornitoriHub] fetchSuppliers called');
    try {
      const { data, error } = await db
        .from('suppliers')
        .select('id, name, slug, color, has_full_flow, sort_order')
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[FornitoriHub] fetchSuppliers error:', error);
        throw error;
      }

      console.log('[FornitoriHub] fetchSuppliers success, count:', data?.length ?? 0);
      setSuppliers((data as Supplier[]) ?? []);
    } catch (err) {
      console.error('[FornitoriHub] fetchSuppliers exception:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchSuppliers();
    }, [fetchSuppliers]),
  );

  const handleRefresh = useCallback(() => {
    console.log('[FornitoriHub] handleRefresh called');
    setRefreshing(true);
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleStepPress = useCallback(
    (supplier: Supplier, stepRoute: string, stepKey: string) => {
      console.log('[FornitoriHub] step button pressed', {
        supplier: supplier.slug,
        step: stepKey,
        hasFullFlow: supplier.has_full_flow,
      });
      if (!supplier.has_full_flow) return;
      if (!hasPermission(stepKey)) return;
      const path = `/fornitori/${supplier.slug}/${stepRoute}`;
      console.log('[FornitoriHub] navigating to:', path);
      router.push(path as any);
    },
    [router, hasPermission],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Fornitori', headerShown: true }} />
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Fornitori', headerShown: true }} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
      >
        {suppliers.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                backgroundColor: COLORS.primaryMuted,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Package size={32} color={COLORS.primary} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' }}>
              Nessun fornitore
            </Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              Aggiungi fornitori nella tabella suppliers per iniziare.
            </Text>
          </View>
        ) : (
          suppliers.map(supplier => {
            const hasFullFlow = supplier.has_full_flow;
            const badgeLabel = hasFullFlow ? 'Flusso completo' : 'In arrivo';
            const badgeBg = hasFullFlow ? COLORS.primaryMuted : COLORS.surfaceSecondary;
            const badgeColor = hasFullFlow ? COLORS.primary : COLORS.textTertiary;

            return (
              <View
                key={supplier.id}
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  borderLeftWidth: 4,
                  borderLeftColor: supplier.color,
                  overflow: 'hidden',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 4,
                  elevation: 1,
                }}
              >
                {/* Card header */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: 16,
                    paddingBottom: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 9,
                        backgroundColor: `${supplier.color}20`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Package size={18} color={supplier.color} />
                    </View>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: COLORS.text }}>
                      {supplier.name}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: badgeBg,
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {!hasFullFlow && <Clock size={11} color={badgeColor} />}
                    <Text style={{ fontSize: 11, fontWeight: '700', color: badgeColor }}>
                      {badgeLabel}
                    </Text>
                  </View>
                </View>

                {/* Flow step buttons */}
                <View
                  style={{
                    flexDirection: 'row',
                    paddingHorizontal: 12,
                    paddingBottom: 14,
                    gap: 8,
                  }}
                >
                  {FLOW_STEPS.map(step => {
                    const permitted = hasPermission(step.permission);
                    const enabled = hasFullFlow && permitted;
                    const btnBg = enabled ? `${supplier.color}15` : COLORS.surfaceSecondary;
                    const btnBorder = enabled ? `${supplier.color}40` : COLORS.border;
                    const btnTextColor = enabled ? supplier.color : COLORS.textTertiary;

                    return (
                      <TouchableOpacity
                        key={step.key}
                        onPress={() => handleStepPress(supplier, step.route, step.permission)}
                        disabled={!enabled}
                        activeOpacity={0.75}
                        style={{
                          flex: 1,
                          backgroundColor: btnBg,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: btnBorder,
                          paddingVertical: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          opacity: enabled ? 1 : 0.5,
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '700', color: btnTextColor }}>
                          {step.label}
                        </Text>
                        {enabled && (
                          <ChevronRight size={10} color={btnTextColor} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
