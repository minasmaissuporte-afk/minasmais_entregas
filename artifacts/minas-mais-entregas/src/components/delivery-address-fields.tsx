import { useRef, useState } from "react";
import AddressAutocomplete, { locateHouseNumber, type ChosenAddress } from "@/components/address-autocomplete";

export type DeliveryAddressValue = {
  destination: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  idPrefix: string;
  /** Endereço atual (na edição, o que já está salvo). */
  initialDestination?: string;
  onChange: (value: DeliveryAddressValue) => void;
  labelClassName?: string;
  autoFocus?: boolean;
  /** data-testid do campo de busca (os testes e2e usam "input-destination"). */
  destinationTestId?: string;
};

function composeDestination(address: ChosenAddress, houseNumber: string, complement: string) {
  if (!address.street) return address.formatted;
  const streetPart = [address.street, houseNumber.trim()].filter(Boolean).join(", ");
  const withComplement = complement.trim() ? `${streetPart} - ${complement.trim()}` : streetPart;
  const cityPart = [address.city, address.stateCode].filter(Boolean).join(" - ");
  return [[withComplement, address.suburb].filter(Boolean).join(" - "), cityPart, address.postcode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Endereço de entrega em três passos curtos: escolher a rua na lista (bairro,
 * cidade e CEP vêm sozinhos), digitar o número e, se quiser, o complemento.
 * Ao sair do campo número, o pino vai para a posição exata do número.
 */
export default function DeliveryAddressFields({ idPrefix, initialDestination = "", onChange, labelClassName, autoFocus, destinationTestId }: Props) {
  const [search, setSearch] = useState(initialDestination);
  const [chosen, setChosen] = useState<ChosenAddress | null>(null);
  const [houseNumber, setHouseNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [locating, setLocating] = useState(false);
  const [pinNote, setPinNote] = useState("");
  const coordinatesRef = useRef<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const lastLocatedRef = useRef("");

  const emit = (address: ChosenAddress | null, number: string, extra: string, text = search) => {
    if (!address) {
      onChange({ destination: text, latitude: null, longitude: null });
      return;
    }
    onChange({
      destination: composeDestination(address, number, extra),
      latitude: coordinatesRef.current.latitude,
      longitude: coordinatesRef.current.longitude,
    });
  };

  const select = (address: ChosenAddress) => {
    setChosen(address);
    coordinatesRef.current = { latitude: address.latitude, longitude: address.longitude };
    const number = address.houseNumber ?? "";
    setHouseNumber(number);
    lastLocatedRef.current = number;
    setPinNote("");
    emit(address, number, complement);
    if (!number) window.requestAnimationFrame(() => document.getElementById(`${idPrefix}-number`)?.focus());
  };

  const locateNumber = async () => {
    const number = houseNumber.trim();
    if (!chosen || !number || number === lastLocatedRef.current) return;
    lastLocatedRef.current = number;
    setLocating(true);
    setPinNote("");
    try {
      const located = await locateHouseNumber(chosen.placeId, number);
      coordinatesRef.current = { latitude: located.latitude, longitude: located.longitude };
      const moved = located.latitude !== chosen.latitude || located.longitude !== chosen.longitude;
      setPinNote(moved ? "Pino ajustado para o número." : "O Google não conhece este número: o pino fica no meio da rua.");
      const refined = { ...chosen, postcode: located.postcode ?? chosen.postcode, suburb: chosen.suburb ?? located.suburb };
      setChosen(refined);
      emit(refined, number, complement);
    } catch {
      setPinNote("Não foi possível ajustar o pino pelo número. O endereço continua válido.");
    } finally {
      setLocating(false);
    }
  };

  const labelClass = labelClassName ?? "mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground";

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={labelClass}>Endereço de entrega</span>
        <AddressAutocomplete
          id={`${idPrefix}-destination`}
          required
          value={search}
          onChange={(text) => {
            setSearch(text);
            // Digitou de novo: a rua escolhida antes não vale mais.
            if (chosen) {
              setChosen(null);
              setHouseNumber("");
              setPinNote("");
            }
            coordinatesRef.current = { latitude: null, longitude: null };
            emit(null, "", "", text);
          }}
          onSelect={select}
          placeholder="Digite o nome da rua ou o CEP"
          inputClassName="w-full"
          dataTestId={destinationTestId ?? `input-${idPrefix}-destination`}
        />
        {!chosen && search.trim() && search !== initialDestination && (
          <span className="mt-1.5 block text-xs text-amber-800" data-testid={`text-${idPrefix}-without-pin`}>
            Escolha a rua na lista para o motoboy receber o pino no mapa.
          </span>
        )}
      </label>
      {chosen && (
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <label className="block">
            <span className={labelClass}>Número</span>
            <input
              id={`${idPrefix}-number`}
              required
              inputMode="text"
              autoFocus={autoFocus}
              value={houseNumber}
              onChange={(event) => {
                setHouseNumber(event.target.value);
                emit(chosen, event.target.value, complement);
              }}
              onBlur={() => void locateNumber()}
              placeholder="Ex.: 120 ou s/n"
              data-testid={`input-${idPrefix}-number`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Complemento</span>
            <input
              value={complement}
              onChange={(event) => {
                setComplement(event.target.value);
                emit(chosen, houseNumber, event.target.value);
              }}
              placeholder="Apto, bloco, casa (opcional)"
              data-testid={`input-${idPrefix}-complement`}
            />
          </label>
          {(locating || pinNote) && (
            <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
              {locating ? "Ajustando o pino pelo número…" : pinNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
