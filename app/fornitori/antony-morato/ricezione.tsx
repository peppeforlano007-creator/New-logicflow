import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Clock, ArrowLeft } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';

export default function PlaceholderScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen
        options={{
          title: 'Ricezione — Antony Morato',
          headerShown: true,
          headerLeft: () => (
            <TouchableOpacity onPress={() => { console.log('[AntonyMorato/Ricezione] Back button pressed'); router.back(); }} style={{ marginRight: 8 }}>
              <ArrowLeft size={22} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Clock size={48} color={COLORS.textTertiary} />
        <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.text, marginTop: 16 }}>
          Flusso in arrivo
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 }}>
          Il flusso per questo fornitore è in fase di sviluppo.
        </Text>
      </View>
    </View>
  );
}
