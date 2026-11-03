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
import { useSignIn } from '@clerk/expo';
import { Href, Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);

  const passwordStep = signIn.status === 'needs_new_password';
  const codeStep = codeSent && !passwordStep;
  const loading = busy || fetchStatus === 'fetching';

  const handleSendCode = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const createResult = await signIn.create({ identifier: emailAddress.trim() });
      if (createResult.error) {
        setRequestError(createResult.error.message);
        return;
      }

      const sendResult = await signIn.resetPasswordEmailCode.sendCode();
      if (sendResult.error) {
        setRequestError(sendResult.error.message);
        return;
      }

      setCode('');
      setCodeSent(true);
    } catch {
      setRequestError('Não foi possível enviar o código. Confira o e-mail e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (result.error) {
        setRequestError(result.error.message);
      }
    } catch {
      setRequestError('Código inválido ou expirado. Confira o e-mail e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendCode = async () => {
    setRequestError('');
    setBusy(true);
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) setRequestError(result.error.message);
    } catch {
      setRequestError('Não foi possível reenviar o código. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitPassword = async () => {
    setRequestError('');
    if (newPassword !== confirmPassword) {
      setRequestError('As senhas não coincidem.');
      return;
    }

    setBusy(true);
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
      });
      if (result.error) {
        setRequestError(result.error.message);
        return;
      }

      if (signIn.status === 'complete') {
        const finalizeResult = await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              setRequestError('Conclua a verificação pendente antes de continuar.');
              return;
            }
            router.replace(decorateUrl('/') as Href);
          },
        });
        if (finalizeResult.error) setRequestError(finalizeResult.error.message);
      } else if (signIn.status === 'needs_second_factor') {
        setRequestError('Sua conta exige uma segunda etapa de verificação. Entre em contato com o administrador.');
      } else {
        setRequestError('A redefinição não foi concluída. Tente novamente.');
      }
    } catch {
      setRequestError('Não foi possível salvar a nova senha. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const handlePrimaryAction = () => {
    if (passwordStep) return void handleSubmitPassword();
    if (codeStep) return void handleVerifyCode();
    return void handleSendCode();
  };

  const title = passwordStep
    ? 'Crie uma nova senha'
    : codeStep
      ? 'Confira seu e-mail'
      : 'Recupere o acesso';
  const subtitle = passwordStep
    ? 'Escolha uma senha nova para entrar no aplicativo.'
    : codeStep
      ? `Enviamos um código de redefinição para ${emailAddress.trim()}.`
      : 'Informe o e-mail da sua conta. Enviaremos um código para redefinir sua senha.';
  const primaryLabel = passwordStep ? 'Salvar nova senha' : codeStep ? 'Verificar código' : 'Enviar código';
  const primaryDisabled = loading
    || (passwordStep && (!newPassword || !confirmPassword))
    || (codeStep && !code.trim())
    || (!codeStep && !passwordStep && !emailAddress.trim());

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
        <Feather name="lock" size={23} color="#ffffff" />
      </View>
      <Text style={[styles.kicker, { color: colors.primary }]}>MINAS MAIS · MOTOBOY</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>

      {!codeStep && !passwordStep ? (
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
            testID="input-reset-email"
          />
          {errors.fields.identifier ? (
            <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.identifier.message}</Text>
          ) : null}
        </>
      ) : null}

      {codeStep ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Código de redefinição</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="Código recebido por e-mail"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-reset-code"
          />
          {errors.fields.code ? (
            <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.code.message}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleResendCode()}
            disabled={loading}
            testID="button-resend-reset-code"
            style={styles.secondaryAction}
          >
            <Text style={[styles.link, { color: colors.primary }]}>Enviar outro código</Text>
          </Pressable>
        </>
      ) : null}

      {passwordStep ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Nova senha</Text>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholder="Digite a nova senha"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-reset-new-password"
          />
          {errors.fields.password ? (
            <Text style={[styles.fieldError, { color: colors.destructive }]}>{errors.fields.password.message}</Text>
          ) : null}
          <Text style={[styles.label, { color: colors.foreground }]}>Confirme a nova senha</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholder="Digite novamente"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            testID="input-reset-confirm-password"
          />
        </>
      ) : null}

      {requestError ? (
        <Text style={[styles.errorBox, { color: colors.destructive, backgroundColor: '#fff0ed' }]}>{requestError}</Text>
      ) : null}

      <Pressable
        onPress={handlePrimaryAction}
        disabled={primaryDisabled}
        testID="button-reset-password"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.primary },
          (pressed || primaryDisabled) && { opacity: 0.75 },
        ]}
      >
        {loading ? <ActivityIndicator color="#ffffff" /> : <Feather name="arrow-right" size={17} color="#ffffff" />}
        <Text style={styles.primaryText}>{primaryLabel}</Text>
      </Pressable>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Lembrou sua senha?</Text>
        <Link href={'/(auth)/sign-in' as Href} asChild>
          <Pressable accessibilityRole="link" testID="link-back-to-sign-in">
            <Text style={[styles.link, { color: colors.primary }]}>Voltar para entrar</Text>
          </Pressable>
        </Link>
      </View>
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
  secondaryAction: { alignSelf: 'flex-end', paddingVertical: 10 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24 },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  link: { fontFamily: 'Inter_700Bold', fontSize: 12 },
});
