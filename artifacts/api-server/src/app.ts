import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import erpRouter from "./routes/erp";
import { logger } from "./lib/logger";
import { supabaseAuthMiddleware } from "./lib/supabaseAuth";
import { jsonErrorHandler, telemetryMiddleware } from "./lib/telemetry";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Auth travels as a Bearer token (Supabase session), not cookies, so CORS does not need credentials.
app.use(cors({ origin: true }));
// Métricas do Painel técnico (contagem, tempo e erros por rota; sem dados da requisição).
app.use("/api", telemetryMiddleware);
// Integração ERP: autenticação e corpo JSON próprios, antes do login de pessoas (Supabase).
app.use("/api/v1/erp", erpRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(supabaseAuthMiddleware);

app.use("/api", router);
app.use(jsonErrorHandler);

export default app;
