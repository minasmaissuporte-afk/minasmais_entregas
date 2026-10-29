import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { SymbolView } from 'expo-symbols';
import { useAuth, useClerk } from '@clerk/expo';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { useGetMyProfile } from '@workspace/api-client-react';

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
// NativeTabs intentionally does NOT use custom design tokens — liquid glass
// is a system-level appearance provided by iOS and cannot be overridden.
// Custom brand colors are applied only on the ClassicTabLayout path (older iOS / Android / web).
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'map', selected: 'map.fill' }}
        />
        <NativeTabs.Trigger.Label>Rotas</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="earnings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'banknote', selected: 'banknote.fill' }}
        />
        <NativeTabs.Trigger.Label>Ganhos</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Rotas',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name="map" tintColor={color} size={24} />
            ) : (
              <Feather
                name="map"
                size={22}
                color={focused ? colors.primary : colors.mutedForeground}
              />
            ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Ganhos',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name="banknote" tintColor={color} size={24} />
            ) : (
              <Feather
                name="dollar-sign"
                size={22}
                color={focused ? colors.primary : colors.mutedForeground}
              />
            ),
        }}
      />
    </Tabs>
  );
}

function CourierAccessGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const [tokenReady, setTokenReady] = useState(false);
  const profile = useGetMyProfile({
    query: {
      enabled: isLoaded && Boolean(isSignedIn) && tokenReady,
      retry: false,
      refetchInterval: 30_000,
    },
  });

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setAuthTokenGetter(() => getToken());
      setTokenReady(true);
    } else {
      setAuthTokenGetter(null);
      setTokenReady(false);
    }
  }, [getToken, isLoaded, isSignedIn]);

  if (!isLoaded || (isSignedIn && (!tokenReady || profile.isLoading))) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (profile.isError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
        <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Não foi possível validar sua conta</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8, textAlign: 'center' }}>Confira a conexão e tente novamente.</Text>
        <Text onPress={() => void profile.refetch()} style={{ color: colors.primary, marginTop: 18, fontWeight: '700' }}>Tentar novamente</Text>
      </View>
    );
  }
  if (profile.data?.role === 'PENDING') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background }}>
        <Feather name="clock" size={34} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: '700', marginTop: 18, textAlign: 'center' }}>Acesso aguardando aprovação</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>Sua conta precisa ser aprovada e vinculada a um cadastro de motoboy pela administração.</Text>
        <Text onPress={() => void signOut()} style={{ color: colors.primary, marginTop: 22, fontWeight: '700' }}>Sair da conta</Text>
      </View>
    );
  }
  if (profile.data?.role !== 'COURIER') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background }}>
        <Feather name="shield" size={34} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: '700', marginTop: 18, textAlign: 'center' }}>Acesso exclusivo para motoboys</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>Esta conta não está vinculada ao perfil de motoboy.</Text>
        <Text onPress={() => void signOut()} style={{ color: colors.primary, marginTop: 22, fontWeight: '700' }}>Sair da conta</Text>
      </View>
    );
  }
  return <>{children}</>;
}

function TabsContent() {
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}

export default function TabLayout() {
  return (
    <CourierAccessGate>
      <TabsContent />
    </CourierAccessGate>
  );
}
