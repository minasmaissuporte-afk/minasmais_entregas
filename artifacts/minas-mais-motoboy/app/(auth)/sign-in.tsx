import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Feather } from '@expo/vector-icons';
import { useAuth, useSignIn, useSSO } from '@clerk/expo';
import { Href, Link, Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => void WebBrowser.coolDownAsync();
  }, []);
}

export default function SignInScreen() {
  useWarmUpBrowser();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);

  const finishSignIn = useCallback(async () => {
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          setRequestError('Conclua a verificação pendente antes de continuar.');
          return;
        }
        router.replace(decorateUrl('/') as Href);
      },
    });
  }, [router, signIn]);

  const handlePasswordSignIn = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signIn.password({ emailAddress: emailAddress.trim(), password });
      if (result.error) {
        setRequestError(result.error.message);
      } else if (signIn.status === 'complete') {
        await finishSignIn();
      } else if (signIn.status === 'needs_client_trust') {
        const factor = signIn.supportedSecondFactors.find((item) => item.strategy === 'email_code');
        if (factor) await signIn.mfa.sendEmailCode();
      } else if (signIn.status === 'needs_second_factor') {
        setRequestError('Esta conta exige uma segunda etapa de verificação não configurada neste fluxo.');
      }
    } catch {
      setRequestError('Não foi possível entrar. Confira seu e-mail e senha.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (result.error) {
        setRequestError(result.error.message);
      } else if (signIn.status === 'complete') {
        await finishSignIn();
      }
    } catch {
      setRequestError('Código inválido ou expirado. Confira o e-mail e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'minas-mais-motoboy' }),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              setRequestError('Conclua a verificação pendente antes de continuar.');
              return;
            }
            router.replace(decorateUrl('/') as Href);
          },
        });
      } else {
        setRequestError('Não foi possível concluir o acesso com Google.');
      }
    } catch {
      setRequestError('A entrada com Google não foi concluída. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  if (isSignedIn) return <Redirect href="/" />;

  const verifying = signIn.status === 'needs_client_trust';
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
        {verifying ? 'Confirme sua entrada' : 'Acesse suas rotas'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {verifying
          ? 'Enviamos um código para confirmar sua identidade.'
          : 'Entre para aceitar entregas e acompanhar seus ganhos.'}
      </Text>

      {!verifying ? (
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
            testID="input-sign-in-email"
          />
          {errors.fields.identifier ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.identifier.message}</Text> : null}
          <Text style={[styles.label, { color: colors.foreground }]}>Senha</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="Sua senha"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-sign-in-password"
          />
          {errors.fields.password ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.password.message}</Text> : null}
          <Link href={'/(auth)/forgot-password' as Href} asChild>
            <Pressable
              accessibilityRole="link"
              testID="link-forgot-password"
              style={styles.forgotPasswordButton}
            >
              <Text style={[styles.link, { color: colors.primary }]}>Esqueceu a senha?</Text>
            </Pressable>
          </Link>
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
            testID="input-sign-in-code"
          />
          {errors.fields.code ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.code.message}</Text> : null}
        </>
      )}

      {requestError ? <Text style={[styles.errorBox, { color: colors.destructive, backgroundColor: '#fff0ed' }]}>{requestError}</Text> : null}

      <Pressable
        onPress={() => void (verifying ? handleVerify() : handlePasswordSignIn())}
        disabled={busy || fetchStatus === 'fetching' || (!verifying && (!emailAddress || !password)) || (verifying && !code)}
        testID="button-sign-in"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.primary },
          (pressed || busy || fetchStatus === 'fetching') && { opacity: 0.75 },
        ]}
      >
        {busy || fetchStatus === 'fetching' ? <ActivityIndicator color="#ffffff" /> : <Feather name="arrow-right" size={17} color="#ffffff" />}
        <Text style={styles.primaryText}>{verifying ? 'Confirmar código' : 'Entrar'}</Text>
      </Pressable>

      {!verifying ? (
        <>
          <View style={styles.separator}>
            <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.separatorText, { color: colors.mutedForeground }]}>ou</Text>
            <View style={[styles.separatorLine, { backgroundColor: colors.border }]} />
          </View>
          <Pressable
            onPress={() => void handleGoogleSignIn()}
            disabled={busy}
            testID="button-google-sign-in"
            style={({ pressed }) => [styles.googleButton, { borderColor: colors.border, backgroundColor: colors.card }, pressed && { opacity: 0.75 }]}
          >
            <Feather name="globe" size={17} color={colors.foreground} />
            <Text style={[styles.googleText, { color: colors.foreground }]}>Continuar com Google</Text>
          </Pressable>
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Ainda não tem acesso?</Text>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable><Text style={[styles.link, { color: colors.primary }]}>Criar conta</Text></Pressable>
            </Link>
          </View>
        </>
      ) : (
        <Pressable onPress={() => void signIn.mfa.sendEmailCode()} style={styles.resendButton}>
          <Text style={[styles.link, { color: colors.primary }]}>Enviar outro código</Text>
        </Pressable>
      )}
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
  separator: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  googleButton: { minHeight: 48, borderRadius: 13, borderWidth: 1, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  googleText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 24 },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  link: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  forgotPasswordButton: { alignSelf: 'flex-end', paddingVertical: 8 },
  resendButton: { alignSelf: 'center', paddingVertical: 18 },
});
