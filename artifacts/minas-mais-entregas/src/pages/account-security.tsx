import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { authErrorMessage, HAS_PASSWORD_FLAG, supabase, useAuth, userHasPassword } from "@/lib/auth";

export default function AccountSecurityPage() {
  const { user, isLoaded, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!isLoaded || !user) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#f4f3f1] p-5">
        <section className="panel w-full max-w-lg p-6 text-sm text-muted-foreground">
          Carregando segurança da conta…
        </section>
      </main>
    );
  }

  // Accounts that only used the e-mail code or Google can create their first password without a current one.
  const passwordEnabled = userHasPassword(user);
  const email = user.email ?? "Conta conectada";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("A confirmação não corresponde à nova senha.");
      return;
    }
    if (passwordEnabled && !currentPassword) {
      setError("Informe sua senha atual.");
      return;
    }

    setIsSaving(true);
    try {
      if (passwordEnabled) {
        // Supabase does not check the current password on update, so confirm it first.
        const { error: checkError } = await supabase.auth.signInWithPassword({ email: user.email ?? "", password: currentPassword });
        if (checkError) {
          setError(authErrorMessage(checkError).startsWith("E-mail ou senha") ? "A senha atual não confere." : authErrorMessage(checkError));
          return;
        }
      }
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        data: { [HAS_PASSWORD_FLAG]: true },
      });
      if (updateError) {
        setError(authErrorMessage(updateError, "Não foi possível atualizar a senha. Confira a conexão e tente novamente."));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSuccess(passwordEnabled ? "Senha atualizada com sucesso." : "Senha criada. Agora você também pode entrar com e-mail e senha.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f3f1] px-4 py-5 text-[#24272d] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between rounded-xl border border-[#e7e6e3] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="brand-mark">MM</span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-muted-foreground">Conta e segurança</div>
            </div>
          </div>
          <button
            type="button"
            className="button-quiet"
            onClick={() => void signOut()}
          >
            <LogOut size={15} /> Sair
          </button>
        </header>

        <div className="mt-6">
          <Link href="/user-portal" className="button-quiet min-h-9">
            <ArrowLeft size={15} /> Voltar ao sistema
          </Link>
        </div>

        <section className="panel mt-4 p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="metric-icon metric-icon-red mt-0.5"><ShieldCheck size={18}/></span>
            <div>
              <div className="eyebrow">SEGURANÇA DA CONTA</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Alterar senha</h1>
              <p className="mt-1 break-all text-sm text-muted-foreground">{email}</p>
            </div>
          </div>

          <div className="mt-5 rounded-lg bg-[#f7f6f4] p-4 text-sm text-muted-foreground">
            {passwordEnabled
              ? "Use sua senha atual para definir uma nova."
              : "Sua conta entra com código por e-mail. Defina uma senha para também entrar com e-mail e senha."}
          </div>

          <form className="mt-5 space-y-4" onSubmit={submit}>
            {passwordEnabled && (
              <label className="block space-y-1.5">
                <span className="eyebrow">SENHA ATUAL</span>
                <input
                  className="w-full rounded-lg border border-[#e2e0dd] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#b91e2c]"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  disabled={isSaving}
                />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="eyebrow">NOVA SENHA</span>
              <input
                className="w-full rounded-lg border border-[#e2e0dd] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#b91e2c]"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                disabled={isSaving}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="eyebrow">CONFIRMAR NOVA SENHA</span>
              <input
                className="w-full rounded-lg border border-[#e2e0dd] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#b91e2c]"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                disabled={isSaving}
              />
            </label>

            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
            {success && <p role="status" className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-800">{success}</p>}

            <button type="submit" className="button-primary min-h-11 w-full sm:w-auto" disabled={isSaving}>
              <KeyRound size={16} /> {isSaving ? "Salvando…" : passwordEnabled ? "Salvar nova senha" : "Criar senha"}
            </button>
          </form>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            A senha é gerenciada com segurança pelo serviço de autenticação e não é armazenada pelo webapp.
          </p>
        </section>
      </div>
    </main>
  );
}
