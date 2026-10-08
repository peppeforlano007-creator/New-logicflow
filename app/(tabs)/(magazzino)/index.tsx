import React, { useRef, useEffect } from 'react';
import { View, Text, ScrollView, Animated } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Package, Layers, Store, BarChart3, ChevronRight } from 'lucide-react-native';
import { COLORS } from '@/constants/AppColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useAuth } from '@/contexts/AuthContext';

// ─── AnimatedCard ─────────────────────────────────────────────────────────────

function AnimatedCard({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  index: number;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function SectionCard({ index, icon, iconBg, title, subtitle, onPress }: SectionCardProps) {
  return (
    <AnimatedCard index={index}>
      <AnimatedPressable onPress={onPress}>
        <View style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 18,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: COLORS.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
          elevation: 2,
        }}>
          <View style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: iconBg,
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {icon}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 3 }}>
              {title}
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 }}>
              {subtitle}
            </Text>
          </View>
          <ChevronRight size={20} color={COLORS.textTertiary} />
        </View>
      </AnimatedPressable>
    </AnimatedCard>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MagazzinoHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const handleProdotti = () => {
    console.log('[MagazzinoHome] Navigating to Prodotti');
    router.push('/magazzino/prodotti' as any);
  };

  const handleLotti = () => {
    console.log('[MagazzinoHome] Navigating to Lotti');
    router.push('/magazzino/lotti' as any);
  };

  const handleStores = () => {
    console.log('[MagazzinoHome] Navigating to Stores');
    router.push('/magazzino/stores' as any);
  };

  const handleRiconciliazione = () => {
    console.log('[MagazzinoHome] Navigating to Riconciliazione');
    router.push('/magazzino/riconciliazione' as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ title: 'Magazzino' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Header */}
        <View style={{ marginBottom: 24, marginTop: 8 }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 }}>
            Magazzino
          </Text>
          <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 4 }}>
            Gestisci prodotti, lotti e punti vendita
          </Text>
        </View>

        <SectionCard
          index={0}
          icon={<Package size={22} color={COLORS.primary} />}
          iconBg={COLORS.primaryMuted}
          title="Prodotti"
          subtitle="Lista articoli ricevuti e lavorati"
          onPress={handleProdotti}
        />

        <SectionCard
          index={1}
          icon={<Layers size={22} color={COLORS.statusImported} />}
          iconBg={COLORS.statusImportedBg}
          title="Lotti"
          subtitle="Gestione lotti e carico a store"
          onPress={handleLotti}
        />

        {isAdmin && (
          <SectionCard
            index={2}
            icon={<Store size={22} color={COLORS.statusProcessing} />}
            iconBg={COLORS.statusProcessingBg}
            title="Stores"
            subtitle="Anagrafica punti vendita"
            onPress={handleStores}
          />
        )}

        {isAdmin && (
          <SectionCard
            index={3}
            icon={<BarChart3 size={22} color={COLORS.warning} />}
            iconBg={COLORS.warningMuted}
            title="Riconciliazione"
            subtitle="Confronto carico / scarico / venduto"
            onPress={handleRiconciliazione}
          />
        )}
      </ScrollView>
    </View>
  );
}
