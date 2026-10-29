import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import { useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCourierEarningsQueryKey,
  getGetMyProfileQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  useAcceptCourierRoute,
  useCompleteCourierRouteStop,
  useListCourierRoutes,
  useListDeliveries,
  useUpdateDeliveryStatus,
  type CourierDeliveryRoute,
  type Delivery,
} from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const nextIndividualStatus: Record<string, 'TO_STORE' | 'AT_STORE' | 'IN_TRANSIT' | 'COMPLETED'> = {
  ACCEPTED: 'TO_STORE',
  TO_STORE: 'AT_STORE',
  AT_STORE: 'IN_TRANSIT',
  IN_TRANSIT: 'COMPLETED',
};

const nextIndividualLabel: Record<string, string> = {
  ACCEPTED: 'Iniciar deslocamento até a unidade',
  TO_STORE: 'Confirmar chegada à unidade',
  AT_STORE: 'Confirmar retirada',
  IN_TRANSIT: 'Concluir entrega',
};

export default function RoutesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [busyDeliveryId, setBusyDeliveryId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const routeQuery = useListCourierRoutes({
    query: {
      queryKey: getListCourierRoutesQueryKey(),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  const deliveryQuery = useListDeliveries({}, {
    query: {
      queryKey: getListDeliveriesQueryKey(),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  const acceptRoute = useAcceptCourierRoute();
  const completeStop = useCompleteCourierRouteStop();
  const updateDelivery = useUpdateDeliveryStatus();

  const routes = routeQuery.data ?? [];
  const activeRoute = routes.find((route) => route.status === 'ACCEPTED');
  const offeredRoutes = routes.filter((route) => route.status === 'OFFERED');
  const groupedDeliveryIds = useMemo(
    () => new Set(routes.flatMap((route) => route.deliveries.map((delivery) => delivery.id))),
    [routes],
  );
  const individualDeliveries = (deliveryQuery.data ?? []).filter(
    (delivery) => !groupedDeliveryIds.has(delivery.id),
  );
  const individualOffers = individualDeliveries.filter(
    (delivery) => delivery.status === 'OFFERED',
  );
  const activeIndividualDeliveries = individualDeliveries.filter((delivery) =>
    ['ACCEPTED', 'TO_STORE', 'AT_STORE', 'IN_TRANSIT'].includes(delivery.status),
  );
  const isRefreshing = routeQuery.isRefetching || deliveryQuery.isRefetching;
  const topPadding = Platform.OS === 'web' ? 67 : insets.top + 14;

  const refresh = async () => {
    await Promise.all([routeQuery.refetch(), deliveryQuery.refetch()]);
  };

  const requestCurrentLocation = async () => {
    if (Platform.OS === 'web') {
      return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Este navegador não oferece localização.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
          () => reject(new Error('Permita o acesso à localização para calcular a rota.')),
          { enableHighAccuracy: true, timeout: 15_000 },
        );
      });
    }

    let currentPermission = permission;
    if (!currentPermission?.granted) {
      currentPermission = await requestPermission();
    }
    if (!currentPermission.granted) {
      const message = currentPermission.canAskAgain
        ? 'A localização é necessária para calcular a rota a partir de onde você está.'
        : 'Ative a localização do Minas Mais Motoboy nas configurações do aparelho.';
      throw new Error(message);
    }
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
    };
  };

  const handleAcceptRoute = async (route: CourierDeliveryRoute) => {
    setActionError('');
    setBusyRouteId(route.id);
    try {
      const location = await requestCurrentLocation();
      await new Promise<void>((resolve, reject) => {
        acceptRoute.mutate(
          { routeId: route.id, data: location },
          {
            onSuccess: () => resolve(),
            onError: (error) => reject(error),
          },
        );
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível aceitar a rota.');
      await routeQuery.refetch();
    } finally {
      setBusyRouteId(null);
    }
  };

  const handleCompleteStop = async (route: CourierDeliveryRoute, stopId: string) => {
    setActionError('');
    completeStop.mutate(
      { routeId: route.id, stopId },
      {
        onSuccess: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'day' }) }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'week' }) }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'month' }) }),
          ]);
        },
        onError: (error) => setActionError(error instanceof Error ? error.message : 'Não foi possível atualizar a parada.'),
      },
    );
  };

  const handleIndividualAction = async (
    delivery: Delivery,
    status: 'ACCEPTED' | 'TO_STORE' | 'AT_STORE' | 'IN_TRANSIT' | 'COMPLETED',
  ) => {
    setActionError('');
    setBusyDeliveryId(delivery.id);
    updateDelivery.mutate(
      { deliveryId: delivery.id, data: { status } },
      {
        onSuccess: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'day' }) }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'week' }) }),
            queryClient.invalidateQueries({ queryKey: getGetCourierEarningsQueryKey({ period: 'month' }) }),
          ]);
          setBusyDeliveryId(null);
        },
        onError: (error) => {
          setActionError(error instanceof Error ? error.message : 'Não foi possível atualizar a entrega.');
          setBusyDeliveryId(null);
        },
      },
    );
  };

  const openNavigation = async (latitude: number, longitude: number) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Navegação indisponível', 'Não foi possível abrir o aplicativo de mapas.');
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: topPadding,
        paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 96,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.primary}
        />
      }
      testID="courier-routes-screen"
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>MINAS MAIS · MOTOBOY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Olá, {user?.firstName || 'motoboy'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Suas rotas e entregas de hoje
            </Text>
          </View>
          <Pressable
            onPress={() => void refresh()}
            accessibilityLabel="Atualizar rotas"
            testID="button-refresh-routes"
            style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.card }, pressed && styles.pressed]}
          >
            <Feather name="refresh-cw" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {actionError ? (
          <View style={[styles.errorBanner, { backgroundColor: '#fff0ed' }]}>
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{actionError}</Text>
            {Platform.OS !== 'web' && permission?.status === 'denied' && !permission.canAskAgain && (
              <Pressable onPress={() => void Linking.openSettings()} style={styles.settingsButton}>
                <Text style={{ color: colors.destructive, fontWeight: '700' }}>Configurações</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {routeQuery.isLoading || deliveryQuery.isLoading ? (
          <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Carregando suas entregas…</Text>
          </View>
        ) : routeQuery.isError || deliveryQuery.isError ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="wifi-off" size={24} color={colors.mutedForeground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Não foi possível carregar</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Verifique a conexão e tente novamente.</Text>
            <ActionButton label="Tentar novamente" onPress={() => void refresh()} colors={colors} icon="refresh-cw" />
          </View>
        ) : (
          <>
            {activeRoute ? (
              <ActiveRouteCard
                route={activeRoute}
                colors={colors}
                busy={completeStop.isPending}
                onComplete={(stopId) => handleCompleteStop(activeRoute, stopId)}
                onNavigate={openNavigation}
              />
            ) : null}

            {!activeRoute && offeredRoutes.length > 0 ? (
              <View style={styles.section}>
                <SectionHeading title="Rotas disponíveis" count={offeredRoutes.length} colors={colors} />
                {offeredRoutes.map((route) => (
                  <View key={route.id} style={[styles.offerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.offerTop}>
                      <View style={[styles.routeIcon, { backgroundColor: colors.accent }]}>
                        <Feather name="map" size={20} color={colors.primary} />
                      </View>
                      <View style={styles.offerHeading}>
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                          {route.deliveryCount} {route.deliveryCount === 1 ? 'entrega' : 'entregas'}
                        </Text>
                        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                          A sequência será calculada ao aceitar
                        </Text>
                      </View>
                      <Text style={[styles.offerAmount, { color: colors.primary }]}>{currency(route.amountToReceive)}</Text>
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    {route.deliveries.map((delivery) => (
                      <View key={delivery.id} style={styles.deliverySummary}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.deliveryCode, { color: colors.foreground }]}>{delivery.code} · {delivery.customerName}</Text>
                          <Text numberOfLines={2} style={[styles.subtitle, { color: colors.mutedForeground }]}>{delivery.destination}</Text>
                        </View>
                        <Text style={[styles.deliveryAmount, { color: colors.foreground }]}>{currency(delivery.deliveryAmount)}</Text>
                      </View>
                    ))}
                    <View style={styles.offerFooter}>
                      <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total previsto a receber</Text>
                      <Text style={[styles.totalValue, { color: colors.foreground }]}>{currency(route.amountToReceive)}</Text>
                    </View>
                    <ActionButton
                      label={busyRouteId === route.id ? 'Calculando melhor rota…' : 'Aceitar e calcular rota'}
                      onPress={() => void handleAcceptRoute(route)}
                      colors={colors}
                      disabled={busyRouteId !== null}
                      icon="navigation"
                      testID={`button-accept-route-${route.id}`}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {activeIndividualDeliveries.length > 0 ? (
              <View style={styles.section}>
                <SectionHeading title="Entregas individuais em andamento" count={activeIndividualDeliveries.length} colors={colors} />
                {activeIndividualDeliveries.map((delivery) => (
                  <IndividualDeliveryCard
                    key={delivery.id}
                    delivery={delivery}
                    colors={colors}
                    busy={busyDeliveryId === delivery.id}
                    onAction={(status) => void handleIndividualAction(delivery, status)}
                  />
                ))}
              </View>
            ) : null}

            {!activeRoute && individualOffers.length > 0 ? (
              <View style={styles.section}>
                <SectionHeading title="Ofertas individuais" count={individualOffers.length} colors={colors} />
                {individualOffers.map((delivery) => (
                  <IndividualDeliveryCard
                    key={delivery.id}
                    delivery={delivery}
                    colors={colors}
                    busy={busyDeliveryId === delivery.id}
                    onAction={(status) => void handleIndividualAction(delivery, status)}
                  />
                ))}
              </View>
            ) : null}

            {!activeRoute && offeredRoutes.length === 0 && individualOffers.length === 0 && activeIndividualDeliveries.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.routeIcon, { backgroundColor: colors.accent }]}>
                  <Feather name="check-circle" size={22} color={colors.primary} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Tudo em dia</Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Quando uma nova rota ou entrega for oferecida, ela aparecerá aqui.</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function ActiveRouteCard({
  route,
  colors,
  busy,
  onComplete,
  onNavigate,
}: {
  route: CourierDeliveryRoute;
  colors: ReturnType<typeof useColors>;
  busy: boolean;
  onComplete: (stopId: string) => void;
  onNavigate: (latitude: number, longitude: number) => void;
}) {
  const completedStops = route.stops.filter((stop) => stop.status === 'DONE').length;
  const nextStop = route.stops.find((stop) => stop.status === 'PENDING');
  const progress = route.stops.length ? completedStops / route.stops.length : 0;

  return (
    <View style={[styles.activeCard, { backgroundColor: colors.primary }]}>
      <View style={styles.activeHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.activeEyebrow}>ROTA ACEITA · SEQUÊNCIA TRAVADA</Text>
          <Text style={styles.activeTitle}>{route.deliveryCount} entregas</Text>
        </View>
        <View style={styles.activeMoney}>
          <Text style={styles.activeMoneyLabel}>A receber</Text>
          <Text style={styles.activeMoneyValue}>{currency(route.amountToReceive)}</Text>
        </View>
      </View>
      <View style={styles.activeMetrics}>
        {route.distanceKm != null ? <MetricPill icon="map" text={`${route.distanceKm} km`} /> : null}
        {route.estimatedMinutes != null ? <MetricPill icon="clock" text={`${route.estimatedMinutes} min`} /> : null}
        <MetricPill icon="check-square" text={`${completedStops}/${route.stops.length} paradas`} />
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      {nextStop ? (
        <View style={[styles.nextStopCard, { backgroundColor: colors.card }]}>
          <View style={styles.nextStopTop}>
            <View style={[styles.stopNumber, { backgroundColor: colors.accent }]}>
              <Text style={[styles.stopNumberText, { color: colors.primary }]}>{nextStop.sequence}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.nextStopTitle, { color: colors.foreground }]}>
                {nextStop.kind === 'pickup' ? 'Retirada na unidade' : 'Entrega ao cliente'}
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{nextStop.code} · {nextStop.customerName}</Text>
            </View>
            {nextStop.kind === 'delivery' ? (
              <Text style={[styles.deliveryAmount, { color: colors.primary }]}>{currency(nextStop.deliveryAmount)}</Text>
            ) : null}
          </View>
          <Text style={[styles.nextStopAddress, { color: colors.foreground }]}>{nextStop.address}</Text>
          <View style={styles.nextStopActions}>
            <Pressable
              onPress={() => onNavigate(nextStop.latitude, nextStop.longitude)}
              style={({ pressed }) => [styles.navigateButton, { borderColor: colors.border }, pressed && styles.pressed]}
              testID={`button-navigate-stop-${nextStop.id}`}
            >
              <Feather name="navigation" size={16} color={colors.foreground} />
              <Text style={[styles.navigateText, { color: colors.foreground }]}>Navegar</Text>
            </Pressable>
            <ActionButton
              label={busy ? 'Salvando…' : nextStop.kind === 'pickup' ? 'Confirmar retirada' : 'Concluir entrega'}
              onPress={() => onComplete(nextStop.id)}
              colors={colors}
              disabled={busy}
              icon="check"
              testID={`button-complete-stop-${nextStop.id}`}
              compact
            />
          </View>
        </View>
      ) : (
        <View style={[styles.nextStopCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rota concluída</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Todas as entregas desta rota foram finalizadas.</Text>
        </View>
      )}

      <View style={styles.stopList}>
        <Text style={styles.stopListTitle}>Sequência fixa de paradas</Text>
        {route.stops.map((stop) => (
          <View key={stop.id} style={styles.stopRow}>
            <View style={[styles.stopDot, { backgroundColor: stop.status === 'DONE' ? '#ffffff' : 'rgba(255,255,255,0.35)' }]}>
              {stop.status === 'DONE' ? <Feather name="check" size={12} color={colors.primary} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stopRowTitle}>{stop.sequence}. {stop.kind === 'pickup' ? 'Retirada' : 'Entrega'} · {stop.code}</Text>
              <Text numberOfLines={1} style={styles.stopRowAddress}>{stop.address}</Text>
            </View>
            <Text style={styles.stopRowAmount}>{stop.kind === 'delivery' ? currency(stop.deliveryAmount) : ''}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function IndividualDeliveryCard({
  delivery,
  colors,
  busy,
  onAction,
}: {
  delivery: Delivery;
  colors: ReturnType<typeof useColors>;
  busy: boolean;
  onAction: (status: 'ACCEPTED' | 'TO_STORE' | 'AT_STORE' | 'IN_TRANSIT' | 'COMPLETED') => void;
}) {
  const offered = delivery.status === 'OFFERED';
  const nextStatus = offered ? 'ACCEPTED' : nextIndividualStatus[delivery.status];
  const label = offered ? 'Aceitar entrega' : nextIndividualLabel[delivery.status];

  return (
    <View style={[styles.offerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.offerTop}>
        <View style={[styles.routeIcon, { backgroundColor: colors.accent }]}>
          <Feather name="package" size={20} color={colors.primary} />
        </View>
        <View style={styles.offerHeading}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{delivery.code} · {delivery.customerName}</Text>
          <Text numberOfLines={2} style={[styles.subtitle, { color: colors.mutedForeground }]}>{delivery.destination}</Text>
        </View>
        <Text style={[styles.offerAmount, { color: colors.primary }]}>{currency(delivery.deliveryAmount)}</Text>
      </View>
      {nextStatus ? (
        <View style={styles.offerActions}>
          <ActionButton
            label={busy ? 'Salvando…' : label}
            onPress={() => onAction(nextStatus)}
            colors={colors}
            disabled={busy}
            icon={offered ? 'check' : 'arrow-right'}
            compact
          />
        </View>
      ) : null}
    </View>
  );
}

function SectionHeading({ title, count, colors }: { title: string; count: number; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={[styles.countPill, { backgroundColor: colors.secondary }]}>
        <Text style={[styles.countText, { color: colors.mutedForeground }]}>{count}</Text>
      </View>
    </View>
  );
}

function MetricPill({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  return (
    <View style={styles.metricPill}>
      <Feather name={icon} size={13} color="#ffffff" />
      <Text style={styles.metricPillText}>{text}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  colors,
  disabled,
  icon,
  compact,
  testID,
}: {
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  disabled?: boolean;
  icon: React.ComponentProps<typeof Feather>['name'];
  compact?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        compact ? styles.primaryButtonCompact : styles.primaryButton,
        { backgroundColor: colors.primary },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {disabled ? <ActivityIndicator size="small" color="#ffffff" /> : <Feather name={icon} size={16} color="#ffffff" />}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.8, marginTop: 5 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
  iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  section: { gap: 10 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: -0.2 },
  countPill: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  offerCard: { borderWidth: 1, borderRadius: 18, padding: 15, marginBottom: 10 },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  routeIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  offerHeading: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.2 },
  offerAmount: { fontFamily: 'Inter_700Bold', fontSize: 16, marginLeft: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 13 },
  deliverySummary: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  deliveryCode: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  deliveryAmount: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  offerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e7e6e3', marginTop: 10, paddingTop: 12, marginBottom: 12 },
  totalLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  totalValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  primaryButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  primaryButtonCompact: { minHeight: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  primaryButtonText: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 13 },
  offerActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 9, marginTop: 14 },
  navigateButton: { minHeight: 44, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, paddingHorizontal: 12 },
  navigateText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  activeCard: { borderRadius: 22, padding: 16, gap: 13 },
  activeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  activeEyebrow: { color: 'rgba(255,255,255,0.78)', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1 },
  activeTitle: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 5, letterSpacing: -0.5 },
  activeMoney: { alignItems: 'flex-end' },
  activeMoneyLabel: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_500Medium', fontSize: 11 },
  activeMoneyValue: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 4 },
  activeMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 7 },
  metricPillText: { color: '#ffffff', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  progressTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.23)', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: '#ffffff', borderRadius: 5 },
  nextStopCard: { borderRadius: 16, padding: 14, gap: 11 },
  nextStopTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopNumber: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stopNumberText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  nextStopTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  nextStopAddress: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  nextStopActions: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  stopList: { gap: 10, paddingHorizontal: 2 },
  stopListTitle: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stopDot: { width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stopRowTitle: { color: '#ffffff', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  stopRowAddress: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  stopRowAmount: { color: '#ffffff', fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  emptyCard: { borderRadius: 18, borderWidth: 1, padding: 22, alignItems: 'center', gap: 9 },
  loadingCard: { borderRadius: 18, padding: 26, alignItems: 'center', gap: 12 },
  errorBanner: { borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18 },
  settingsButton: { marginLeft: 24, paddingVertical: 5 },
});
