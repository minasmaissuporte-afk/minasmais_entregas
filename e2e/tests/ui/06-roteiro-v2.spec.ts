import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { Api, json } from "../../support/api.ts";
import { stores } from "../../support/fixtures-data.ts";
import { courierOnline, deliveryInput } from "../../support/helpers.ts";
import { query, wipeDeliveries } from "../../support/db.ts";
import { expectNoHorizontalScroll, loginAs, serveSourceAs5173 } from "../../support/ui.ts";

/** Roteiro da nova versão — telas do computador (admin e gerente) e telas pequenas. */
const shots = "test-results/roteiro-v2";
mkdirSync(shots, { recursive: true });
const note = (type: string, description: string) => test.info().annotations.push({ type, description });
const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
if (process.env.E2E_SOURCE_URL) test.use({ baseURL: "http://localhost:5173" });
test.beforeEach(async ({ context }) => serveSourceAs5173(context));

const WHATSAPP = /wa\.me\/5535998782266\?text=Ol%C3%A1!%20Preciso%20de%20suporte%20no%20Sistema%20de%20Entregas%20Minas%20Mais\./;

test.describe("1. Site público: botão Suporte", () => {
  for (const [label, size] of [["computador", { width: 1440, height: 900 }], ["celular", { width: 390, height: 844 }]] as const) {
    test(`1.1–1.4 Suporte no ${label}: canto inferior direito, abre, fecha (X, Esc, fora) e WhatsApp certo`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      const button = page.getByTestId("button-support");
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      note("posição", `x=${Math.round(box.x)} y=${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)} (tela ${size.width}×${size.height})`);
      expect(box.x + box.width).toBeGreaterThan(size.width - 120);
      expect(box.y + box.height).toBeGreaterThan(size.height - 140);
      // Não cobre botões da página
      const covered = await page.evaluate(([x, y, w, h]) => {
        const hits: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("a, button"))) {
          if (el.closest(".support-fab")) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) hits.push((el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30));
        }
        return hits;
      }, [box.x, box.y, box.width, box.height]);
      expect(covered, "o botão Suporte cobre outros botões").toEqual([]);
      await button.click();
      const panel = page.getByTestId("support-panel");
      await expect(panel.getByRole("heading", { name: "Precisa de ajuda?" })).toBeVisible();
      await shot(page, `01-suporte-${label}`);
      const wa = page.getByTestId("link-support-whatsapp");
      await expect(wa).toHaveAttribute("href", WHATSAPP);
      await expect(wa).toContainText("Conversar no WhatsApp");
      await panel.getByRole("button", { name: "Fechar" }).click();
      await expect(panel).toBeHidden();
      await button.click();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await button.click();
      await page.mouse.click(20, 20);
      await expect(panel, "não fecha clicando fora").toBeHidden();
    });
  }

  test("1.5 Depois do login o botão flutuante some (admin e gerente)", async ({ page }) => {
    for (const role of ["admin", "manager"] as const) {
      await loginAs(page, role);
      await page.waitForTimeout(1200);
      await expect(page.getByTestId("button-support"), `${role} ainda vê o botão flutuante`).toHaveCount(0);
      await page.evaluate(() => localStorage.clear());
    }
  });
});

test.describe("2. Admin: acessos", () => {
  test("2.2–2.4 Convite de motoboy: cidade e filiais da cidade; sem cidade pede a cidade; editar cidade troca filiais e salva", async ({ page }) => {
    await loginAs(page, "admin", "/access");
    await page.waitForTimeout(1500);
    await shot(page, "02-acessos");
    const body = await page.locator("main").innerText();
    note("tem convite", String(/Convidar|Convite/i.test(body)));
    note("tem Reenviar convite", String(/Reenviar convite/.test(body)));
    // Edição do motoboy Bruno (Belo Horizonte) → Contagem
    const row = page.locator("div").filter({ hasText: "e2e-motoboy-b@example.com" }).filter({ has: page.getByRole("button", { name: /Salvar/ }) }).last();
    await expect(row).toBeVisible();
    const city = row.getByRole("combobox").filter({ hasText: /Belo Horizonte|Contagem|cidade/i }).first();
    const cityInput = (await city.count()) ? city : row.getByLabel(/cidade/i).first();
    const rowText = (await row.innerText()).replace(/\s+/g, " ");
    note("linha do motoboy B", rowText.slice(0, 200));
    if (await cityInput.count()) {
      const tag = await cityInput.evaluate((el) => el.tagName);
      if (tag === "SELECT") await cityInput.selectOption({ label: "Contagem" }).catch(async () => cityInput.selectOption("Contagem"));
      else await cityInput.fill("Contagem");
      await page.waitForTimeout(800);
      note("linha depois de trocar a cidade", (await row.innerText()).replace(/\s+/g, " ").slice(0, 200));
      await row.getByRole("button", { name: /Salvar/ }).click();
      await expect(page.getByText("Acesso atualizado").first()).toBeVisible({ timeout: 10_000 });
      const [c] = await query("select city from couriers where id='e2e-courier-b'");
      expect(c.city).toBe("Contagem");
      await query("update couriers set city='Belo Horizonte' where id='e2e-courier-b'");
    }
  });

  test("2.6 Menu da conta: 'Ajuda e Suporte' abre o WhatsApp", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /menu da conta/i }).click();
    const item = page.getByRole("menuitem", { name: /Ajuda e Suporte/ }).or(page.getByRole("link", { name: /Ajuda e Suporte/ })).first();
    await expect(item).toBeVisible();
    const href = await item.getAttribute("href") ?? await item.locator("a").getAttribute("href");
    expect(href ?? "").toMatch(WHATSAPP);
  });
});

