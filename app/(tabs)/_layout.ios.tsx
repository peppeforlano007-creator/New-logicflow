import React from 'react';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { useAuth } from '@/contexts/AuthContext';

export default function TabLayout() {
  const { user } = useAuth();
  const permissions = user?.tab_permissions ?? [];
  const hasCassa = permissions.includes('cassa');

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(import)">
        <Icon sf="arrow.down.doc.fill" />
        <Label>Import</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(ricezione)">
        <Icon sf="shippingbox.fill" />
        <Label>Ricezione</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(lavorazione)">
        <Icon sf="wrench.fill" />
        <Label>Lavorazione</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(magazzino)">
        <Icon sf="shippingbox.and.arrow.backward.fill" />
        <Label>Magazzino</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(export)">
        <Icon sf="arrow.up.doc.fill" />
        <Label>Export</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(cassa)" tabBarItemStyle={hasCassa ? undefined : { display: 'none' }}>
        <Icon sf="cart.fill" />
        <Label>Cassa</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
