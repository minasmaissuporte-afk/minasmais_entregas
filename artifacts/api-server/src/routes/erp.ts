import { randomUUID } from "node:crypto";
import express, { Router, type ErrorRequestHandler, type IRouter, type Request, type RequestHandler, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  AUTH_FAILURES_PER_10_MIN,
  RATE_LIMIT_PER_MINUTE,
  authFailuresFromIp,
  requestsInLastMinute,
  tokenFromHeaders,
  touchCredential,
  verifyToken,
  type ErpCredential,
} from "../erp/credentials";
import { ErpCancelInput, ErpSalePatch, SaleIdParam, validationDetails } from "../erp/contract";
import { recordEvent, saleKeys, type ErpOperation } from "../erp/events";
import { cancelFromErp, createFromErp, ErpError, getFromErp, updateFromErp, type ErpResult } from "../erp/service";
import { erpOpenApiDocument, swaggerHtml } from "../erp/openapi";
import { logger } from "../lib/logger";

/**
 * API pública da integração com o ERP: /api/v1/erp/…
 * Autenticação própria (token da integração), independente do login de pessoas.
 */
const router: IRouter = Router();

export function clientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || null;
}

export function publicOrigin(req: Request) {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  return `${proto}://${host}`;
}

function requestId(res: Response): string {
  return res.locals.erpRequestId as string;
}

function sendError(res: Response, error: ErpError) {
  res.status(error.status).json({
    erro: { codigo: error.code, mensagem: error.message, ...(error.details?.length ? { detalhes: error.details } : {}) },
    requestId: requestId(res),
  });
}

router.use((req, res, next) => {
  res.locals.erpRequestId = randomUUID();
  res.setHeader("X-Request-Id", res.locals.erpRequestId);
  res.setHeader("Cache-Control", "no-store");
  // Na Vercel o HTTPS é obrigatório (o certificado é dela). Recusa qualquer chamada que chegue em HTTP.
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  if (process.env.VERCEL && proto && proto !== "https") {
    sendError(res, new ErpError(403, "HTTPS_OBRIGATORIO", "Use HTTPS para chamar a API."));
    return;
  }
  next();
});

router.use(express.json({ limit: "64kb", type: ["application/json", "application/*+json"] }));

/** Disponibilidade da integração. Não precisa de token e não expõe dados internos. */
router.get("/health", async (req, res) => {
  let database = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = false;
  }
  const token = tokenFromHeaders(req.headers);
  const credential = token ? await verifyToken(token).catch(() => null) : null;
  res.status(database ? 200 : 503).json({
    status: database ? "ok" : "indisponivel",
    versao: "v1",
    dataHora: new Date().toISOString(),
    ...(token ? { credencialValida: Boolean(credential) } : {}),
  });
});

router.get("/openapi.json", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(erpOpenApiDocument(`${publicOrigin(req)}/api/v1/erp`));
});

router.get("/docs", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(swaggerHtml("openapi.json"));
});

const authenticate: RequestHandler = async (req, res, next) => {
  const ip = clientIp(req);
  if (ip && (await authFailuresFromIp(ip)) >= AUTH_FAILURES_PER_10_MIN) {
    res.setHeader("Retry-After", "600");
    sendError(res, new ErpError(429, "MUITAS_TENTATIVAS", "Muitas tentativas com credencial inválida. Aguarde 10 minutos."));
    return;
  }
  const token = tokenFromHeaders(req.headers);
  const credential = await verifyToken(token);
  if (!credential) {
    const error = token
      ? new ErpError(401, "CREDENCIAL_INVALIDA", "Credencial inválida ou revogada.")
      : new ErpError(401, "CREDENCIAL_AUSENTE", "Envie o token no cabeçalho Authorization: Bearer <token>.");
    await recordEvent({
      credentialId: null,
      operation: "AUTH",
      outcome: "FAILED",
      httpStatus: 401,
      errorCode: error.code,
      errorMessage: `${req.method} ${req.baseUrl}${req.path}`,
      clientIp: ip,
      requestId: requestId(res),
    });
    res.setHeader("WWW-Authenticate", 'Bearer realm="erp"');
    sendError(res, error);
    return;
  }
  if ((await requestsInLastMinute(credential.id)) >= RATE_LIMIT_PER_MINUTE) {
    res.setHeader("Retry-After", "60");
    sendError(res, new ErpError(429, "LIMITE_REQUISICOES", `Limite de ${RATE_LIMIT_PER_MINUTE} requisições por minuto atingido. Tente de novo em 1 minuto.`));
    return;
  }
  res.locals.erpCredential = credential;
  await touchCredential(credential.id);
  next();
};

