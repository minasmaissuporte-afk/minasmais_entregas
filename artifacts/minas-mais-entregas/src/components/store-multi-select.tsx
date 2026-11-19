import { useMemo, useState } from "react";

type StoreOption = { id: string; name: string; city: string; active: boolean };

/**
 * Escolha das filiais do Supervisor regional: caixas de seleção agrupadas por cidade,
 * com "marcar a cidade toda". Mostra quantas foram escolhidas.
 */
export default function StoreMultiSelect({
  stores,
  value,
  onChange,
  idPrefix,
  label = "Filiais sob a supervisão",
}: {
  stores: StoreOption[];
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
  label?: string;
}) {
  const [open, setOpen] = useState(value.length === 0);
  const byCity = useMemo(() => {
    const groups = new Map<string, StoreOption[]>();
    for (const store of stores.filter((item) => item.active || value.includes(item.id))) {
      const city = store.city.trim() || "Sem cidade";
      groups.set(city, [...(groups.get(city) ?? []), store]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([city, items]) => [city, items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))] as const);
  }, [stores, value]);
  const selected = new Set(value);
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  const toggleCity = (items: readonly StoreOption[]) => {
    const all = items.every((store) => selected.has(store.id));
    onChange(all ? value.filter((id) => !items.some((store) => store.id === id)) : [...new Set([...value, ...items.map((store) => store.id)])]);
  };
  const summary = value.length
    ? `${value.length} filial(is): ${stores.filter((store) => selected.has(store.id)).map((store) => store.name).join(", ")}`
    : "Nenhuma filial escolhida";

  return (
    <fieldset className="min-w-0 rounded-lg border border-border bg-white p-2.5" data-testid={`${idPrefix}-stores`}>
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</legend>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-xs"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 truncate ${value.length ? "font-semibold text-[#24272d]" : "text-[var(--adm-primary,#b0101f)]"}`} title={summary}>{summary}</span>
        <span className="shrink-0 font-semibold text-[#85434a]">{open ? "Fechar" : "Escolher"}</span>
      </button>
      {open && (
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {byCity.length === 0 && <p className="text-xs text-muted-foreground">Cadastre filiais primeiro.</p>}
          {byCity.map(([city, items]) => {
            const all = items.every((store) => selected.has(store.id));
            return (
              <div key={city}>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-[#4a4d52]">
                  <input type="checkbox" className="!h-4 !min-h-0 !w-4 !p-0" checked={all} onChange={() => toggleCity(items)} />
                  {city} <span className="font-normal text-muted-foreground">(todas)</span>
                </label>
                <div className="mt-1 grid gap-1 pl-6">
                  {items.map((store) => (
                    <label key={store.id} className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-[#2b2e33]">
                      <input
                        type="checkbox"
                        className="!h-4 !min-h-0 !w-4 shrink-0 !p-0"
                        checked={selected.has(store.id)}
                        onChange={() => toggle(store.id)}
                        data-testid={`${idPrefix}-store-${store.id}`}
                      />
                      <span className="truncate">{store.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
