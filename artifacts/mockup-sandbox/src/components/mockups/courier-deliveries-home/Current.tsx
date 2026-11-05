import "./_group.css";
import {
  Bike,
  Bell,
  CheckCircle2,
  Clock3,
  Map,
  MapPin,
  PackageCheck,
  RefreshCw,
} from "lucide-react";

export function Current() {
  return (
    <main className="courier-baseline min-h-screen px-4 pb-8 pt-4 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="courier-baseline-panel flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl rounded-bl-sm bg-[#b91e2c] text-white">
              <Bike size={18} />
            </span>
            <div>
              <div className="text-sm font-bold">Minas Mais</div>
              <div className="text-[11px] text-[#777a80]">Área do motoboy</div>
            </div>
          </div>
          <div className="flex gap-1">
            <button className="rounded-lg border border-[#dfdedb] bg-white px-2 text-[11px] font-bold text-[#42464d]">
              Alterar senha
            </button>
            <button className="rounded-lg px-2 text-[11px] font-bold text-[#65676c]">
              Sair
            </button>
          </div>
        </header>

        <nav className="courier-baseline-panel mt-4 grid h-14 grid-cols-2 gap-1 p-1" aria-label="Abas">
          <button className="rounded-lg bg-[#f9eded] text-sm font-bold text-[#a91d2a]">
            <PackageCheck className="mr-2 inline" size={16} /> Entregas
          </button>
          <button className="rounded-lg text-sm font-semibold text-[#65676c]">
            <Map className="mr-2 inline" size={16} /> Mapa e rota
          </button>
        </nav>

        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
          <MapPin className="mr-1 inline" size={14} />
          <strong>GPS ativo · último envio há 8 s</strong>
          <span className="ml-2">Precisão 14 m</span>
          <span className="mt-1 block">O GPS é enviado a cada 15 segundos enquanto o PWA estiver aberto.</span>
        </div>

        <section className="mt-6 space-y-4" aria-label="Rotas do motoboy">
          <div className="flex items-end justify-between">
            <div>
              <div className="courier-baseline-eyebrow">ROTAS AGRUPADAS</div>
              <h2 className="mt-1 text-lg font-bold">Rotas e sequência de paradas</h2>
            </div>
            <button className="rounded-lg px-2 text-xs font-bold text-[#65676c]">
              <RefreshCw className="mr-1 inline" size={15} /> Atualizar
            </button>
          </div>
          <div className="courier-baseline-panel p-5 text-center">
            <PackageCheck className="mx-auto text-[#777a80]" size={22} />
            <p className="mt-2 text-sm font-semibold">Nenhuma rota agrupada disponível</p>
            <p className="mt-1 text-xs text-[#777a80]">Novas ofertas enviadas pela central aparecerão aqui.</p>
          </div>
        </section>

        <section className="mt-5 rounded-2xl bg-[#a91d2a] p-5 text-white">
          <div className="text-xs text-white/75">Olá, Ana</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Seu resumo de entregas</h1>
          <div className="mt-5 flex gap-2">
            <button className="rounded-full bg-white px-3 text-xs font-bold text-[#a91d2a]">Hoje</button>
            <button className="rounded-full bg-white/15 px-3 text-xs font-semibold text-white">Esta semana</button>
            <button className="rounded-full bg-white/15 px-3 text-xs font-semibold text-white">Este mês</button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/10 p-4">
              <div className="flex items-center gap-2 text-xs text-white/75"><PackageCheck size={15} /> Entregas concluídas</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">4</div>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <div className="flex items-center gap-2 text-xs text-white/75"><CheckCircle2 size={15} /> A receber</div>
              <div className="mt-2 text-2xl font-bold tabular-nums">R$ 32,00</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-white/75">Valores de entregas concluídas hoje.</p>
        </section>

        <section className="courier-baseline-panel mt-4 flex items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f9eded] text-[#b91e2c]"><Bell size={16} /></span>
            <div>
              <h2 className="text-sm font-bold">Avisos de novas entregas</h2>
              <p className="mt-1 text-xs text-[#777a80]">Ative para receber avisos neste aparelho.</p>
            </div>
          </div>
          <button className="rounded-lg bg-[#b91e2c] px-3 text-xs font-bold text-white">Ativar</button>
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="courier-baseline-eyebrow">SUA OPERAÇÃO</div>
              <h2 className="mt-1 text-lg font-bold">Entregas atribuídas</h2>
            </div>
            <span className="text-xs text-[#777a80]">0 registros</span>
          </div>
          <div className="courier-baseline-panel p-6 text-center">
            <Clock3 className="mx-auto text-[#777a80]" size={22} />
            <p className="mt-2 text-sm font-semibold">Nenhuma entrega atribuída</p>
            <p className="mt-1 text-xs text-[#777a80]">
              Ofertas individuais aparecem aqui. Rotas agrupadas ficam na seção acima.
            </p>
          </div>
        </section>
        <footer className="mt-6 text-center text-[11px] text-[#777a80]">
          Valores calculados pelo sistema a partir do valor cadastrado por entrega.
        </footer>
      </div>
    </main>
  );
}
