import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  getAddressDetails,
  useAutocompleteAddresses,
  type AddressPrediction,
  type AddressSuggestion,
} from "@workspace/api-client-react";
import { keepPreviousData } from "@tanstack/react-query";
import { Loader2, MapPin, Search } from "lucide-react";

const MIN_SEARCH_LENGTH = 3;

/** Endereço escolhido, com o id do Google para depois ajustar o pino pelo número. */
export type ChosenAddress = AddressSuggestion & { placeId: string };

type AddressAutocompleteProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: ChosenAddress) => void;
  placeholder: string;
  required?: boolean;
  inputClassName?: string;
  dataTestId?: string;
};

function newSessionToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function apiErrorMessage(error: unknown, fallback: string) {
  const apiError = error as Error & { data?: { error?: string } };
  return apiError?.data?.error ?? fallback;
}

/**
 * Posição exata de um número na rua escolhida. Se o Google não conhecer o
 * número, devolve o ponto da rua com o número preenchido.
 */
export async function locateHouseNumber(placeId: string, houseNumber: string) {
  return getAddressDetails({ placeId, numero: houseNumber.trim() });
}

/**
 * Busca de endereço (padrão combobox WAI-ARIA): o foco fica no campo, ↑/↓ movem
 * a sugestão destacada, Enter escolhe e Esc fecha só a lista.
 *
 * Duas etapas, como o Google recomenda: enquanto a pessoa digita, só sugestões
 * de rua (rápidas, sem número); ao escolher, o servidor completa bairro, cidade,
 * UF, CEP e posição. O número fica para a pessoa preencher.
 */
export default function AddressAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  required,
  inputClassName,
  dataTestId,
}: AddressAutocompleteProps) {
  const [input, setInput] = useState(value);
  const [debounced, setDebounced] = useState("");
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  // Uma "sessão" do Google vai da primeira letra até a escolha (cobra como uma busca só).
  const sessionRef = useRef(newSessionToken());

  useEffect(() => setInput(value), [value]);

  useEffect(() => {
    if (!focused || selected || input.trim().length < MIN_SEARCH_LENGTH) {
      setDebounced("");
      return;
    }
    const timeout = window.setTimeout(() => setDebounced(input.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [focused, input, selected]);

  const search = useAutocompleteAddresses(
    { texto: debounced, sessao: sessionRef.current },
    {
      query: {
        enabled: debounced.length >= MIN_SEARCH_LENGTH,
        retry: 1,
        staleTime: 5 * 60_000,
        // Mantém as sugestões anteriores na tela enquanto a nova busca chega.
        placeholderData: keepPreviousData,
      },
    },
  );
  const typed = input.trim();
  const showList = focused && !selected && !dismissed && typed.length > 0;
  const canSearch = typed.length >= MIN_SEARCH_LENGTH;
  const waitingForDebounce = showList && canSearch && typed !== debounced;
  const searching = (showList && canSearch && (waitingForDebounce || search.isFetching)) || loadingDetails;
  const suggestions: AddressPrediction[] = showList && canSearch && !search.isError ? search.data ?? [] : [];
  const listId = `${id}-suggestions`;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => setActiveIndex(-1), [debounced, search.data]);

  const handleChange = (nextValue: string) => {
    setInput(nextValue);
    setSelected(false);
    setDismissed(false);
    setDetailsError("");
    onChange(nextValue);
  };

  const chooseSuggestion = async (prediction: AddressPrediction) => {
    setInput(prediction.text);
    setSelected(true);
    setActiveIndex(-1);
    setDetailsError("");
    setLoadingDetails(true);
    try {
      const details = await getAddressDetails({ placeId: prediction.placeId, sessao: sessionRef.current });
      sessionRef.current = newSessionToken();
      setInput(details.formatted);
      onChange(details.formatted);
      onSelect({ ...details, placeId: prediction.placeId });
    } catch (error) {
      setSelected(false);
      setDetailsError(apiErrorMessage(error, "Não foi possível carregar este endereço. Tente outra sugestão."));
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) {
        if (dismissed) setDismissed(false);
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (current === -1) return step === 1 ? 0 : suggestions.length - 1;
        return (current + step + suggestions.length) % suggestions.length;
      });
    } else if (event.key === "Enter") {
      // Enter numa sugestão destacada escolhe, em vez de enviar o formulário.
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        void chooseSuggestion(suggestions[activeIndex]);
      }
    } else if (event.key === "Escape" && showList) {
      // Fecha só a lista; o modal continua aberto.
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          required={required}
          value={input}
          placeholder={placeholder}
          className={inputClassName}
          data-testid={dataTestId}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-busy={searching}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {searching ? (
          <Loader2
            aria-hidden="true"
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary"
            data-testid={dataTestId ? `${dataTestId}-searching` : undefined}
          />
        ) : (
          <Search
            aria-hidden="true"
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        )}
      </div>

      {loadingDetails && (
        <p className="mt-1.5 text-xs text-muted-foreground" role="status">Completando o endereço…</p>
      )}
      {detailsError && (
        <p className="mt-1.5 text-xs text-amber-800" role="alert">{detailsError}</p>
      )}

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Sugestões de endereço"
          className="absolute z-[1000] mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-xl"
        >
          {!canSearch ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground" role="status">
              Continue digitando o nome da rua (a busca começa na 3ª letra).
            </p>
          ) : searching && !suggestions.length ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground" role="status">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              Buscando endereços…
            </p>
          ) : search.isError ? (
            <p className="px-3 py-2.5 text-xs text-amber-800" role="status">
              {apiErrorMessage(search.error, "A busca de endereços está indisponível agora.")} Você ainda pode
              digitar o endereço completo.
            </p>
          ) : suggestions.length ? (
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion.placeId}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-[#f7f6f4] ${index === activeIndex ? "bg-[#f7f6f4] ring-1 ring-inset ring-primary/40" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void chooseSuggestion(suggestion)}
              >
                <MapPin size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{suggestion.mainText}</span>
                  {suggestion.secondaryText && (
                    <span className="block text-xs text-muted-foreground">{suggestion.secondaryText}</span>
                  )}
                </span>
              </div>
            ))
          ) : debounced.length >= MIN_SEARCH_LENGTH && search.data ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground" role="status">
              Nenhum endereço encontrado. Confira o nome da rua ou digite também a cidade.
            </p>
          ) : (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">Continue digitando para buscar endereços.</p>
          )}
        </div>
      )}
    </div>
  );
}
