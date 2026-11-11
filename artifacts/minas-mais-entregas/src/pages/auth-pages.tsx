import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, KeyRound, LoaderCircle, Mail, MailCheck } from "lucide-react";
import { appUrl, authErrorMessage, HAS_PASSWORD_FLAG, supabase, useAuth } from "@/lib/auth";

/*
 * Login screens backed by Supabase Auth (replace the former Clerk components).
 * Three ways in: e-mail + password, 6-digit code by e-mail, and Google (browser
 * only: Google blocks its sign-in inside the Android app's WebView).
 * People who already had an account in the old system sign in with the code or
 * "Esqueci minha senha"; the API links them to their profile by e-mail.
 */

const isNativeApp = Capacitor.isNativePlatform();

function AuthLayout({ title, subtitle, children, back }: { title: string; subtitle?: string; children: ReactNode; back?: { href: string; label: string } }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f4f3f1] px-4 py-8 text-[#24272d]">
      <section className="panel w-full max-w-[440px] p-6 sm:p-8">
        {back && (
          <Link href={back.href} className="button-quiet -ml-2 mb-3 min-h-10 px-2 text-sm">
            <ArrowLeft size={15} /> {back.label}
          </Link>
        )}
        <Link href="/" className="inline-flex items-center gap-3" title="Página inicial">
          <span className="brand-mark" aria-hidden="true">MM</span>
          <span className="leading-tight">
            <span className="block text-sm font-bold">MINAS MAIS</span>
            <span className="mt-0.5 block text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Entregas</span>
          </span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

function TextField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-[#3f4248]">{label}</span>
      <input className="min-h-12 text-base" {...props} />
    </label>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">{message}</p>;
}

function SubmitButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button type="submit" className="button-primary min-h-12 w-full justify-center text-sm" disabled={busy} aria-busy={busy}>
      {busy ? <><LoaderCircle size={16} className="animate-spin" /> {busyLabel}</> : children}
    </button>
  );
}

function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isNativeApp) return null;
  const start = async () => {
    setError("");
    setBusy(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: appUrl("/user-portal") },
    });
    // On success the browser leaves the page; only failures come back here.
    if (oauthError) {
      setError(authErrorMessage(oauthError, "Não foi possível entrar com o Google. Tente outra forma de acesso."));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
      </div>
      <button type="button" className="button-secondary min-h-12 w-full justify-center text-sm" onClick={() => void start()} disabled={busy} aria-busy={busy}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {busy ? "Abrindo o Google…" : "Entrar com Google"}
      </button>
      <FormError message={error} />
    </div>
  );
}

function useRedirectWhenSignedIn() {
  const { isLoaded, isSignedIn, passwordRecovery } = useAuth();
  return isLoaded && isSignedIn && !passwordRecovery;
}

