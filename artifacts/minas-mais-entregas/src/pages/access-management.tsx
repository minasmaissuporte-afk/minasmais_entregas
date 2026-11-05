import { useQueryClient } from "@tanstack/react-query";
import {
  getListAccessUsersQueryKey,
  getListCouriersQueryKey,
  useListAccessUsers,
  useListCouriers,
  useListStores,
  useDeleteAccessUser,
  useUpdateAccessUser,
  type AppUser,
} from "@workspace/api-client-react";
import { Check, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useUser } from "@clerk/react";
import { useEffect, useState } from "react";

const roles: { value: AppUser["role"]; label: string }[] = [
  { value: "PENDING", label: "Aguardando aprovação" },
  { value: "ADMIN", label: "Administrador" },
  { value: "CENTRAL", label: "Central de entregas" },
  { value: "STORE_MANAGER", label: "Gerente de unidade" },
  { value: "STORE_STAFF", label: "Equipe da unidade" },
  { value: "COURIER", label: "Motoboy" },
];

export default function AccessManagement() {
  const { user: signedInUser } = useUser();
  const users = useListAccessUsers();
  const stores = useListStores();
  const couriers = useListCouriers({ includeUnlinked: true });
  const adminCount = users.data?.filter((user) => user.role === "ADMIN").length ?? 0;

  return (
    <div className="soft-enter">
      <div className="mb-6">
        <div className="eyebrow">ADMINISTRAÇÃO</div>
        <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">
          Acessos e perfis
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Novas contas começam sem permissão. Aprove usuários e vincule cada
          perfil à unidade ou ao cadastro de motoboy correto.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
          Excluir uma conta também apaga o login. O histórico das entregas é preservado; o último administrador e motoboys com trabalho ativo não podem ser excluídos.
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="metric-icon metric-icon-red"><UsersRound size={17} /></span>
            <div>
              <h2 className="text-sm font-bold">Contas cadastradas</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {users.data?.length ?? 0} contas · alterações aplicadas imediatamente
              </p>
            </div>
          </div>
          <ShieldCheck size={18} className="text-[#5b8a69]" />
        </div>

        {users.isLoading ? (
          <div className="space-y-3 p-5" aria-label="Carregando contas">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-full" />
          </div>
        ) : users.isError ? (
          <div className="p-5 text-sm text-red-700">
            Não foi possível carregar as contas. Tente novamente.
          </div>
        ) : users.data?.length ? (
          <div className="divide-y divide-border">
            {users.data.map((user) => (
              <UserAccessRow
                key={user.id}
                user={user}
                stores={stores.data ?? []}
                couriers={couriers.data ?? []}
                isCurrentUser={Boolean(user.clerkUserId && user.clerkUserId === signedInUser?.id)}
                isLastAdmin={user.role === "ADMIN" && adminCount <= 1}
                hasActiveWork={Boolean(
                  user.role === "COURIER" &&
                    couriers.data?.some((courier) => courier.id === user.courierId && courier.status === "BUSY"),
                )}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Ainda não há contas cadastradas. Peça à equipe para criar uma conta
            e entrar uma vez; ela aparecerá aqui aguardando aprovação.
          </div>
        )}
      </section>
    </div>
  );
}

function UserAccessRow({
  user,
  stores,
  couriers,
  isCurrentUser,
  isLastAdmin,
  hasActiveWork,
}: {
  user: AppUser;
  stores: { id: string; name: string; city: string; active: boolean }[];
  couriers: { id: string; name: string; phone?: string | null; status: string }[];
  isCurrentUser: boolean;
  isLastAdmin: boolean;
  hasActiveWork: boolean;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateAccessUser();
  const deleteAccount = useDeleteAccessUser();
  const [role, setRole] = useState<AppUser["role"]>(user.role);
  const [storeId, setStoreId] = useState(user.storeId ?? "");
  const [courierId, setCourierId] = useState(user.courierId ?? "");
  const [name, setName] = useState(user.role === "COURIER" ? user.name : "");
  const [phone, setPhone] = useState(user.role === "COURIER" ? user.phone ?? "" : "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setRole(user.role);
    setStoreId(user.storeId ?? "");
    setCourierId(user.courierId ?? "");
    setName(user.role === "COURIER" ? user.name : "");
    setPhone(user.role === "COURIER" ? user.phone ?? "" : "");
  }, [user.role, user.storeId, user.courierId, user.name, user.phone]);

  const needsStore = role === "STORE_MANAGER" || role === "STORE_STAFF";
  const needsCourier = role === "COURIER";
  const isChanged =
    role !== user.role ||
    storeId !== (user.storeId ?? "") ||
    courierId !== (user.courierId ?? "") ||
    (needsCourier && name.trim() !== user.name) ||
    (needsCourier && (phone.trim() || "") !== (user.phone ?? ""));
  const save = () => {
    setMessage("");
    update.mutate(
      {
        userId: user.id,
        data: {
          role,
          ...(needsStore ? { storeId } : {}),
          ...(needsCourier
            ? {
                name: name.trim(),
                phone: phone.trim() || null,
                storeId: storeId || null,
                courierId: courierId || null,
              }
            : {}),
        },
      },
      {
        onSuccess: async () => {
          setMessage("Acesso atualizado.");
          await queryClient.invalidateQueries({
            queryKey: getListAccessUsersQueryKey(),
          });
          await queryClient.invalidateQueries({
            queryKey: getListCouriersQueryKey(),
          });
        },
        onError: (error) => {
          const apiError = error as Error & { data?: { error?: string } };
          setMessage(
            apiError.data?.error ??
              (error instanceof Error
                ? error.message
                : "Não foi possível salvar. Confira os dados informados."),
          );
        },
      },
    );
  };
  const removeAccount = () => {
    if (isCurrentUser || isLastAdmin || hasActiveWork) return;
    const loginNote = user.clerkUserId
      ? "O login também será excluído."
      : "Não há um login vinculado a este cadastro.";
    const confirmed = window.confirm(
      `Excluir o cadastro de ${user.email}?\n\n${loginNote} O histórico de entregas será mantido. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setMessage("");
    deleteAccount.mutate(
      { userId: user.id },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: getListAccessUsersQueryKey(),
          });
          await queryClient.invalidateQueries({
            queryKey: getListCouriersQueryKey(),
          });
        },
        onError: (error) => {
          const apiError = error as Error & { data?: { error?: string } };
          setMessage(
            apiError.data?.error ??
              (error instanceof Error ? error.message : "Não foi possível excluir a conta."),
          );
        },
      },
    );
  };
  const deleteDisabled = isCurrentUser || isLastAdmin || hasActiveWork || deleteAccount.isPending;
  const deleteTitle = isCurrentUser
    ? "Não é possível excluir a própria conta"
    : isLastAdmin
      ? "O último administrador não pode ser excluído"
      : hasActiveWork
        ? "Conclua ou cancele o trabalho ativo do motoboy"
        : "Excluir cadastro e login";
  const storeSelect = (
    <select
      className="filter-select w-full"
      aria-label={`Filial de ${user.email}`}
      value={storeId}
      onChange={(event) => setStoreId(event.target.value)}
    >
      <option value="">
        {needsCourier ? "Sem filial vinculada" : "Selecione a filial"}
      </option>
      {stores.filter((store) => store.active).map((store) => (
        <option key={store.id} value={store.id}>{store.name} · {store.city}</option>
      ))}
    </select>
  );
  const courierSelect = (
    <select
      className="filter-select w-full"
      aria-label={`Cadastro de motoboy de ${user.email}`}
      value={courierId}
      onChange={(event) => {
        const selectedId = event.target.value;
        const selectedCourier = couriers.find((courier) => courier.id === selectedId);
        setCourierId(selectedId);
        setName(selectedCourier?.name ?? "");
        setPhone(selectedCourier?.phone ?? "");
      }}
    >
      <option value="">Criar novo cadastro de motoboy</option>
      {couriers.map((courier) => (
        <option key={courier.id} value={courier.id}>{courier.name}</option>
      ))}
    </select>
  );

  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_180px_minmax(240px,1.1fr)_minmax(280px,1.3fr)_auto] xl:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{user.name}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{user.email}</div>
      </div>
      <select
        className="filter-select w-full"
        aria-label={`Perfil de ${user.name}`}
        value={role}
        onChange={(event) => setRole(event.target.value as AppUser["role"])}
        disabled={user.role === "ADMIN" && user.clerkUserId === null}
      >
        {roles.map((item) => (
          <option key={item.value} value={item.value}>{item.label}</option>
        ))}
      </select>
      {needsCourier ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="filter-select w-full"
            aria-label={`Nome do motoboy ${user.email}`}
            placeholder="Nome completo *"
            value={name}
            maxLength={120}
            required
            aria-invalid={!name.trim()}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="filter-select w-full"
            type="tel"
            inputMode="tel"
            aria-label={`Telefone do motoboy ${user.email}`}
            placeholder="Telefone"
            value={phone}
            maxLength={40}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      ) : needsStore ? (
        storeSelect
      ) : (
        <span className="text-xs text-muted-foreground">Sem vínculo adicional</span>
      )}
      {needsCourier ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {storeSelect}
          {courierSelect}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
        {message && (
          <span className={`text-[11px] ${message.startsWith("Acesso") ? "text-green-700" : "text-red-700"}`}>
            {message}
          </span>
        )}
        <button
          className="button-secondary"
          type="button"
          onClick={save}
          disabled={
            !isChanged ||
            update.isPending ||
            (needsStore && !storeId) ||
            (needsCourier && !name.trim())
          }
        >
          <Check size={14} />
          {update.isPending ? "Salvando…" : "Salvar"}
        </button>
        <button
          className="button-secondary button-red-outline"
          type="button"
          onClick={removeAccount}
          disabled={deleteDisabled}
          title={deleteTitle}
          aria-label={`Excluir cadastro e login de ${user.email}`}
        >
          <Trash2 size={14} />
          {deleteAccount.isPending ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    </div>
  );
}
