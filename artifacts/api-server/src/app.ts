import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import erpRouter from "./routes/erp";
import { logger } from "./lib/logger";
import { supabaseAuthMiddleware } from "./lib/supabaseAuth";

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
// Integração ERP: autenticação e corpo JSON próprios, antes do login de pessoas (Supabase).
app.use("/api/v1/erp", erpRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(supabaseAuthMiddleware);

app.use("/api", router);

export default app;
