/** Forma de pagamento do cliente, como aparece para o motoboy, o gerente e a Central. */
export type PaymentMethod = "CARD" | "PIX" | "CASH";

export type PaymentInfo = {
  paymentMethod?: string | null;
  changeFor?: number | null;
  bringCardMachine?: boolean | null;
  amountToCharge?: number | null;
  prepaid?: boolean | null;
};

export const paymentMethodNames: Record<PaymentMethod, string> = {
  CARD: "Cartão",
  PIX: "Pix",
  CASH: "Dinheiro",
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Ex.: "Pix" · "Cartão · levar maquininha" · "Dinheiro · troco para R$ 100,00". */
export function paymentLabel(info: PaymentInfo | null | undefined): string | null {
  if (info?.prepaid) return "Já pago · não cobrar";
  const method = info?.paymentMethod as PaymentMethod | null | undefined;
  const charge = info?.amountToCharge ? `Cobrar ${brl.format(info.amountToCharge)} · ` : "";
  if (!method || !(method in paymentMethodNames)) return charge ? charge.replace(/ · $/, "") : null;
  if (method === "CARD") {
    return `${charge}${info?.bringCardMachine === false ? "Cartão · sem maquininha" : "Cartão · levar maquininha"}`;
  }
  if (method === "CASH") {
    // Com o total conhecido, já diz quanto levar de troco.
    const change = info?.changeFor && info.amountToCharge && info.changeFor > info.amountToCharge
      ? ` (levar ${brl.format(info.changeFor - info.amountToCharge)} de troco)`
      : "";
    return `${charge}${info?.changeFor ? `Dinheiro · troco para ${brl.format(info.changeFor)}${change}` : "Dinheiro · sem troco"}`;
  }
  return `${charge}Pix`;
}
