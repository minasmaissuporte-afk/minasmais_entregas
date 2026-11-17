import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAccessUsersQueryKey,
  getListCouriersQueryKey,
  useInviteAccessUser,
  type AppUser,
} from "@workspace/api-client-react";
import { MailPlus, Send } from "lucide-react";
import { appUrl } from "@/lib/auth";
import { AutoDismissFeedback, type FeedbackMessage } from "@/components/auto-dismiss-feedback";

type InviteRole = "COURIER" | "STORE_MANAGER" | "ADMIN";

const inviteRoles: { value: InviteRole; label: string; hint: string }[] = [
  { value: "COURIER", label: "Motoboy", hint: "Entra direto no app do motoboy." },
  { value: "STORE_MANAGER", label: "Gerente da filial", hint: "Vê e registra as entregas da filial dele." },
  { value: "ADMIN", label: "Administrador", hint: "Acesso completo, igual ao seu." },
];

export function inviteErrorMessage(error: unknown) {
  const apiError = error as Error & { data?: { error?: string } };
  return apiError?.data?.error ?? "Não foi possível enviar o convite. Tente de novo.";
}

export function useSendInvite() {
  const queryClient = useQueryClient();
  const invite = useInviteAccessUser();
  const send = (data: { email: string; name: string; role: InviteRole; storeId?: string | null; phone?: string | null }) =>
    invite.mutateAsync({ data: { ...data, redirectTo: appUrl("/aceitar-convite") } }).then((user) => {
      void queryClient.invalidateQueries({ queryKey: getListAccessUsersQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListCouriersQueryKey() });
      return user;
    });
  return { send, pending: invite.isPending };
}

/**
 * Convite por e-mail: o admin informa e-mail, nome e perfil; a pessoa recebe um
 * link, escolhe a senha e já entra com o perfil certo (sem passar por aprovação).
 */
export default function AccessInvitePanel({
  stores,
}: {
  stores: { id: string; name: string; city: string; active: boolean }[];
}) {
  const { send, pending } = useSendInvite();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<InviteRole>("COURIER");
  const [storeId, setStoreId] = useState("");
  const [phone, setPhone] = useState("");
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const activeStores = stores.filter((store) => store.active);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    if (role === "STORE_MANAGER" && !storeId) {
      setFeedback({ kind: "error", text: "Escolha a filial do gerente." });
      return;
    }
    try {
      const user: AppUser = await send({
        email: email.trim(),
        name: name.trim(),
        role,
        storeId: role === "ADMIN" ? null : storeId || null,
        phone: role === "COURIER" ? phone.trim() || null : null,
      });
      setFeedback({
        kind: "success",
        text: `Convite enviado para ${user.email}. Peça para olhar a caixa de entrada (e o spam) e criar a senha pelo link.`,
      });
      setEmail("");
      setName("");
      setPhone("");
    } catch (error) {
      setFeedback({ kind: "error", text: inviteErrorMessage(error) });
    }
  };

  return (
    <section className="panel mb-5 overflow-hidden" aria-labelledby="invite-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="metric-icon metric-icon-red"><MailPlus size={17} /></span>
        <div>
          <h2 id="invite-title" className="text-sm font-bold">Convidar por e-mail</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A pessoa recebe um link, escolhe a senha e já entra com o perfil escolhido.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-4 px-5 py-5 sm:grid-cols-2 xl:grid-cols-4">
        <label className="field-label">
          E-mail
          <input
            type="email"
            required
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nome@exemplo.com"
            data-testid="input-invite-email"
          />
        </label>
        <label className="field-label">
          Nome
          <input
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome completo"
            data-testid="input-invite-name"
          />
        </label>
        <label className="field-label">
          Perfil
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as InviteRole)}
            data-testid="select-invite-role"
          >
            {inviteRoles.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {inviteRoles.find((item) => item.value === role)?.hint}
          </span>
        </label>
        {role === "STORE_MANAGER" ? (
          <label className="field-label">
            Filial
            <select required value={storeId} onChange={(event) => setStoreId(event.target.value)} data-testid="select-invite-store">
              <option value="">Escolha a filial</option>
              {activeStores.map((store) => (
                <option key={store.id} value={store.id}>{store.name} · {store.city}</option>
              ))}
            </select>
          </label>
        ) : role === "COURIER" ? (
          <label className="field-label">
            Telefone (opcional)
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(35) 99999-0000"
              data-testid="input-invite-phone"
            />
          </label>
        ) : (
          <div className="hidden xl:block" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-3 sm:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[1px] flex-1">
            {feedback && <AutoDismissFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />}
          </div>
          <button type="submit" className="button-primary min-h-11 px-5" disabled={pending} aria-busy={pending} data-testid="button-send-invite">
            <Send size={16} aria-hidden="true" /> {pending ? "Enviando convite…" : "Enviar convite"}
          </button>
        </div>
      </form>
    </section>
  );
}
