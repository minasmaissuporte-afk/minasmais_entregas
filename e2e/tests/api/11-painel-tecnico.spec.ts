import { test, expect } from "@playwright/test";
import { Api, describe, json } from "../../support/api.ts";
import { query } from "../../support/db.ts";

/** Painel técnico: métricas de requisições, erros, serviços e banco (só administrador). */
test.describe("Painel técnico (API)", () => {
  test("Só o administrador acessa", async () => {
    for (const role of ["central", "manager", "staff", "courier"] as const) {
      const api = await Api.as(role);
      for (const path of ["/admin/dev/overview", "/admin/dev/requests", "/admin/dev/errors", "/admin/dev/database"]) {
        expect((await api.get(path)).status(), `${role} ${path}`).toBe(403);
      }
    }
    const anonymous = await Api.as(null);
    expect((await anonymous.get("/admin/dev/overview")).status()).toBe(401);
  });

  test("Visão geral mostra deploy, serviços e números sem expor segredos", async () => {
    const admin = await Api.as("admin");
    const res = await admin.get("/admin/dev/overview");
    expect(res.status(), await describe(res)).toBe(200);
    const body = await json(res);
    expect(body.databaseOk).toBe(true);
    expect(body.nodeVersion).toMatch(/^v\d+/);
    expect(body.services.map((service: { key: string }) => service.key)).toEqual(
      expect.arrayContaining(["database", "supabase-auth", "google-maps", "web-push", "native-push", "erp"]),
    );
    for (const service of body.services) expect(typeof service.configured).toBe("boolean");
    expect(body.counts.stores).toBeGreaterThanOrEqual(1);
    expect(body.counts.users).toBeGreaterThanOrEqual(1);
    // Nenhum valor de variável sensível pode aparecer na resposta.
    const text = JSON.stringify(body);
    for (const name of ["DATABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "GOOGLE_MAPS_API_KEY", "VAPID_PRIVATE_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON"]) {
      const value = process.env[name]?.trim();
      if (value && value.length > 8) expect(text, `${name} vazou`).not.toContain(value);
    }
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  });

  test("Requisições e erros são registrados por rota (sem query string)", async () => {
    await query(`delete from api_error_logs where path like '/api/deliveries/e2e-nao-existe%'`);
    const admin = await Api.as("admin");
    const missing = await admin.get("/deliveries/e2e-nao-existe?segredo=nao-guardar");
    expect(missing.status()).toBe(404);
    await expect
      .poll(async () => (await query(`select count(*)::int as total from api_error_logs where path = '/api/deliveries/e2e-nao-existe'`))[0].total, { timeout: 10_000 })
      .toBe(1);
    const [logged] = await query(`select route, status, message, role, path from api_error_logs where path = '/api/deliveries/e2e-nao-existe'`);
    expect(logged).toMatchObject({ route: "/api/deliveries/:deliveryId", status: 404, message: "Entrega não encontrada.", role: "ADMIN" });
    expect(logged.path).not.toContain("segredo");

    const errors = await json(await admin.get("/admin/dev/errors?status=4XX&q=e2e-nao-existe"));
    expect(errors[0]).toMatchObject({ method: "GET", route: "/api/deliveries/:deliveryId", status: 404 });
    expect((await json(await admin.get("/admin/dev/errors?status=5XX&q=e2e-nao-existe")))).toHaveLength(0);

    const stats = await json(await admin.get("/admin/dev/requests?hours=1"));
    expect(stats.totals.requests).toBeGreaterThan(0);
    expect(stats.hourly.length).toBeGreaterThanOrEqual(1);
    const route = stats.routes.find((item: { method: string; route: string }) => item.method === "GET" && item.route === "/api/deliveries/:deliveryId");
    expect(route, "rota agrupada com :deliveryId").toBeTruthy();
    expect(route.errors4xx).toBeGreaterThanOrEqual(1);
    expect(route.avgMs).toBeGreaterThan(0);
    // 401 (sessão expirada) não entra na lista de erros.
    const anonymous = await Api.as(null);
    await anonymous.get("/admin/dev/overview");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await query(`select 1 from api_error_logs where status = 401`)).toHaveLength(0);
    expect((await admin.get("/admin/dev/requests?hours=999")).status()).toBe(400);
    await query(`delete from api_error_logs where path like '/api/deliveries/e2e-nao-existe%'`);
  });

  test("Banco de dados: versão, tamanho, conexões e tabelas", async () => {
    const admin = await Api.as("admin");
    const body = await json(await admin.get("/admin/dev/database"));
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.pool.max).toBeGreaterThan(0);
    const names = body.tables.map((table: { name: string }) => table.name);
    expect(names).toEqual(expect.arrayContaining(["deliveries", "stores", "api_request_stats", "erp_integration_events"]));
  });
});
