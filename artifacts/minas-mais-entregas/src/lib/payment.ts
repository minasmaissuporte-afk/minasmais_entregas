/** Forma de pagamento do cliente, como aparece para o motoboy, o gerente e a Central. */
export type PaymentMethod = "CARD" | "PIX" | "CASH";

export type PaymentInfo = {
  paymentMethod?: string | null;
  changeFor?: number | null;
  bringCardMachine?: boolean | null;
};

export const paymentMethodNames: Record<PaymentMethod, string> = {
  CARD: "Cartão",
  PIX: "Pix",
  CASH: "Dinheiro",
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Ex.: "Pix" · "Cartão · levar maquininha" · "Dinheiro · troco para R$ 100,00". */
export function paymentLabel(info: PaymentInfo | null | undefined): string | null {
  const method = info?.paymentMethod as PaymentMethod | null | undefined;
  if (!method || !(method in paymentMethodNames)) return null;
  if (method === "CARD") {
    return info?.bringCardMachine === false ? "Cartão · sem maquininha" : "Cartão · levar maquininha";
  }
  if (method === "CASH") {
    return info?.changeFor ? `Dinheiro · troco para ${brl.format(info.changeFor)}` : "Dinheiro · sem troco";
  }
  return "Pix";
}