async function run(
  req: Request,
  res: Response,
  operation: ErpOperation,
  keys: { saleId: string | null; storeCode: string | null },
  action: (credential: ErpCredential) => Promise<ErpResult>,
) {
  const credential = res.locals.erpCredential as ErpCredential;
  const payload = operation === "QUERY" ? null : req.body;
  try {
    const result = await action(credential);
    await recordEvent({
      credentialId: credential.id,
      operation,
      ...keys,
      outcome: result.outcome,
      httpStatus: result.httpStatus,
      payload,
      deliveryId: result.deliveryId,
      clientIp: clientIp(req),
      requestId: requestId(res),
    });
    if (result.outcome === "DUPLICATE") res.setHeader("Idempotent-Replayed", "true");
    res.status(result.httpStatus).json({ ...result.body, requestId: requestId(res) });
  } catch (caught) {
    const error =
      caught instanceof ErpError ? caught : new ErpError(500, "ERRO_INTERNO", "Erro interno. Tente de novo em instantes.");
    if (!(caught instanceof ErpError)) logger.error({ err: caught, operation }, "ERP: erro inesperado");
    await recordEvent({
      credentialId: credential.id,
      operation,
      ...keys,
      outcome: "FAILED",
      httpStatus: error.status,
      errorCode: error.code,
      errorMessage: error.details?.length
        ? `${error.message} ${error.details.map((item) => `${item.campo}: ${item.mensagem}`).join("; ")}`
        : error.message,
      payload,
      clientIp: clientIp(req),
      requestId: requestId(res),
    });
    sendError(res, error);
  }
}

function saleIdFrom(req: Request) {
  const parsed = SaleIdParam.safeParse(req.params.idVenda);
  if (!parsed.success) throw new ErpError(400, "DADOS_INVALIDOS", "ID da venda inválido.", validationDetails(parsed.error));
  return parsed.data;
}

router.post("/entregas", authenticate, (req, res) =>
  run(req, res, "CREATE", saleKeys(req.body), (credential) => createFromErp(credential.source, req.body)),
);

router.get("/entregas/:idVenda", authenticate, (req, res) =>
  run(req, res, "QUERY", { saleId: String(req.params.idVenda), storeCode: null }, (credential) =>
    getFromErp(credential.source, saleIdFrom(req)),
  ),
);

router.patch("/entregas/:idVenda", authenticate, (req, res) =>
  run(req, res, "UPDATE", { saleId: String(req.params.idVenda), storeCode: saleKeys(req.body).storeCode }, async (credential) => {
    const saleId = saleIdFrom(req);
    const patch = ErpSalePatch.safeParse(req.body ?? {});
    if (!patch.success) throw new ErpError(400, "DADOS_INVALIDOS", "Confira os campos enviados.", validationDetails(patch.error));
    return updateFromErp(credential.source, saleId, patch.data);
  }),
);

router.post("/entregas/:idVenda/cancelar", authenticate, (req, res) =>
  run(req, res, "CANCEL", { saleId: String(req.params.idVenda), storeCode: null }, async (credential) => {
    const saleId = saleIdFrom(req);
    const body = ErpCancelInput.safeParse(req.body ?? {});
    if (!body.success) throw new ErpError(400, "DADOS_INVALIDOS", "Confira os campos enviados.", validationDetails(body.error));
    return cancelFromErp(credential.source, saleId, body.data.motivo);
  }),
);

router.use((_req, res) => {
  sendError(res, new ErpError(404, "ROTA_NAO_ENCONTRADA", "Endereço não encontrado. Veja a documentação em /api/v1/erp/docs."));
});

const jsonErrors: ErrorRequestHandler = (error, _req, res, _next) => {
  const type = (error as { type?: string }).type;
  if (type === "entity.parse.failed") {
    sendError(res, new ErpError(400, "JSON_INVALIDO", "O corpo da requisição não é um JSON válido."));
    return;
  }
  if (type === "entity.too.large") {
    sendError(res, new ErpError(413, "CORPO_MUITO_GRANDE", "O corpo da requisição passou de 64 KB."));
    return;
  }
  logger.error({ err: error }, "ERP: erro inesperado");
  sendError(res, new ErpError(500, "ERRO_INTERNO", "Erro interno. Tente de novo em instantes."));
};
router.use(jsonErrors);

export default router;

/** Reprocessa um evento com erro (usado pelo painel do administrador). */
export async function reprocessErpEvent(event: {
  id: string;
  operation: string;
  saleId: string | null;
  payload: unknown;
  credentialSource: string;
}): Promise<{ result: ErpResult | null; error: ErpError | null }> {
  try {
    if (event.operation === "CREATE") return { result: await createFromErp(event.credentialSource, event.payload), error: null };
    if (!event.saleId) throw new ErpError(400, "DADOS_INVALIDOS", "O evento não tem o ID da venda.");
    if (event.operation === "UPDATE") {
      const patch = ErpSalePatch.safeParse(event.payload ?? {});
      if (!patch.success) throw new ErpError(400, "DADOS_INVALIDOS", "Confira os campos enviados.", validationDetails(patch.error));
      return { result: await updateFromErp(event.credentialSource, event.saleId, patch.data), error: null };
    }
    if (event.operation === "CANCEL") {
      const body = ErpCancelInput.safeParse(event.payload ?? {});
      return { result: await cancelFromErp(event.credentialSource, event.saleId, body.success ? body.data.motivo : null), error: null };
    }
    throw new ErpError(400, "NAO_REPROCESSAVEL", "Só envios de venda, atualização e cancelamento podem ser reprocessados.");
  } catch (caught) {
    if (caught instanceof ErpError) return { result: null, error: caught };
    logger.error({ err: caught }, "ERP: erro ao reprocessar");
    return { result: null, error: new ErpError(500, "ERRO_INTERNO", "Erro interno ao reprocessar.") };
  }
}
