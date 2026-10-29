import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth, useSignUp } from '@clerk/expo';
import { Href, Link, Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signUp, errors, fetchStatus } = useSignUp();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);

  const verificationStep =
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0;

  const handleCreateAccount = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signUp.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (result.error) {
        setRequestError(result.error.message);
      } else {
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) setRequestError(sent.error.message);
      }
    } catch {
      setRequestError('Não foi possível criar sua conta. Confira os dados e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (result.error) {
        setRequestError(result.error.message);
      } else if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              setRequestError('Conclua a verificação pendente antes de continuar.');
              return;
            }
            router.replace(decorateUrl('/') as Href);
          },
        });
      }
    } catch {
      setRequestError('Código inválido ou expirado. Confira o e-mail e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  if (isSignedIn) return <Redirect href="/" />;

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 22,
        paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 22,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 24,
      }}
      bottomOffset={20}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
        <Feather name="navigation" size={25} color="#ffffff" />
      </View>
      <Text style={[styles.kicker, { color: colors.primary }]}>MINAS MAIS · MOTOBOY</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {verificationStep ? 'Confirme seu e-mail' : 'Crie sua conta'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {verificationStep
          ? 'Digite o código enviado para seu e-mail.'
          : 'Depois do cadastro, a administração vinculará seu perfil de motoboy.'}
      </Text>

      {!verificationStep ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>E-mail</Text>
          <TextInput
            value={emailAddress}
            onChangeText={setEmailAddress}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="seu@email.com"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-sign-up-email"
          />
          {errors.fields.emailAddress ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.emailAddress.message}</Text> : null}
          <Text style={[styles.label, { color: colors.foreground }]}>Senha</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholder="Crie uma senha"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-sign-up-password"
          />
          {errors.fields.password ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.password.message}</Text> : null}
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Código de verificação</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="Código recebido por e-mail"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-sign-up-code"
          />
          {errors.fields.code ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.code.message}</Text> : null}
        </>
      )}

      {requestError ? <Text style={[styles.errorBox, { color: colors.destructive, backgroundColor: '#fff0ed' }]}>{requestError}</Text> : null}
      <Pressable
        onPress={() => void (verificationStep ? handleVerify() : handleCreateAccount())}
        disabled={busy || fetchStatus === 'fetching' || (!verificationStep && (!emailAddress || !password)) || (verificationStep && !code)}
        testID="button-sign-up"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.primary },
          (pressed || busy || fetchStatus === 'fetching') && { opacity: 0.75 },
        ]}
      >
        {busy || fetchStatus === 'fetching' ? <ActivityIndicator color="#ffffff" /> : <Feather name="arrow-right" size={17} color="#ffffff" />}
        <Text style={styles.primaryText}>{verificationStep ? 'Confirmar código' : 'Criar conta'}</Text>
      </Pressable>
      {verificationStep ? (
        <Pressable onPress={() => void signUp.verifications.sendEmailCode()} style={styles.resendButton}>
          <Text style={[styles.link, { color: colors.primary }]}>Enviar outro código</Text>
        </Pressable>
      ) : null}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Já tem uma conta?</Text>
        <Link href="/(auth)/sign-in" asChild>
          <Pressable><Text style={[styles.link, { color: colors.primary }]}>Entrar</Text></Pressable>
        </Link>
      </View>
      <View nativeID="clerk-captcha" />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  brandMark: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -0.8, marginTop: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 7, marginTop: 12 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 15 },
  fieldError: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 5 },
  errorBox: { borderRadius: 11, padding: 11, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 13 },
  primaryButton: { minHeight: 50, borderRadius: 14, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryText: { color: '#ffffff', fontFamily: 'Inter_700Bold', fontSize: 14 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 24 },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  link: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  resendButton: { alignSelf: 'center', paddingTop: 17 },
});
