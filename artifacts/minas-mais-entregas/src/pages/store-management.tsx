import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getListCouriersQueryKey,
  getListCourierRoutesQueryKey,
  getListDeliveriesQueryKey,
  getListStoresQueryKey,
  useCleanupDemoData,
  useCreateStore,
  useDeleteStore,
  useListStores,
  useUpdateStore,
  type AddressSuggestion,
  type Store,
  type StoreInput,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Check,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Store as StoreIcon,
  Trash2,
  X,
} from "lucide-react";
import AddressAutocomplete from "@/components/address-autocomplete";
import LiveMap, { type MapMarker } from "@/components/live-map";

type BranchForm = Omit<StoreInput, "latitude" | "longitude"> & {
  latitude: number | null;
  longitude: number | null;
};
type TextField = Exclude<keyof BranchForm, "latitude" | "longitude">;

const emptyForm = (): BranchForm => ({
  name: "",
  address: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  stateCode: "",
  postalCode: "",
  phone: "",
  managerName: "",
  managerPhone: "",
  assistantManagerName: "",
  assistantManagerPhone: "",
  latitude: null,
  longitude: null,
  deliveryFee: 0,
});

function errorMessage(error: unknown, fallback: string) {
  const apiError = error as Error & { data?: { error?: string } };
  return apiError.data?.error ?? (error instanceof Error ? error.message : fallback);
}

function displayAddress(store: Store) {
  return [store.street, store.number, store.complement, store.neighborhood, store.city, store.stateCode]
    .filter(Boolean)
    .join(", ") || store.address;
}

