import { Banknote, CreditCard, QrCode } from "lucide-react";
import type { PaymentMethod } from "@/lib/payment";

export type PaymentFormValue = {
  paymentMethod: PaymentMethod | "";
  /** Texto do campo "Troco para quanto?" (ex.: "100" ou "100,00"). */
  changeFor: string;
  bringCardMachine: boolean;
  /** Texto do campo "Valor dos produtos" (R$). */
  productsAmount: string;
  /** Cliente já pagou produtos e entrega: o motoboy não cobra nada. */
  prepaid: boolean;
};

export const emptyPayment: PaymentFormValue = { paymentMethod: "", changeFor: "", bringCardMachine: true, productsAmount: "", prepaid: false };

/** "100,50" → 100.5 ; vazio → null. */
export function parseChangeFor(text: string): number | null {
  const normalized = text.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const value = Number(normalized);
  return normalized && Number.isFinite(value) && value > 0 ? value : null;
}

/** Campos enviados para a API a partir do formulário. */
export function paymentPayload(value: PaymentFormValue) {
  const amounts = { productsAmount: parseChangeFor(value.productsAmount), prepaid: value.prepaid };
  if (value.prepaid) return amounts;
  if (!value.paymentMethod) return amounts;
  return {
    ...amounts,
    paymentMethod: value.paymentMethod,
    changeFor: value.paymentMethod === "CASH" ? parseChangeFor(value.changeFor) : null,
    bringCardMachine: value.paymentMethod === "CARD" ? value.bringCardMachine : null,
  };
}

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const options: { value: PaymentMethod; label: string; icon: typeof CreditCard }[] = [
  { value: "CARD", label: "Cartão", icon: CreditCard },
  { value: "PIX", label: "Pix", icon: QrCode },
  { value: "CASH", label: "Dinheiro", icon: Banknote },
];

/** Forma de pagamento do cliente: cartão (levar maquininha?), Pix ou dinheiro (troco para quanto?). */
export default function PaymentFields({
  value,
  onChange,
  idPrefix,
  deliveryFee,
}: {
  value: PaymentFormValue;
  onChange: (next: PaymentFormValue) => void;
  idPrefix: string;
  /** Taxa de entrega da filial (entra na soma do que o motoboy cobra). */
  deliveryFee?: number | null;
}) {
  const set = (patch: Partial<PaymentFormValue>) => onChange({ ...value, ...patch });
  const products = parseChangeFor(value.productsAmount);
  const fee = deliveryFee ?? 0;
  return (
    <fieldset className="space-y-3" data-testid="payment-fields">
      <legend className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Pagamento do cliente</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block" htmlFor={`${idPrefix}-products-amount`}>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Valor dos produtos</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
            <input
              id={`${idPrefix}-products-amount`}
              inputMode="decimal"
              className="!pl-10"
              value={value.productsAmount}
              onChange={(event) => set({ productsAmount: event.target.value })}
              placeholder="Ex.: 48,90"
              data-testid="input-products-amount"
            />
          </span>
        </label>
        <div className="rounded-lg border border-border bg-[#faf9f7] px-3 py-2" aria-live="polite" data-testid="text-amount-to-charge">
          <span className="block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{value.prepaid ? "Já está pago" : "Total a cobrar do cliente"}</span>
          <strong className={`mt-0.5 block text-lg ${value.prepaid ? "text-[#28794f]" : "text-[#24272d]"}`}>
            {value.prepaid ? "Não cobrar nada" : products != null ? brl(products + fee) : "—"}
          </strong>
          <span className="block text-[11px] text-muted-foreground">
            {products != null ? `Produtos ${brl(products)} + entrega ${brl(fee)}` : "Informe o valor dos produtos para somar com a entrega."}
          </span>
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-white px-3 py-2">
        <input
          type="checkbox"
          className="!h-5 !min-h-0 !w-5 shrink-0 !p-0 accent-[#28794f]"
          checked={value.prepaid}
          onChange={(event) => set({ prepaid: event.target.checked })}
          data-testid="checkbox-prepaid"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[#2b2e33]">Já está pago</span>
          <span className="block text-xs text-muted-foreground">O cliente já pagou produtos e entrega. O motoboy só entrega.</span>
        </span>
      </label>
      {!value.prepaid && <>
      <span className="block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Forma de pagamento</span>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pagamento">
        {options.map(({ value: option, label, icon: Icon }) => {
          const selected = value.paymentMethod === option;
          return (
            <label
              key={option}
              className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold transition-colors ${selected ? "border-[#b91e2c] bg-[#fcf4f4] text-[#a3141f]" : "border-border bg-white text-[#42464d] hover:bg-[#faf9f7]"}`}
            >
              <input
                type="radio"
                name={`${idPrefix}-payment`}
                className="sr-only"
                required
                checked={selected}
                onChange={() => set({ paymentMethod: option })}
                data-testid={`radio-payment-${option.toLowerCase()}`}
              />
              <Icon size={16} aria-hidden="true" /> {label}
            </label>
          );
        })}
      </div>
      {value.paymentMethod === "CASH" && (
        <label className="block" htmlFor={`${idPrefix}-change-for`}>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Troco para quanto?</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
            <input
              id={`${idPrefix}-change-for`}
              inputMode="decimal"
              className="!pl-10"
              value={value.changeFor}
              onChange={(event) => set({ changeFor: event.target.value })}
              placeholder="Ex.: 100,00"
              data-testid="input-change-for"
            />
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">Com quanto o cliente vai pagar. Deixe em branco se não precisa de troco.</span>
        </label>
      )}
      {value.paymentMethod === "CARD" && (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Levar a maquininha?</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Levar a maquininha">
            {[true, false].map((option) => (
              <label
                key={String(option)}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold ${value.bringCardMachine === option ? "border-[#b91e2c] bg-[#fcf4f4] text-[#a3141f]" : "border-border bg-white text-[#42464d]"}`}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-card-machine`}
                  className="sr-only"
                  checked={value.bringCardMachine === option}
                  onChange={() => set({ bringCardMachine: option })}
                  data-testid={`radio-card-machine-${option ? "yes" : "no"}`}
                />
                {option ? "Sim, levar" : "Não precisa"}
              </label>
            ))}
          </div>
        </div>
      )}
      </>}
    </fieldset>
  );
}