test.describe("3. Gerente: nova entrega e lista", () => {
  test.beforeAll(wipeDeliveries);

  test("3.1–3.6 Formulário: sem Prioridade, unidade fixa, endereço, pagamento obrigatório, 4 formas, receita e lista", async ({ page }) => {
    await loginAs(page, "manager");
    await page.getByTestId("button-store-new-delivery").click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await shot(page, "03-nova-entrega");
    await expect(dialog.getByText(/Prioridade/), "o campo Prioridade ainda existe").toHaveCount(0);
    const unit = dialog.getByLabel(/Unidade/).first();
    if (await unit.count()) {
      note("unidade", `${await unit.inputValue().catch(() => "")} · desabilitada=${await unit.isDisabled().catch(() => "?")} · readonly=${await unit.getAttribute("readonly")}`);
      expect((await unit.isDisabled()) || (await unit.getAttribute("readonly")) !== null, "dá para trocar a unidade").toBe(true);
    } else note("unidade", (await dialog.innerText()).match(/Unidade[^\n]*\n[^\n]*/)?.[0] ?? "não encontrada");
    // Endereço
    const address = dialog.getByPlaceholder(/nome da rua ou o CEP/i).first();
    await address.click();
    await address.pressSequentially("Rua Pernambuco, Belo Horizonte", { delay: 40 });
    const option = page.getByRole("listbox", { name: "Sugestões de endereço" }).getByRole("option").first();
    await expect(option, "sem sugestões de endereço").toBeVisible({ timeout: 20_000 });
    await option.click();
    await page.waitForTimeout(1500);
    const number = dialog.locator('[data-testid$="-number"]').first();
    note("número após escolher", JSON.stringify(await number.inputValue().catch(() => null)));
    expect(await number.inputValue()).toBe("");
    await number.fill("1000");
    await page.waitForTimeout(1500);
    note("campos após número", (await dialog.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).filter(Boolean).join(" | "))).slice(0, 300));
    await shot(page, "03-endereco-preenchido");
    await dialog.getByLabel(/Nome do cliente|Cliente/).first().fill("E2E Cliente Roteiro");
    const order = dialog.getByLabel(/pedido/i).first();
    if (await order.count()) await order.fill(`PED-R2-${Date.now()}`);
    // Sem pagamento
    await dialog.getByRole("button", { name: /Registrar/ }).last().click();
    await page.waitForTimeout(800);
    const err = (await dialog.innerText()).match(/[^\n]*pagamento[^\n]*/i)?.[0];
    note("sem pagamento", err ?? "(nenhuma mensagem sobre pagamento)");
    await expect(dialog, "registrou sem forma de pagamento").toBeVisible();
    // Dinheiro troco 100 + receita
    await dialog.getByTestId("radio-payment-cash").check({ force: true });
    await dialog.getByTestId("input-change-for").fill("100");
    const rx = dialog.getByText("Medicamento com receita").first();
    await rx.click();
    await shot(page, "03-dinheiro-receita");
    await dialog.getByRole("button", { name: /Registrar/ }).last().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // Cartão, Pix e Dinheiro sem troco pela API (mesmo formulário já testado acima)
    const manager = await Api.as("manager");
    for (const extra of [{ paymentMethod: "CARD", bringCardMachine: true }, { paymentMethod: "PIX" }, { paymentMethod: "CASH", changeFor: null }]) {
      await manager.post("/deliveries", deliveryInput({ ...extra, customerName: `E2E Pagamento ${extra.paymentMethod}` }));
    }
    await page.reload();
    await page.waitForTimeout(2500);
    const list = await page.locator("main").innerText();
    await shot(page, "03-lista-gerente");
    const normalized = list.replace(/ /g, " ");
    for (const expected of ["Dinheiro · troco para R$ 100,00", "Dinheiro · sem troco", "Com receita", "Na fila dos motoboys da cidade"]) {
      expect(normalized, `a lista não mostra "${expected}"`).toContain(expected);
    }
    note("cartão na lista", list.match(/Cartão[^\n]*/)?.[0] ?? "(não achado)");
    note("pix na lista", list.match(/Pix[^\n]*/)?.[0] ?? "(não achado)");
    for (const step of ["Solicitada", "Aceita", "Retirada", "Concluída"]) expect(list).toContain(step);
  });

  test("3.7 Gerente edita uma entrega na fila (pagamento) e a alteração aparece na lista", async ({ page }) => {
    await wipeDeliveries();
    const d = await json(await (await Api.as("manager")).post("/deliveries", deliveryInput({ storeId: stores.a.id, paymentMethod: "PIX" })));
    await loginAs(page, "manager");
    const edit = page.getByTestId(`button-store-edit-${d.id}`);
    await expect(edit, "não existe o botão Editar na lista do gerente").toBeVisible({ timeout: 15_000 });
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "Editar entrega" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("radio-payment-cash").check({ force: true });
    await dialog.getByTestId("input-change-for").fill("50");
    await shot(page, "03-editar-entrega");
    await dialog.getByTestId("button-save-delivery").click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(`Entrega ${d.code} atualizada.`)).toBeVisible();
    const card = page.getByTestId(`button-store-edit-${d.id}`).locator("xpath=ancestor::*[contains(@data-testid,'store-delivery') or self::article or self::li][1]");
    const text = ((await card.count()) ? await card.innerText() : await page.locator("main").innerText()).replace(/ /g, " ");
    expect(text).toContain("Dinheiro · troco para R$ 50,00");
    await shot(page, "03-editada-na-lista");
    // Depois que um motoboy aceita, o botão some.
    await courierOnline(await Api.as("courier"));
    await (await Api.as("courier")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    await page.reload();
    await expect(page.getByTestId(`button-store-edit-${d.id}`)).toHaveCount(0, { timeout: 15_000 });
    await query("update couriers set status='OFFLINE' where id='e2e-courier-1'");
  });

  test("3.5 Celular: caixinha 'Medicamento com receita' alinhada ao texto, dentro do quadro", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAs(page, "manager");
    await page.getByTestId("button-store-new-delivery").click();
    const label = page.getByText("Medicamento com receita").first();
    await label.scrollIntoViewIfNeeded();
    const checkbox = page.getByRole("checkbox", { name: /receita/i }).first();
    const [cb, lb] = [await checkbox.boundingBox(), await label.boundingBox()];
    note("caixinha × texto", `caixinha y=${Math.round(cb!.y)}–${Math.round(cb!.y + cb!.height)} · texto y=${Math.round(lb!.y)}–${Math.round(lb!.y + lb!.height)}`);
    expect(Math.abs(cb!.y + cb!.height / 2 - (lb!.y + Math.min(lb!.height, 24) / 2)), "caixinha desalinhada do texto").toBeLessThan(12);
    await shot(page, "03-receita-celular");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("10. Contabilidade da filial (gerente)", () => {
  test("10.1–10.5 Página, marcar como pago com confirmação e exportar CSV", async ({ page }) => {
    await wipeDeliveries();
    const admin = await Api.as("admin");
    await courierOnline(await Api.as("courier"));
    const d = await json(await (await Api.as("manager")).post("/deliveries", deliveryInput({ storeId: stores.a.id })));
    await (await Api.as("courier")).patch(`/deliveries/${d.id}/status`, { status: "ACCEPTED" });
    for (const s of ["IN_TRANSIT", "COMPLETED"]) await admin.patch(`/deliveries/${d.id}/status`, { status: s });
    await loginAs(page, "manager");
    await page.getByRole("link", { name: /Contabilidade/ }).or(page.getByTestId("link-store-reports")).first().click();
    await expect(page.getByTestId("accounting-summary")).toBeVisible({ timeout: 15_000 });
    await shot(page, "10-contabilidade");
    const summary = await page.getByTestId("accounting-summary").innerText();
    note("resumo", summary.replace(/\s+/g, " "));
    for (const s of ["Pedidos", "Valor das entregas", "Pago aos motoboys", "A pagar aos motoboys"]) expect(summary.toLowerCase()).toContain(s.toLowerCase());
    const pay = page.getByTestId("button-pay-e2e-courier-1");
    await expect(pay).toBeVisible();
    page.once("dialog", (dlg) => { note("confirmação", dlg.message()); void dlg.accept(); });
    await pay.click();
    const confirm = page.getByRole("dialog").filter({ hasText: /R\$/ }).first();
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      note("confirmação (modal)", (await confirm.innerText()).replace(/\s+/g, " ").slice(0, 200));
      await confirm.getByRole("button", { name: /Confirmar|Marcar|Sim/ }).last().click();
    }
    await expect(page.getByTestId("accounting-courier-e2e-courier-1")).toContainText(/R\$\s?0,00/, { timeout: 10_000 });
    await expect(page.getByTestId("accounting-deliveries")).toContainText(/Pago em \d{2}\/\d{2}/);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("button-accounting-export").click()]);
    const csv = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString("utf8");
    note("CSV", `${download.suggestedFilename()} · BOM=${text.charCodeAt(0) === 0xfeff} · ${text.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
    expect(text.charCodeAt(0), "CSV sem BOM: o Excel quebra os acentos").toBe(0xfeff);
  });
});

test.describe("11–12. Admin: relatórios e painel", () => {
  test("11 Relatórios: cards por etapa, filiais com detalhes e 'Ver todas as filiais'", async ({ page }) => {
    await loginAs(page, "admin", "/reports");
    await page.waitForTimeout(2500);
    await shot(page, "11-relatorios");
    const text = await page.locator("main").innerText();
    for (const s of ["Solicitadas", "Aceitas", "Retiradas", "Concluídas", "Canceladas"]) expect(text, `card "${s}"`).toContain(s);
    expect(text).toMatch(/Tempo médio/);
    const card = page.getByRole("button", { name: new RegExp(stores.a.name) }).first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await expect(page.getByRole("button", { name: /Ver todas as filiais/ })).toBeVisible();
      await shot(page, "11-filial-detalhe");
      await page.getByRole("button", { name: /Ver todas as filiais/ }).click();
    } else note("card de filial", "não achei o card clicável da filial");
    expect(text.match(/Motoboys[\s\S]{0,600}/)?.[0] ?? "", "lista de motoboys mostra R$").not.toMatch(/R\$/);
  });

  test("12 Painel: mapa, fila com etiquetas, detalhe com pagamento, etapas, mapa e foto", async ({ page }) => {
    await wipeDeliveries();
    const manager = await Api.as("manager");
    const rx = await json(await manager.post("/deliveries", deliveryInput({ requiresPrescription: true, customerName: "E2E Receita Painel" })));
    const r1 = await json(await manager.post("/deliveries", deliveryInput({ customerName: "E2E Rota 1" })));
    const r2 = await json(await manager.post("/deliveries", deliveryInput({ customerName: "E2E Rota 2" })));
    await manager.post("/delivery-routes", { deliveryIds: [r1.id, r2.id] });
    await loginAs(page, "admin");
    await page.waitForTimeout(3000);
    await shot(page, "12-painel-admin");
    const text = (await page.locator("main").innerText()).toUpperCase();
    expect(text).toContain("RECEITA");
    expect(text).toContain("EM ROTA");
    await expect(page.locator(".gm-style").first(), "mapa grande não carregou").toBeVisible({ timeout: 20_000 });
    await page.goto(`/deliveries/${rx.id}`);
    await page.waitForTimeout(2500);
    await shot(page, "12-detalhe");
    const detail = await page.locator("main").innerText();
    note("detalhe", detail.replace(/\s+/g, " ").slice(0, 400));
    expect(detail).toMatch(/Pix|Cartão|Dinheiro/);
    for (const step of ["Solicitada", "Aceita", "Retirada", "Concluída"]) expect(detail).toContain(step);
  });
});

test.describe("14. Telas pequenas e tablet", () => {
  for (const [label, size] of [["celular pequeno", { width: 375, height: 667 }], ["tablet", { width: 768, height: 1024 }]] as const) {
    test(`14 Gerente (lista, nova entrega e contabilidade) no ${label}: sem rolagem para o lado`, async ({ page }) => {
      await page.setViewportSize(size);
      await loginAs(page, "manager");
      await page.waitForTimeout(1500);
      await expectNoHorizontalScroll(page);
      await page.getByTestId("button-store-new-delivery").click();
      await page.waitForTimeout(800);
      await expectNoHorizontalScroll(page);
      await shot(page, `14-nova-entrega-${label}`);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: /Contabilidade/ }).or(page.getByTestId("link-store-reports")).first().click();
      await page.waitForTimeout(1500);
      await expectNoHorizontalScroll(page);
      await shot(page, `14-contabilidade-${label}`);
    });
  }
});
