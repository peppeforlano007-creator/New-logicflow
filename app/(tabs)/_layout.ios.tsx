import React from 'react';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

export default function TabLayout() {
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
    </NativeTabs>
  );
}
