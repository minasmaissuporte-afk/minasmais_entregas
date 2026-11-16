import { test, expect } from "@playwright/test";
import { loginAs } from "../../support/ui.ts";

// O "headless shell" sempre nega notificações; o Chromium completo respeita a permissão concedida.
test.use({ channel: "chromium" });

test.describe("Notificações (sino)", () => {

  test("Sino desligado aparece cortado; clicar pede permissão, ativa e não muda de página", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    await loginAs(page, "central", "/entregas");
    const bell = page.getByTestId("button-notification-bell");
    await expect(bell).toBeVisible({ timeout: 20_000 });
    const initial = await bell.getAttribute("aria-label");
    test.info().annotations.push({ type: "estado inicial", description: String(initial) });
    const urlBefore = page.url();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const subscription = page.waitForResponse((r) => r.url().includes("/api/push/subscription") && r.request().method() === "POST", { timeout: 15_000 }).catch(() => null);
    await bell.click();
    const res = await subscription;
    const message = await page.getByTestId("notification-bell-status").textContent({ timeout: 10_000 }).catch(() => null);
    test.info().annotations.push({ type: "mensagem", description: `${message ?? "(sem mensagem)"} · POST /push/subscription: ${res ? res.status() : "não foi feito"}` });
    expect(page.url(), "o clique no sino mudou a página").toBe(urlBefore);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore), "o clique no sino rolou a página").toBeLessThan(5);
    expect(res?.status(), "a inscrição de notificações não foi salva no servidor").toBeLessThan(300);
    await expect(bell).toHaveAttribute("aria-label", "Notificações ativadas", { timeout: 10_000 });
  });

  test("Sino com notificações bloqueadas explica o bloqueio", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/sign-in");
    await page.evaluate(() => undefined);
    // Bloqueia explicitamente a permissão nesta origem.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setPermission", { permission: { name: "notifications" }, setting: "denied", origin: new URL(page.url()).origin }).catch(() => undefined);
    await loginAs(page, "central", "/entregas");
    const bell = page.getByTestId("button-notification-bell");
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await bell.click();
    const message = await page.getByTestId("notification-bell-status").textContent({ timeout: 10_000 }).catch(() => null);
    test.info().annotations.push({ type: "mensagem com permissão negada", description: message ?? "(sem mensagem)" });
    expect(message, "nenhuma explicação quando o navegador bloqueia").toBeTruthy();
  });
});

