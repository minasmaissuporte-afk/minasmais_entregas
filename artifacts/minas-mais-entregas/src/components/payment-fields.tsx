import { Banknote, CreditCard, QrCode } from "lucide-react";
import type { PaymentMethod } from "@/lib/payment";

export type PaymentFormValue = {
  paymentMethod: PaymentMethod | "";
  /** Texto do campo "Troco para quanto?" (ex.: "100" ou "100,00"). */
  changeFor: string;
  bringCardMachine: boolean;
};

export const emptyPayment: PaymentFormValue = { paymentMethod: "", changeFor: "", bringCardMachine: true };

/** "100,50" → 100.5 ; vazio → null. */
export function parseChangeFor(text: string): number | null {
  const normalized = text.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const value = Number(normalized);
  return normalized && Number.isFinite(value) && value > 0 ? value : null;
}

/** Campos enviados para a API a partir do formulário. */
export function paymentPayload(value: PaymentFormValue) {
  if (!value.paymentMethod) return {};
  return {
    paymentMethod: value.paymentMethod,
    changeFor: value.paymentMethod === "CASH" ? parseChangeFor(value.changeFor) : null,
    bringCardMachine: value.paymentMethod === "CARD" ? value.bringCardMachine : null,
  };
}

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
}: {
  value: PaymentFormValue;
  onChange: (next: PaymentFormValue) => void;
  idPrefix: string;
}) {
  const set = (patch: Partial<PaymentFormValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="space-y-3" data-testid="payment-fields">
      <legend className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Forma de pagamento</legend>
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
    </fieldset>
  );
}
