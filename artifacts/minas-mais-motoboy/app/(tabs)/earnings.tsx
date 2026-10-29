import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useClerk } from '@clerk/expo';
import { useGetCourierEarnings, type GetCourierEarningsParams } from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const periods: Array<{ value: NonNullable<GetCourierEarningsParams['period']>; label: string }> = [
  { value: 'day', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function EarningsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useClerk();
  const [period, setPeriod] = useState<NonNullable<GetCourierEarningsParams['period']>>('day');
  const earnings = useGetCourierEarnings(
    { period },
    { query: { refetchInterval: 30_000, refetchOnWindowFocus: true } },
  );
  const topPadding = Platform.OS === 'web' ? 67 : insets.top + 14;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: topPadding,
        paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 96,
      }}
      refreshControl={
        <RefreshControl
          refreshing={earnings.isRefetching}
          onRefresh={() => void earnings.refetch()}
          tintColor={colors.primary}
        />
      }
      testID="courier-earnings-screen"
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>MINAS MAIS · MOTOBOY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Seus ganhos</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Entregas concluídas e valor a receber</Text>
          </View>
          <Pressable
            onPress={() => void signOut()}
            accessibilityLabel="Sair da conta"
            testID="button-sign-out"
            style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.card }, pressed && { opacity: 0.7 }]}
          >
            <Feather name="log-out" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        <View style={[styles.periodPicker, { backgroundColor: colors.secondary }]}>
          {periods.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setPeriod(item.value)}
              testID={`button-period-${item.value}`}
              style={[
                styles.periodButton,
                period === item.value && { backgroundColor: colors.card },
              ]}
            >
              <Text
                style={[
                  styles.periodText,
                  { color: period === item.value ? colors.foreground : colors.mutedForeground },
                  period === item.value && styles.periodTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {earnings.isLoading ? (
          <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Carregando seus ganhos…</Text>
          </View>
        ) : earnings.isError ? (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="wifi-off" size={23} color={colors.mutedForeground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Não foi possível carregar</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Verifique a conexão e tente novamente.</Text>
            <Pressable onPress={() => void earnings.refetch()} style={[styles.retryButton, { backgroundColor: colors.primary }]}>
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.amountCard, { backgroundColor: colors.primary }]}>
            <Text style={styles.amountLabel}>Valor das entregas concluídas</Text>
            <Text style={styles.amountValue}>{currency(earnings.data?.amountToReceive ?? 0)}</Text>
            <View style={styles.statDivider} />
            <View style={styles.statRow}>
              <View style={styles.statIcon}>
                <Feather name="package" size={18} color="#ffffff" />
              </View>
              <View>
                <Text style={styles.statValue}>{earnings.data?.completedDeliveries ?? 0}</Text>
                <Text style={styles.statLabel}>entregas concluídas</Text>
              </View>
              <Feather name="trending-up" size={20} color="rgba(255,255,255,0.8)" style={{ marginLeft: 'auto' }} />
            </View>
          </View>
        )}

        <View style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.noteIcon, { backgroundColor: colors.accent }]}>
            <Feather name="info" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Como o total é calculado</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              O período soma os valores cadastrados para cada entrega concluída. O total de uma rota ativa aparece na tela Rotas.
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
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
  periodPicker: { flexDirection: 'row', padding: 4, borderRadius: 14, gap: 4 },
  periodButton: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  periodTextActive: { fontFamily: 'Inter_700Bold' },
  amountCard: { borderRadius: 22, padding: 20 },
  amountLabel: { color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium', fontSize: 13 },
  amountValue: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 36, letterSpacing: -1.2, marginTop: 10 },
  statDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 18 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 19 },
  statLabel: { color: 'rgba(255,255,255,0.78)', fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 1 },
  noteCard: { borderWidth: 1, borderRadius: 17, padding: 15, flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  noteIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  loadingCard: { borderRadius: 18, padding: 26, alignItems: 'center', gap: 12 },
  infoCard: { borderRadius: 18, borderWidth: 1, padding: 22, alignItems: 'center', gap: 8 },
  retryButton: { borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11, marginTop: 5 },
  retryText: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 13 },
});
