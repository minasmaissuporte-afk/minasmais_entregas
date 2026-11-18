import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter, setAuthTokenRefresher } from "@workspace/api-client-react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}

/** Single Supabase client for the whole app (web, PWA and Android wrapper). */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
/** Absolute URL inside this app, used for e-mail links and the Google redirect. */
export function appUrl(path: string) {
  return `${window.location.origin}${basePath}${path}`;
}

/** Marks that the account has a password, so the security page asks for the current one. */
export const HAS_PASSWORD_FLAG = "has_password";
export function userHasPassword(user: User | null | undefined) {
  return Boolean(user?.user_metadata?.[HAS_PASSWORD_FLAG]);
}

type AuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: Session | null;
  user: User | null;
  /** True after the user opened a "redefinir senha" e-mail link. */
  passwordRecovery: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isLoaded, setIsLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Every API call carries the current access token. If it is about to expire (the tab
    // was idle or the computer slept, so the automatic refresh did not run), renew it first.
    const refreshToken = async () => {
      const { data } = await supabase.auth.refreshSession();
      return data.session?.access_token ?? null;
    };
    setAuthTokenGetter(async () => {
      const current = (await supabase.auth.getSession()).data.session;
      if (!current) return null;
      const expiresInMs = (current.expires_at ?? 0) * 1000 - Date.now();
      if (expiresInMs < 60_000) return (await refreshToken().catch(() => null)) ?? current.access_token;
      return current.access_token;
    });
    // A request that still gets 401 renews the session and is retried once.
    setAuthTokenRefresher(refreshToken);

    // Back to the tab after a while: make sure the session is fresh before anything runs.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data }) => {
        const expiresInMs = (data.session?.expires_at ?? 0) * 1000 - Date.now();
        if (data.session && expiresInMs < 5 * 60_000) void refreshToken().catch(() => undefined);
      });
    };
    document.addEventListener("visibilitychange", onVisible);

    const applySession = (next: Session | null) => {
      const userId = next?.user.id ?? null;
      // A different person signed in on this device: drop cached data from the previous account.
      if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear();
      previousUserId.current = userId;
      setSession(next);
    };

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setIsLoaded(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      // A new password was saved (or the person left): the recovery flow is over.
      if (event === "SIGNED_OUT" || event === "USER_UPDATED") setPasswordRecovery(false);
      applySession(next);
      setIsLoaded(true);
    });
    return () => {
      data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      setAuthTokenGetter(null);
      setAuthTokenRefresher(null);
    };
  }, [queryClient]);

  const value = useMemo<AuthState>(() => ({
    isLoaded,
    isSignedIn: Boolean(session),
    session,
    user: session?.user ?? null,
    passwordRecovery,
    signOut: async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      window.location.assign(`${basePath}/`);
    },
  }), [isLoaded, session, passwordRecovery, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** Turns Supabase Auth errors into pt-BR messages people can act on. */
export function authErrorMessage(error: unknown, fallback = "Não foi possível concluir. Tente novamente.") {
  const raw = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const text = `${code} ${raw}`.toLowerCase();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Sem internet no momento. Confira a conexão e tente de novo.";
  if (text.includes("invalid_credentials") || text.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (text.includes("email_not_confirmed") || text.includes("email not confirmed")) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (text.includes("otp_expired") || text.includes("token has expired") || text.includes("invalid otp")) return "Código inválido ou expirado. Peça um novo código.";
  if (text.includes("user_already_exists") || text.includes("already registered")) return "Já existe uma conta com este e-mail. Entre ou use \"Esqueci minha senha\".";
  if (text.includes("weak_password") || text.includes("password should")) return "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.";
  if (text.includes("same_password") || text.includes("should be different")) return "A nova senha precisa ser diferente da atual.";
  if (text.includes("over_email_send_rate_limit") || text.includes("rate limit") || text.includes("security purposes")) return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
  if (text.includes("signup_disabled") || text.includes("signups not allowed")) return "Este e-mail não tem conta. Peça acesso a um administrador.";
  return fallback;
}
