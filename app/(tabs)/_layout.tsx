import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import FloatingTabBar, { TabBarItem } from '@/components/FloatingTabBar';
import { useAuth } from '@/contexts/AuthContext';
import { COLORS } from '@/constants/AppColors';

const ALL_TABS: TabBarItem[] = [
  { name: '(import)', route: '/(tabs)/(import)' as any, icon: 'file-download', label: 'Import' },
  { name: '(ricezione)', route: '/(tabs)/(ricezione)' as any, icon: 'inventory', label: 'Ricezione' },
  { name: '(lavorazione)', route: '/(tabs)/(lavorazione)' as any, icon: 'build', label: 'Lavorazione' },
  { name: '(magazzino)', route: '/(tabs)/(magazzino)' as any, icon: 'inventory-2', label: 'Magazzino' },
  { name: '(export)', route: '/(tabs)/(export)' as any, icon: 'file-upload', label: 'Export' },
];

const PERMISSION_MAP: Record<string, string> = {
  '(import)': 'import',
  '(ricezione)': 'ricezione',
  '(lavorazione)': 'lavorazione',
  '(magazzino)': 'magazzino',
  '(export)': 'export',
};

export default function TabLayout() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const permissions = user?.tab_permissions ?? [];
  const visibleTabs = ALL_TABS.filter(tab => {
    const permKey = PERMISSION_MAP[tab.name];
    return permKey ? permissions.includes(permKey) : true;
  });

  const isAdmin = user?.role === 'admin';

  const handleLogout = async () => {
    console.log('[TabLayout] Logout button pressed');
    await logout();
  };

  const handleAdminPress = () => {
    console.log('[TabLayout] Admin button pressed');
    router.push('/admin');
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Floating action buttons: logout + optional admin */}
      <View style={styles.floatingButtons} pointerEvents="box-none">
        {isAdmin && (
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={handleAdminPress}
            activeOpacity={0.8}
          >
            <Text style={styles.adminBtnText}>Admin</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutBtnText}>Esci</Text>
        </TouchableOpacity>
      </View>

      <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="(import)" />
        <Stack.Screen name="(ricezione)" />
        <Stack.Screen name="(lavorazione)" />
        <Stack.Screen name="(magazzino)" />
        <Stack.Screen name="(export)" />
      </Stack>
      <FloatingTabBar tabs={visibleTabs} containerWidth={420} />
    </View>
  );
}

const styles = StyleSheet.create({
  floatingButtons: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 999,
    flexDirection: 'row',
    gap: 8,
  },
  adminBtn: {
    backgroundColor: COLORS.primaryMuted,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  adminBtnText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  logoutBtn: {
    backgroundColor: COLORS.dangerMuted,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  logoutBtnText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