export function SignInPage() {
  const signedIn = useRedirectWhenSignedIn();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSentTo, setCodeSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (signedIn) return <Redirect to="/user-portal" />;

  const normalizedEmail = email.trim().toLowerCase();

  const signInWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    setBusy(false);
    if (signInError) setError(authErrorMessage(signInError, "Não foi possível entrar. Tente de novo."));
    else setLocation("/user-portal");
  };

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setBusy(true);
    // Creates the login on first use, which is how people from the old system get back in.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true, emailRedirectTo: appUrl("/user-portal") },
    });
    setBusy(false);
    if (otpError) {
      setError(authErrorMessage(otpError, "Não foi possível enviar o código. Tente de novo."));
      return;
    }
    setCodeSentTo(normalizedEmail);
    setCode("");
    setCooldown(60);
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: codeSentTo, token: code.trim(), type: "email" });
    setBusy(false);
    if (verifyError) setError(authErrorMessage(verifyError, "Código inválido ou expirado. Peça um novo código."));
    else setLocation("/user-portal");
  };

  const switchMode = (next: "password" | "code") => {
    setMode(next);
    setError("");
    setCodeSentTo("");
  };

  return (
    <AuthLayout title="Bem-vindo de volta" subtitle="Entre para acompanhar as entregas.">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f1efec] p-1" role="group" aria-label="Forma de entrar">
        {([["password", "Com senha"], ["code", "Sem senha"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`min-h-11 rounded-lg text-sm font-semibold ${mode === value ? "bg-white text-[#24272d] shadow-sm" : "text-[#5f646b]"}`}
            aria-pressed={mode === value}
            onClick={() => switchMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "password" ? (
        <form className="mt-5 space-y-4" onSubmit={signInWithPassword}>
          <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <TextField label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          <div className="-mt-1 text-right">
            <Link href={`/esqueci-senha${normalizedEmail ? `?email=${encodeURIComponent(normalizedEmail)}` : ""}`} className="text-sm font-semibold text-[#a91d2a]">Esqueci minha senha</Link>
          </div>
          <FormError message={error} />
          <SubmitButton busy={busy} busyLabel="Entrando…">Entrar</SubmitButton>
        </form>
      ) : codeSentTo ? (
        <form className="mt-5 space-y-4" onSubmit={verifyCode}>
          <p className="flex gap-2 rounded-lg bg-[#f7f6f4] p-3 text-sm text-[#3f4248]" role="status">
            <MailCheck size={18} className="mt-0.5 shrink-0 text-[#a91d2a]" aria-hidden="true" />
            <span>Enviamos um e-mail de acesso para <strong className="break-all">{codeSentTo}</strong>. Abra neste aparelho e toque no link, ou digite abaixo o código de 6 dígitos, se ele vier no e-mail. Confira também o spam.</span>
          </p>
          <TextField
            label="Código"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <FormError message={error} />
          <SubmitButton busy={busy} busyLabel="Conferindo…">Entrar</SubmitButton>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" className="min-h-10 font-semibold text-[#a91d2a] disabled:text-muted-foreground" disabled={cooldown > 0 || busy} onClick={() => void sendCode()}>
              {cooldown > 0 ? `Reenviar e-mail em ${cooldown}s` : "Reenviar e-mail"}
            </button>
            <button type="button" className="min-h-10 font-semibold text-[#5f646b]" onClick={() => setCodeSentTo("")}>Trocar e-mail</button>
          </div>
        </form>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={sendCode}>
          <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <p className="text-sm text-muted-foreground">Você recebe um e-mail de acesso e entra sem senha. Use esta opção no seu primeiro acesso ao sistema novo.</p>
          <FormError message={error} />
          <SubmitButton busy={busy} busyLabel="Enviando…"><Mail size={16} /> Enviar e-mail de acesso</SubmitButton>
        </form>
      )}

      <div className="mt-4"><GoogleButton /></div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Ainda não tem acesso? <Link href="/sign-up" className="font-semibold text-[#a91d2a]">Solicitar acesso</Link>
      </p>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const signedIn = useRedirectWhenSignedIn();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationSentTo, setConfirmationSentTo] = useState("");

  if (signedIn) return <Redirect to="/user-portal" />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("A confirmação não corresponde à senha.");
    setBusy(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: appUrl("/user-portal"),
        data: { full_name: name.trim(), [HAS_PASSWORD_FLAG]: true },
      },
    });
    setBusy(false);
    if (signUpError) return setError(authErrorMessage(signUpError, "Não foi possível criar a conta. Tente de novo."));
    if (data.session) setLocation("/user-portal");
    else setConfirmationSentTo(normalizedEmail);
  };

  if (confirmationSentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail" back={{ href: "/sign-in", label: "Voltar para entrar" }}>
        <p className="flex gap-2 rounded-lg bg-[#f7f6f4] p-4 text-sm leading-relaxed text-[#3f4248]" role="status">
          <MailCheck size={18} className="mt-0.5 shrink-0 text-[#a91d2a]" aria-hidden="true" />
          <span>Enviamos um link de confirmação para <strong className="break-all">{confirmationSentTo}</strong>. Abra o e-mail neste aparelho para ativar a conta. Depois, um administrador libera o seu acesso.</span>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Solicite seu acesso" subtitle="Sua conta será liberada por um administrador." back={{ href: "/sign-in", label: "Já tenho conta" }}>
      <form className="space-y-4" onSubmit={submit}>
        <TextField label="Nome completo" autoComplete="name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} />
        <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField label="Senha" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
        <TextField label="Confirmar senha" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <FormError message={error} />
        <SubmitButton busy={busy} busyLabel="Criando conta…">Criar conta</SubmitButton>
      </form>
      <div className="mt-4"><GoogleButton /></div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Prefere sem senha? <Link href="/sign-in" className="font-semibold text-[#a91d2a]">Entre com um e-mail de acesso</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: appUrl("/redefinir-senha") });
    setBusy(false);
    if (resetError) setError(authErrorMessage(resetError, "Não foi possível enviar o e-mail. Tente de novo."));
    else setSentTo(normalizedEmail);
  };

  return (
    <AuthLayout title="Esqueci minha senha" subtitle="Enviamos um link para você criar uma nova senha." back={{ href: "/sign-in", label: "Voltar para entrar" }}>
      {sentTo ? (
        <p className="flex gap-2 rounded-lg bg-[#f7f6f4] p-4 text-sm leading-relaxed text-[#3f4248]" role="status">
          <MailCheck size={18} className="mt-0.5 shrink-0 text-[#a91d2a]" aria-hidden="true" />
          <span>Se existir uma conta para <strong className="break-all">{sentTo}</strong>, o link chega em alguns minutos. Confira também o spam. Primeiro acesso ao sistema novo? Use <Link href="/sign-in" className="font-semibold text-[#a91d2a]">entrar sem senha</Link>.</span>
        </p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <FormError message={error} />
          <SubmitButton busy={busy} busyLabel="Enviando…"><Mail size={16} /> Enviar link</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isLoaded) {
    return <AuthLayout title="Abrindo o link…"><div className="skeleton h-12 w-full" /></AuthLayout>;
  }
  if (!isSignedIn) {
    return (
      <AuthLayout title="Link inválido ou expirado" back={{ href: "/sign-in", label: "Voltar para entrar" }}>
        <p className="text-sm text-muted-foreground">Peça um novo link. Ele vale por pouco tempo e só pode ser usado uma vez.</p>
        <Link href="/esqueci-senha" className="button-primary mt-5 min-h-12 w-full justify-center text-sm">Pedir novo link</Link>
      </AuthLayout>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("A confirmação não corresponde à nova senha.");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { [HAS_PASSWORD_FLAG]: true } });
    setBusy(false);
    if (updateError) setError(authErrorMessage(updateError, "Não foi possível salvar a nova senha. Tente de novo."));
    else setLocation("/user-portal");
  };

  return (
    <AuthLayout title="Criar nova senha" subtitle="Escolha uma senha com pelo menos 8 caracteres.">
      <form className="space-y-4" onSubmit={submit}>
        <TextField label="Nova senha" type="password" autoComplete="new-password" minLength={8} required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
        <TextField label="Confirmar nova senha" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <FormError message={error} />
        <SubmitButton busy={busy} busyLabel="Salvando…"><KeyRound size={16} /> Salvar e entrar</SubmitButton>
      </form>
    </AuthLayout>
  );
}

/** After a recovery e-mail link lands on another page, send the person to the new-password form. */
export function PasswordRecoveryRedirect() {
  const { passwordRecovery } = useAuth();
  const [location] = useLocation();
  if (passwordRecovery && location !== "/redefinir-senha") return <Redirect to="/redefinir-senha" />;
  return null;
}
