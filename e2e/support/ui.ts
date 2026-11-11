import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { credentials } from "./auth.ts";
import type { RoleKey } from "./fixtures-data.ts";

/** Entra pelo formulário real de login (e-mail + senha do Supabase) e vai para `path`. */
export async function loginAs(page: Page, role: RoleKey, path?: string) {
  const { email, password } = credentials()[role];
  await page.goto("/sign-in");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });
  if (path) await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Coleta erros de console/página durante o teste. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  // Push sem VAPID/Firebase no ambiente local responde 503 de propósito: não é falha da tela.
  const expected503 = /\/api\/push\//;
  page.on("response", (res) => {
    if (res.status() >= 500 && !expected503.test(res.url())) errors.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Ruído de ambiente (telemetria do mapa, favicon, rede desligada de propósito, recurso já contado acima).
    if (/favicon|ERR_INTERNET_DISCONNECTED|mapsjs\/gen_204|Failed to load resource/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

/** Acessibilidade: nenhuma violação crítica/séria do axe (WCAG 2.x A/AA). */
export async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".gm-style")
    .analyze();
  const serious = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const report = serious
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ex.: ${v.nodes[0]?.target.join(" ")}`)
    .join("\n");
  expect(serious, `${label}\n${report}`).toEqual([]);
}

/** A página não pode rolar na horizontal (layout quebrado no celular). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "largura do conteúdo maior que a tela").toBeLessThanOrEqual(1);
}
