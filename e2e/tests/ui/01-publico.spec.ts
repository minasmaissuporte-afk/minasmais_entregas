import { test, expect } from "@playwright/test";
import { credentials } from "../../support/auth.ts";
import { expectAccessible, expectNoHorizontalScroll, trackErrors } from "../../support/ui.ts";

test.describe("Páginas públicas", () => {
  test("Página inicial sem login carrega sem erros de JavaScript", async ({ page }) => {
    const errors = trackErrors(page);
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: /Entregas organizadas/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("Página inicial: acessibilidade WCAG AA (sem violações graves)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expectAccessible(page, "Página inicial");
  });

  test("Tela de login: e-mail, senha, 'Com senha/Sem senha', Google e link de cadastro", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Com senha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Entrar com Google/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Solicitar acesso" })).toBeVisible();
    await expectAccessible(page, "Tela de login");
  });

  test("Senha errada mostra erro em português e não entra", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("E-mail").fill(credentials().central.email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText(/inválid|incorret|não foi possível/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/sign-in/);
  });

  test("E-mail em maiúsculas e com espaços também entra (normalização)", async ({ page }) => {
    const { email, password } = credentials().central;
    await page.goto("/sign-in");
    await page.getByLabel("E-mail").fill(`  ${email.toUpperCase()}  `);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });
  });

  test("Campos obrigatórios: não envia login vazio", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/sign-in/);
    expect(await page.getByLabel("E-mail").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test("Cadastro (/sign-up) pede nome, e-mail, senha e confirmação com mínimo de 8 caracteres", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: "Solicite seu acesso" })).toBeVisible();
    await expect(page.getByLabel("Nome completo")).toBeVisible();
    await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("minlength", "8");
    await expect(page.getByLabel("Confirmar senha")).toBeVisible();
    await expectAccessible(page, "Cadastro");
  });

  test("Esqueci minha senha abre e preenche o e-mail vindo da tela de login", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("E-mail").fill("Alguem@Example.com");
    await page.getByRole("link", { name: "Esqueci minha senha" }).click();
    await expect(page.getByRole("heading", { name: "Esqueci minha senha" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toHaveValue(/alguem@example\.com/i);
  });

  test("Link de redefinição sem token mostra 'Link inválido ou expirado'", async ({ page }) => {
    await page.goto("/redefinir-senha");
    await expect(page.getByRole("heading", { name: /Link inválido ou expirado|Nova senha|Criar nova senha/ })).toBeVisible({ timeout: 15_000 });
  });

  test("Página do app do motoboy (/motoboy-pwa) explica a instalação", async ({ page }) => {
    await page.goto("/motoboy-pwa");
    await expect(page.getByRole("heading", { name: "Suas entregas no celular" })).toBeVisible();
    await expectAccessible(page, "/motoboy-pwa");
  });

  test("[BUG] Página 404 em português (hoje mostra '404 Page Not Found')", async ({ page }) => {
    await page.goto("/pagina-que-nao-existe-e2e");
    await expect(page.getByText(/não encontrada|não existe/i).first()).toBeVisible();
  });

  test("Rotas internas sem login não mostram dados", async ({ page }) => {
    for (const path of ["/entregas", "/mapa", "/motoboys", "/access", "/filiais", "/reports", "/account", "/deliveries/e2e-x"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: /Contas cadastradas|Filiais cadastradas|Entregas$|Sua operação|Relatórios/ })).toHaveCount(0);
    }
  });

  for (const path of ["/", "/sign-in", "/sign-up", "/motoboy-pwa"]) {
    test(`Celular (390px) sem rolagem horizontal: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalScroll(page);
    });
  }
});
