import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/AppColors';
import { Check, AlertCircle, X } from 'lucide-react-native';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessageProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  onHide: () => void;
  duration?: number;
}

export function ToastMessage({
  message,
  type = 'success',
  visible,
  onHide,
  duration = 3000,
}: ToastMessageProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => onHide());
  }, [translateY, opacity, onHide]);

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 6,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(hide, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, hide, translateY, opacity]);

  if (!visible) return <></>;

  const bgColor =
    type === 'success' ? COLORS.accent :
    type === 'error' ? COLORS.danger :
    type === 'warning' ? COLORS.warning :
    COLORS.primary;

  const Icon = type === 'success' ? Check : type === 'error' ? X : type === 'warning' ? AlertCircle : AlertCircle;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: insets.top + 12,
        left: 16,
        right: 16,
        zIndex: 9999,
        transform: [{ translateY }],
        opacity,
      }}
    >
      <View
        style={{
          backgroundColor: bgColor,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}
      >
        <Icon size={18} color="#FFFFFF" strokeWidth={2.5} />
        <Text
          style={{
            color: '#FFFFFF',
            fontSize: 14,
            fontWeight: '600',
            flex: 1,
          }}
          numberOfLines={2}
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

// Hook for easy toast management
export function useToast() {
  const [toast, setToast] = React.useState<{
    message: string;
    type: ToastType;
    visible: boolean;
  }>({ message: '', type: 'success', visible: false });

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    console.log('[Toast] showToast:', { message, type });
    setToast({ message, type, visible: true });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
