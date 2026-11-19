import { z } from "zod/v4";

/**
 * Contrato da venda enviada pelo ERP (campos em português, como o ERP costuma trabalhar).
 * Só o necessário para a operação é obrigatório: ID da venda, filial, nome do cliente, rua e
 * forma de pagamento (ou "pago"). O resto é opcional.
 */

/** Aceita 58.9, "58.90", "58,90" e "1.234,56". */
const money = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const text = value.trim().replace(/^R\$\s*/i, "");
  if (!text) return undefined;
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}, z.number({ error: "precisa ser um número (ex.: 58.90)" }).finite().min(0, "não pode ser negativo").max(1_000_000));

const text = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() || undefined : value),
    z.string().max(max, `até ${max} caracteres`).optional().nullable(),
  );

const identifier = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : value),
    z
      .string({ error: "obrigatório" })
      .min(1, "obrigatório")
      .max(max, `até ${max} caracteres`)
      .regex(/^[A-Za-z0-9._\-/]+$/, "use só letras, números, ponto, hífen, barra ou sublinhado"),
  );

const bool = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "sim", "s", "1"].includes(normalized)) return true;
    if (["false", "nao", "não", "n", "0"].includes(normalized)) return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return value;
}, z.boolean({ error: "use true ou false" }).optional().nullable());

const saleDate = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "use o formato ISO 8601, ex.: 2026-11-19T10:30:00-03:00")
    .optional()
    .nullable(),
);

/** Formas de pagamento aceitas (sem acento e sem diferenciar maiúsculas). */
export const paymentAliases: Record<string, "CASH" | "PIX" | "CARD" | "PAID"> = {
  DINHEIRO: "CASH",
  ESPECIE: "CASH",
  CASH: "CASH",
  PIX: "PIX",
  CARTAO: "CARD",
  CARTAO_CREDITO: "CARD",
  CARTAO_DEBITO: "CARD",
  CREDITO: "CARD",
  DEBITO: "CARD",
  CARD: "CARD",
  PAGO: "PAID",
  JA_PAGO: "PAID",
  PAGO_ONLINE: "PAID",
  FATURADO: "PAID",
};

export const paymentMethodValues = ["DINHEIRO", "PIX", "CARTAO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PAGO"] as const;

const paymentMethod = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_") || undefined
      : value,
  z
    .string()
    .refine((value) => value in paymentAliases, `use um destes valores: ${paymentMethodValues.join(", ")}`)
    .optional()
    .nullable(),
);

const customer = z.object({
  nome: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ error: "obrigatório" }).min(2, "precisa ter 2 letras ou mais").max(120),
  ),
  telefone: text(30),
});

const address = z.object({
  cep: text(12),
  rua: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ error: "obrigatório" }).min(3, "precisa ter 3 caracteres ou mais").max(160),
  ),
  numero: text(20),
  bairro: text(80),
  cidade: text(80),
  estado: text(2),
  complemento: text(120),
  referencia: text(200),
});

const order = z.object({
  numeroPedido: text(60),
  valorTotal: money.optional().nullable(),
  formaPagamento: paymentMethod,
  valorReceber: money.optional().nullable(),
  trocoPara: money.optional().nullable(),
  levarMaquininha: bool,
  pago: bool,
  receita: bool,
  observacoes: text(500),
});

export const ErpSaleInput = z.object({
  idVenda: identifier(64),
  codigoFilial: identifier(32),
  dataVenda: saleDate,
  cliente: customer,
  endereco: address,
  pedido: order.default({}),
});
export type ErpSale = z.infer<typeof ErpSaleInput>;

/** PATCH: tudo opcional; o endereço, quando enviado, vem completo (rua obrigatória). */
export const ErpSalePatch = z.object({
  codigoFilial: identifier(32).optional(),
  dataVenda: saleDate,
  cliente: customer.partial().optional(),
  endereco: address.optional(),
  pedido: order.partial().optional(),
});
export type ErpSalePatchInput = z.infer<typeof ErpSalePatch>;

export const ErpCancelInput = z
  .object({ motivo: text(300) })
  .default({});

export const SaleIdParam = identifier(64);

/** Lista os erros de validação como { campo, mensagem }. */
export function validationDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    campo: issue.path.join(".") || "(corpo)",
    mensagem: issue.code === "invalid_type" && issue.input === undefined ? "obrigatório" : issue.message,
  }));
}

export function normalizeStoreCode(value: string) {
  return value.trim().toUpperCase();
}