export default function StoreManagement() {
  const qc = useQueryClient();
  const stores = useListStores();
  const createStore = useCreateStore();
  const updateStore = useUpdateStore();
  const deleteStore = useDeleteStore();
  const cleanupDemoData = useCleanupDemoData();
  const [searchText, setSearchText] = useState("");
  const [form, setForm] = useState<BranchForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const visibleStores = useMemo(() => {
    const term = searchText.trim().toLocaleLowerCase("pt-BR");
    if (!term) return stores.data ?? [];
    return (stores.data ?? []).filter((store) =>
      [store.name, store.code, store.city, store.address, store.stateCode]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [searchText, stores.data]);

  const invalidateDirectory = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListStoresQueryKey() }),
      qc.invalidateQueries({ queryKey: getListDeliveriesQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      qc.invalidateQueries({ queryKey: getListCouriersQueryKey() }),
      qc.invalidateQueries({ queryKey: getListCourierRoutesQueryKey() }),
    ]);
  };

  const beginCreate = () => {
    setFeedback(null);
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const beginEdit = (store: Store) => {
    setFeedback(null);
    setEditingId(store.id);
    setForm({
      name: store.name,
      address: store.address,
      street: store.street ?? "",
      number: store.number ?? "",
      complement: store.complement ?? "",
      neighborhood: store.neighborhood ?? "",
      city: store.city,
      stateCode: store.stateCode ?? "",
      postalCode: store.postalCode ?? "",
      phone: store.phone ?? "",
      managerName: store.managerName ?? "",
      managerPhone: store.managerPhone ?? "",
      assistantManagerName: store.assistantManagerName ?? "",
      assistantManagerPhone: store.assistantManagerPhone ?? "",
      latitude: store.latitude,
      longitude: store.longitude,
      deliveryFee: store.deliveryFee,
    });
    setFormOpen(true);
  };

  const updateField = (key: TextField, value: string) => {
    setForm((current) => ({ ...current, [key]: key === "deliveryFee" ? Number(value) : value }));
  };

  const selectAddress = (suggestion: AddressSuggestion) => {
    setForm((current) => ({
      ...current,
      address: suggestion.formatted,
      street: suggestion.street ?? "",
      number: suggestion.houseNumber ?? "",
      neighborhood: suggestion.suburb ?? suggestion.district ?? "",
      city: suggestion.city ?? "",
      stateCode: suggestion.stateCode ?? "",
      postalCode: suggestion.postcode ?? "",
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
    }));
    if (!suggestion.houseNumber) {
      window.requestAnimationFrame(() => {
        document.getElementById("branch-number")?.focus();
      });
    }
  };

  const branchMarkers: MapMarker[] =
    form.latitude != null && form.longitude != null
      ? [
          {
            id: editingId ?? "new-branch",
            latitude: form.latitude,
            longitude: form.longitude,
            title: form.name.trim() || "Nova filial",
            detail: form.address,
            kind: "store",
            draggable: true,
            onDrag: ({ latitude, longitude }) =>
              setForm((current) => ({ ...current, latitude, longitude })),
          },
        ]
      : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    const latitude = form.latitude;
    const longitude = form.longitude;
    if (latitude == null || longitude == null) {
      setFeedback({
        kind: "error",
        text: "Selecione um endereço sugerido para definir o pino e as coordenadas da filial.",
      });
      return;
    }
    if (!form.number.trim()) {
      setFeedback({
        kind: "error",
        text: "Informe o número do endereço. Se não houver, digite “s/n”.",
      });
      document.getElementById("branch-number")?.focus();
      return;
    }

    const address = [
      form.street,
      form.number,
      form.complement,
      form.neighborhood,
      form.city,
      form.stateCode,
      form.postalCode,
    ]
      .map((part) => part?.trim() ?? "")
      .filter(Boolean)
      .join(", ");
    const payload: StoreInput = { ...form, address, latitude, longitude };
    const callbacks = {
      onSuccess: async () => {
        await invalidateDirectory();
        setFeedback({
          kind: "success",
          text: editingId ? "Filial atualizada." : "Filial cadastrada.",
        });
        setFormOpen(false);
        setEditingId(null);
        setForm(emptyForm());
      },
      onError: (error: unknown) =>
        setFeedback({
          kind: "error",
          text: errorMessage(error, "Não foi possível salvar a filial."),
        }),
    };

    if (editingId) {
      updateStore.mutate({ storeId: editingId, data: payload }, callbacks);
    } else {
      createStore.mutate({ data: payload }, callbacks);
    }
  };

  const removeStore = (store: Store) => {
    if (store.deliveryCount > 0) return;
    if (
      !window.confirm(
        `Excluir a filial “${store.name}”? Essa ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setFeedback(null);
    deleteStore.mutate(
      { storeId: store.id },
      {
        onSuccess: async () => {
          await invalidateDirectory();
          setFeedback({ kind: "success", text: `Filial “${store.name}” excluída.` });
        },
        onError: (error) =>
          setFeedback({
            kind: "error",
            text: errorMessage(error, "Não foi possível excluir a filial."),
          }),
      },
    );
  };

  const removeDemoRecords = () => {
    const confirmed = window.confirm(
      "Remover somente os registros de demonstração conhecidos (entregas, motoboys e filiais)? Contas de login e registros ligados a rotas ou contas serão preservados.",
    );
    if (!confirmed) return;
    setFeedback(null);
    cleanupDemoData.mutate(
      { data: { confirmation: "REMOVE_DEMO_RECORDS" } },
      {
        onSuccess: async (result) => {
          await invalidateDirectory();
          setFeedback({
            kind: "success",
            text: `Limpeza concluída: ${result.removedDeliveries} entregas, ${result.removedCouriers} motoboys e ${result.removedStores} filiais removidos. ${result.preservedLinkedCouriers} motoboys e ${result.preservedLinkedStores} filiais vinculados a contas foram preservados; ${result.preservedDeliveries} entregas em rotas foram mantidas.`,
          });
        },
        onError: (error) =>
          setFeedback({
            kind: "error",
            text: errorMessage(error, "Não foi possível limpar os dados de demonstração."),
          }),
      },
    );
  };

  const saving = createStore.isPending || updateStore.isPending;

  return (
    <div className="soft-enter">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow">ADMINISTRAÇÃO</div>
          <h1 className="mt-2 text-[28px] font-bold tracking-[-.045em] sm:text-[34px]">
            Filiais
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cadastre endereços, contatos e responsáveis. As coordenadas são usadas
            nos mapas e no roteamento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="button-secondary h-10"
            type="button"
            onClick={removeDemoRecords}
            disabled={cleanupDemoData.isPending}
          >
            <Trash2 size={15} />
            {cleanupDemoData.isPending ? "Limpando…" : "Limpar dados de demonstração"}
          </button>
          <button className="button-primary h-10" type="button" onClick={beginCreate}>
            <Plus size={16} />
            Nova filial
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          {feedback.kind === "error" ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Check size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {formOpen && (
        <section className="panel mb-6 p-4 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{editingId ? "EDITAR CADASTRO" : "NOVA FILIAL"}</div>
              <h2 className="mt-1 text-lg font-bold">
                {editingId ? "Atualizar filial" : "Cadastrar filial"}
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Fechar formulário"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              <X size={17} />
            </button>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label sm:col-span-2">
                Nome da filial
                <input
                  required
                  minLength={2}
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Ex.: Minas Mais Centro"
                />
              </label>
              <label className="field-label sm:col-span-2">
                Tarifa individual por entrega (R$)
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.deliveryFee}
                  onChange={(event) => updateField("deliveryFee", event.target.value)}
                  placeholder="0,00"
                  data-testid="input-branch-delivery-fee"
                />
                <span className="text-[10px] font-normal text-muted-foreground">Esta tarifa será aplicada automaticamente a cada nova entrega desta unidade.</span>
              </label>
              <label className="field-label sm:col-span-2">
                Endereço
                <AddressAutocomplete
                  id="branch-address"
                  required
                  value={form.address}
                  placeholder="Digite rua, bairro ou CEP"
                  inputClassName="w-full pr-9"
                  dataTestId="input-branch-address"
                  onChange={(address) =>
                    setForm((current) => ({
                      ...current,
                      address,
                      latitude: null,
                      longitude: null,
                    }))
                  }
                  onSelect={selectAddress}
                />
              </label>
              <label className="field-label">
                Rua ou avenida
                <input
                  required
                  value={form.street}
                  onChange={(event) => updateField("street", event.target.value)}
                  placeholder="Nome da via"
                />
              </label>
              <label className="field-label">
                Número
                <input
                  id="branch-number"
                  required
                  value={form.number}
                  onChange={(event) => updateField("number", event.target.value)}
                  placeholder="Número ou s/n"
                />
              </label>
              <label className="field-label">
                Complemento
                <input
                  value={form.complement}
                  onChange={(event) => updateField("complement", event.target.value)}
                  placeholder="Sala, loja, bloco"
                />
              </label>
              <label className="field-label">
                Bairro
                <input
                  value={form.neighborhood}
                  onChange={(event) => updateField("neighborhood", event.target.value)}
                  placeholder="Bairro"
                />
              </label>
              <label className="field-label">
                Cidade
                <input
                  required
                  minLength={2}
                  value={form.city}
                  onChange={(event) => updateField("city", event.target.value)}
                  placeholder="Cidade"
                />
              </label>
              <label className="field-label">
                UF
                <input
                  required
                  minLength={2}
                  maxLength={2}
                  value={form.stateCode}
                  onChange={(event) => updateField("stateCode", event.target.value.toUpperCase())}
                  placeholder="MG"
                />
              </label>
              <label className="field-label">
                CEP
                <input
                  value={form.postalCode}
                  onChange={(event) => updateField("postalCode", event.target.value)}
                  placeholder="00000-000"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label">
                Telefone da filial
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  placeholder="(31) 0000-0000"
                />
              </label>
              <label className="field-label">
                Nome do gerente
                <input
                  required
                  minLength={2}
                  value={form.managerName}
                  onChange={(event) => updateField("managerName", event.target.value)}
                  placeholder="Nome completo"
                />
              </label>
              <label className="field-label">
                Telefone do gerente
                <input
                  type="tel"
                  value={form.managerPhone}
                  onChange={(event) => updateField("managerPhone", event.target.value)}
                  placeholder="(31) 99999-0000"
                />
              </label>
              <label className="field-label">
                Nome do subgerente
                <input
                  value={form.assistantManagerName}
                  onChange={(event) => updateField("assistantManagerName", event.target.value)}
                  placeholder="Opcional"
                />
              </label>
              <label className="field-label">
                Telefone do subgerente
                <input
                  type="tel"
                  value={form.assistantManagerPhone}
                  onChange={(event) =>
                    updateField("assistantManagerPhone", event.target.value)
                  }
                  placeholder="Opcional"
                />
              </label>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="eyebrow">LOCALIZAÇÃO DA FILIAL</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Arraste o pino verde para ajustar a posição. Coordenadas ocultas.
                  </p>
                </div>
                <MapPin size={17} className="text-[#16804a]" />
              </div>
              {branchMarkers.length ? (
                <LiveMap
                  markers={branchMarkers}
                  ariaLabel="Mapa para ajustar a localização da filial"
                  size="compact"
                />
              ) : (
                <div className="grid h-48 place-items-center bg-[#f3f2ef] px-5 text-center text-sm text-muted-foreground">
                  Selecione um endereço sugerido para posicionar o pino.
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <button
                className="button-secondary"
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditingId(null);
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                className="button-primary"
                type="submit"
                disabled={saving || form.latitude == null || form.longitude == null}
              >
                <Check size={16} />
                {saving ? "Salvando…" : editingId ? "Salvar alterações" : "Cadastrar filial"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <span className="metric-icon metric-icon-red">
              <StoreIcon size={17} />
            </span>
            <div>
              <h2 className="text-sm font-bold">Filiais cadastradas</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stores.data?.length ?? 0} filiais
              </p>
            </div>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Buscar filial</span>
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="w-full pl-9"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar por filial, cidade ou endereço"
            />
          </label>
        </div>

        {stores.isLoading ? (
          <div className="space-y-3 p-5">
            <div className="skeleton h-20 w-full" />
            <div className="skeleton h-20 w-full" />
          </div>
        ) : stores.isError ? (
          <div className="p-5 text-sm text-red-700">
            Não foi possível carregar as filiais.
            <button
              className="ml-2 inline-flex items-center gap-1 font-semibold"
              type="button"
              onClick={() => void stores.refetch()}
            >
              <RefreshCw size={13} /> Tentar novamente
            </button>
          </div>
        ) : visibleStores.length ? (
          <ul className="divide-y divide-border">
            {visibleStores.map((store) => (
              <li
                key={store.id}
                className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{store.name}</h3>
                    <span className="rounded-md bg-[#f5f4f2] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {store.code}
                    </span>
                    <span className="rounded-md bg-[#f9eded] px-2 py-0.5 text-[10px] font-semibold text-[#a91d2a]">
                      {store.deliveryFee.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / entrega
                    </span>
                  </div>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin size={13} className="mt-0.5 shrink-0" />
                    <span>{displayAddress(store)}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gerente: {store.managerName || "Não informado"}
                    {store.phone ? ` · Filial: ${store.phone}` : ""}
                    {store.managerPhone ? ` · Gerente: ${store.managerPhone}` : ""}
                  </p>
                  {store.deliveryCount > 0 && (
                    <p className="mt-1 text-[11px] text-amber-800">
                      {store.deliveryCount} entrega(s) vinculada(s); exclua ou mova
                      as entregas antes de remover a filial.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="button-secondary h-9"
                    type="button"
                    onClick={() => beginEdit(store)}
                  >
                    <Pencil size={14} />
                    Editar
                  </button>
                  <button
                    className="button-quiet h-9 text-red-700"
                    type="button"
                    disabled={store.deliveryCount > 0 || deleteStore.isPending}
                    title={
                      store.deliveryCount > 0
                        ? "A filial possui entregas vinculadas"
                        : "Excluir filial"
                    }
                    onClick={() => removeStore(store)}
                  >
                    <Trash2 size={14} />
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : stores.data?.length ? (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">Nenhuma filial encontrada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tente outro nome, cidade ou endereço.
            </p>
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#f7eeee] text-primary">
              <StoreIcon size={20} />
            </span>
            <h3 className="mt-3 font-semibold">Nenhuma filial cadastrada</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Cadastre a primeira filial para começar a registrar entregas com
              endereço e localização corretos.
            </p>
            <button className="button-primary mt-4" type="button" onClick={beginCreate}>
              <Plus size={15} />
              Cadastrar primeira filial
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
