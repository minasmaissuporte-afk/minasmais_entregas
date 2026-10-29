import { useQueryClient } from "@tanstack/react-query";
import {
  getListAccessUsersQueryKey,
  useListAccessUsers,
  useListCouriers,
  useListStores,
  useUpdateAccessUser,
  type AppUser,
} from "@workspace/api-client-react";
import { Check, ShieldCheck, UsersRound } from "lucide-react";
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
  const users = useListAccessUsers();
  const stores = useListStores();
  const couriers = useListCouriers();

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
}: {
  user: AppUser;
  stores: { id: string; name: string; city: string; active: boolean }[];
  couriers: { id: string; name: string; status: string }[];
}) {
  const queryClient = useQueryClient();
  const update = useUpdateAccessUser();
  const [role, setRole] = useState<AppUser["role"]>(user.role);
  const [storeId, setStoreId] = useState(user.storeId ?? "");
  const [courierId, setCourierId] = useState(user.courierId ?? "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setRole(user.role);
    setStoreId(user.storeId ?? "");
    setCourierId(user.courierId ?? "");
  }, [user.role, user.storeId, user.courierId]);

  const needsStore = role === "STORE_MANAGER" || role === "STORE_STAFF";
  const needsCourier = role === "COURIER";
  const isChanged =
    role !== user.role ||
    storeId !== (user.storeId ?? "") ||
    courierId !== (user.courierId ?? "");
  const save = () => {
    setMessage("");
    update.mutate(
      {
        userId: user.id,
        data: {
          role,
          ...(needsStore ? { storeId } : {}),
          ...(needsCourier ? { courierId } : {}),
        },
      },
      {
        onSuccess: async () => {
          setMessage("Acesso atualizado.");
          await queryClient.invalidateQueries({
            queryKey: getListAccessUsersQueryKey(),
          });
        },
        onError: () => setMessage("Não foi possível salvar. Confira o vínculo escolhido."),
      },
    );
  };

  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(180px,1fr)_220px_220px_auto] lg:items-center">
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
      {needsStore ? (
        <select
          className="filter-select w-full"
          aria-label={`Unidade de ${user.name}`}
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
        >
          <option value="">Selecione a unidade</option>
          {stores.filter((store) => store.active).map((store) => (
            <option key={store.id} value={store.id}>{store.name} · {store.city}</option>
          ))}
        </select>
      ) : needsCourier ? (
        <select
          className="filter-select w-full"
          aria-label={`Cadastro de motoboy de ${user.name}`}
          value={courierId}
          onChange={(event) => setCourierId(event.target.value)}
        >
          <option value="">Selecione o motoboy</option>
          {couriers.map((courier) => (
            <option key={courier.id} value={courier.id}>{courier.name}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-muted-foreground">Sem vínculo de unidade</span>
      )}
      <div className="flex items-center justify-between gap-3 lg:justify-end">
        {message && (
          <span className={`text-[11px] ${message.startsWith("Acesso") ? "text-green-700" : "text-red-700"}`}>
            {message}
          </span>
        )}
        <button
          className="button-secondary"
          type="button"
          onClick={save}
          disabled={!isChanged || update.isPending || (needsStore && !storeId) || (needsCourier && !courierId)}
        >
          <Check size={14} />
          {update.isPending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
