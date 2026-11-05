import "./_group.css";
import { useState } from "react";
import {
  ArrowRight,
  Bike,
  Bell,
  BellOff,
  ChevronDown,
  Clock3,
  KeyRound,
  LocateFixed,
  LogOut,
  Map,
  MapPin,
  Menu,
  PackageCheck,
  Route,
  X,
} from "lucide-react";

type Period = "Hoje" | "Esta semana" | "Este mês";
type WorkItem = {
  id: string;
  kind: "route" | "delivery";
  priority: number;
  state: string;
  title: string;
  detail: string;
  amount: string;
};

const workItems: WorkItem[] = [];
const earnings: Record<Period, { deliveries: string; total: string; caption: string }> = {
  Hoje: { deliveries: "4 entregas", total: "R$ 32,00", caption: "Concluídas hoje" },
  "Esta semana": { deliveries: "18 entregas", total: "R$ 146,50", caption: "Concluídas nesta semana" },
  "Este mês": { deliveries: "61 entregas", total: "R$ 518,00", caption: "Concluídas neste mês" },
};

export function Simplified() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("Hoje");
  const [gpsOpen, setGpsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsActive, setNotificationsActive] = useState(true);
  const [gpsAge, setGpsAge] = useState(8);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [signOutPrompt, setSignOutPrompt] = useState(false);
  const [mapNotice, setMapNotice] = useState(false);

  const alertText = !notificationsActive
    ? "Avisos de novas entregas desativados neste aparelho."
    : gpsAge > 60
      ? "Sua localização não é atualizada há mais de um minuto."
      : "";

  function resolveAlert() {
    if (!notificationsActive) setNotificationsActive(true);
    else setGpsAge(8);
  }

  return (
    <main className="courier-simple">
      <div className="courier-simple-shell">
        <header className="courier-simple-top">
          <button
            className="courier-icon-button"
            type="button"
            aria-label="Abrir menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="courier-header-greeting">Olá, Ana</div>
          <div className="courier-status-actions">
            <button
              type="button"
              className={`courier-status-button ${gpsAge > 60 ? "is-warning" : ""}`}
              aria-label="Ver detalhes do GPS"
              aria-expanded={gpsOpen}
              onClick={() => { setGpsOpen(!gpsOpen); setNotificationsOpen(false); }}
            >
              <LocateFixed size={19} />
              <span className="courier-status-dot" />
            </button>
            <button
              type="button"
              className={`courier-status-button ${notificationsActive ? "" : "is-warning"}`}
              aria-label="Ver detalhes das notificações"
              aria-expanded={notificationsOpen}
              onClick={() => { setNotificationsOpen(!notificationsOpen); setGpsOpen(false); }}
            >
              {notificationsActive ? <Bell size={19} /> : <BellOff size={19} />}
              <span className="courier-status-dot" />
            </button>
          </div>
          {gpsOpen && (
            <aside className="courier-popover courier-gps-popover" role="status">
              <div className="courier-popover-heading"><LocateFixed size={16} /> Localização</div>
              <p>GPS ativo · última atualização há {gpsAge} s</p>
              <span>Precisão aproximada: 14 m</span>
              <button type="button" onClick={() => setGpsAge(8)}>Atualizar agora <ArrowRight size={14} /></button>
            </aside>
          )}
          {notificationsOpen && (
            <aside className="courier-popover courier-notification-popover" role="status">
              <div className="courier-popover-heading">
                {notificationsActive ? <Bell size={16} /> : <BellOff size={16} />}
                Avisos de entregas
              </div>
              <p>{notificationsActive ? "Ativados neste aparelho." : "Desativados neste aparelho."}</p>
              <button type="button" onClick={() => setNotificationsActive(!notificationsActive)}>
                {notificationsActive ? "Desativar avisos" : "Ativar avisos"} <ArrowRight size={14} />
              </button>
            </aside>
          )}
        </header>

        <nav className="courier-tabs" aria-label="Seções">
          <button className="courier-tab is-current" type="button" aria-current="page">
            <PackageCheck size={17} /> Entregas
          </button>
          <button
            className="courier-tab"
            type="button"
            onClick={() => setMapNotice(!mapNotice)}
          >
            <Map size={17} /> Mapa e rota
          </button>
        </nav>

        {alertText && (
          <div className="courier-alert-strip" role="status">
            <span className="courier-alert-mark"><BellOff size={16} /></span>
            <span>{alertText}</span>
            <button type="button" onClick={resolveAlert}>Resolver</button>
          </div>
        )}

        {mapNotice && (
          <div className="courier-map-note" role="status">
            <MapPin size={16} /> O mapa da rota aparece aqui quando uma entrega estiver em andamento.
            <button type="button" aria-label="Fechar aviso" onClick={() => setMapNotice(false)}><X size={16} /></button>
          </div>
        )}

        <section className="courier-work-section" aria-label="Entregas disponíveis">
          <div className="courier-section-heading">
            <div>
              <span className="courier-overline">SUA PRÓXIMA PARADA</span>
              <h1>Entregas</h1>
            </div>
            {workItems.length > 0 && (
              <span className="courier-work-count">{workItems.length} na fila</span>
            )}
          </div>

          {workItems.length ? (
            <div className="courier-work-list">
              {[...workItems].sort((a, b) => a.priority - b.priority).map((item) => (
                <article className={`courier-work-card ${item.state === "Em andamento" ? "is-active" : ""}`} key={item.id}>
                  <div className="courier-work-icon">
                    {item.kind === "route" ? <Route size={19} /> : <PackageCheck size={19} />}
                  </div>
                  <div className="courier-work-main">
                    <div className="courier-work-label">
                      <span>{item.kind === "route" ? "ROTA AGRUPADA" : "ENTREGA"}</span>
                      <span className="courier-work-state"><i />{item.state}</span>
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.detail}</p>
                    <div className="courier-work-bottom">
                      <span>{item.amount}</span>
                      <button type="button" onClick={() => setMapNotice(true)}>Ver detalhes <ArrowRight size={15} /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="courier-available-card">
              <div className="courier-available-orbit">
                <span className="courier-available-icon"><Bike size={24} /></span>
                <i className="courier-orbit-dot dot-one" />
                <i className="courier-orbit-dot dot-two" />
              </div>
              <div className="courier-available-copy">
                <span className="courier-available-status"><i /> DISPONÍVEL</span>
                <h2>Você está disponível</h2>
                <p>Aguardando novas entregas</p>
              </div>
              <Clock3 className="courier-available-clock" size={17} />
            </div>
          )}
        </section>

        <section className={`courier-earnings ${earningsOpen ? "is-open" : ""}`}>
          <button
            className="courier-earnings-summary"
            type="button"
            aria-expanded={earningsOpen}
            onClick={() => setEarningsOpen(!earningsOpen)}
          >
            <span className="courier-earnings-icon"><span>R$</span></span>
            <span className="courier-earnings-copy">
              <span className="courier-earnings-title">Seus ganhos</span>
              <span className="courier-earnings-line">{earnings.Hoje.deliveries} <i /> {earnings.Hoje.total}</span>
            </span>
            <span className={`courier-earnings-chevron ${earningsOpen ? "is-open" : ""}`}><ChevronDown size={18} /></span>
          </button>
          {earningsOpen && (
            <div className="courier-earnings-details">
              <div className="courier-periods" role="tablist" aria-label="Período dos ganhos">
                {(["Hoje", "Esta semana", "Este mês"] as Period[]).map((item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={period === item}
                    className={period === item ? "is-selected" : ""}
                    key={item}
                    onClick={() => setPeriod(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="courier-earnings-total">
                <div><span>{earnings[period].caption}</span><strong>{earnings[period].deliveries}</strong></div>
                <div><span>Total a receber</span><strong>{earnings[period].total}</strong></div>
              </div>
            </div>
          )}
        </section>

        <div className="courier-footer-space" />
      </div>

      {menuOpen && (
        <div className="courier-drawer-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}>
          <aside className="courier-drawer" aria-label="Menu da conta">
            <div className="courier-drawer-top">
              <div className="courier-drawer-brand">
                <span className="courier-brand-mark"><Bike size={18} /></span>
                <div><strong>Minas Mais</strong><span>Área do motoboy</span></div>
              </div>
              <button type="button" className="courier-icon-button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="courier-drawer-profile">
              <span className="courier-profile-initials">A</span>
              <div><strong>Ana</strong><span>Entregadora</span></div>
            </div>
            <div className="courier-drawer-options">
              <button type="button" className="courier-drawer-option" onClick={() => { setPasswordOpen(!passwordOpen); setPasswordMessage(""); }}>
                <span className="courier-option-icon"><KeyRound size={18} /></span>
                <span>Alterar senha</span>
                <ChevronDown className={passwordOpen ? "is-turned" : ""} size={17} />
              </button>
              {passwordOpen && (
                <form className="courier-password-form" onSubmit={(event) => {
                  event.preventDefault();
                  setPasswordMessage("Solicitação de alteração registrada.");
                }}>
                  <label>Senha atual<input type="password" required minLength={4} placeholder="Digite sua senha" /></label>
                  <label>Nova senha<input type="password" required minLength={4} placeholder="Pelo menos 4 caracteres" /></label>
                  <button type="submit">Salvar nova senha</button>
                  {passwordMessage && <span role="status">{passwordMessage}</span>}
                </form>
              )}
              <button type="button" className="courier-drawer-option" onClick={() => setNotificationsActive(!notificationsActive)}>
                <span className="courier-option-icon">{notificationsActive ? <Bell size={18} /> : <BellOff size={18} />}</span>
                <span>{notificationsActive ? "Desativar notificações" : "Ativar notificações"}</span>
                <span className={`courier-toggle ${notificationsActive ? "is-on" : ""}`}><i /></span>
              </button>
            </div>
            <div className="courier-drawer-bottom">
              {signOutPrompt ? (
                <div className="courier-signout-confirm">
                  <p>Deseja sair da sua conta?</p>
                  <div>
                    <button type="button" onClick={() => setSignOutPrompt(false)}>Cancelar</button>
                    <button type="button" onClick={() => { setSignOutPrompt(false); setMenuOpen(false); }}>Sair</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="courier-signout-button" onClick={() => setSignOutPrompt(true)}>
                  <LogOut size={17} /> Sair da conta
                </button>
              )}
              <p>Minas Mais Entregas <span>·</span> versão 1.0</p>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
