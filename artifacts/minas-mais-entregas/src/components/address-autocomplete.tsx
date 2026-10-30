import { useEffect, useState } from "react";
import {
  useAutocompleteAddresses,
  type AddressSuggestion,
} from "@workspace/api-client-react";
import { MapPin, Search } from "lucide-react";

type AddressAutocompleteProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder: string;
  required?: boolean;
  inputClassName?: string;
  dataTestId?: string;
};

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

  useEffect(() => setInput(value), [value]);

  useEffect(() => {
    if (!focused || selected || input.trim().length < 3) {
      setDebounced("");
      return;
    }
    const timeout = window.setTimeout(() => setDebounced(input.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [focused, input, selected]);

  const search = useAutocompleteAddresses(
    { texto: debounced },
    {
      query: {
        enabled: debounced.length >= 3,
        retry: false,
        staleTime: 60_000,
      },
    },
  );
  const showList = focused && !selected && input.trim().length >= 3;
  const waitingForDebounce = showList && input.trim() !== debounced;

  const handleChange = (nextValue: string) => {
    setInput(nextValue);
    setSelected(false);
    onChange(nextValue);
  };

  const chooseSuggestion = (suggestion: AddressSuggestion) => {
    setInput(suggestion.formatted);
    setSelected(true);
    setFocused(false);
    onChange(suggestion.formatted);
    onSelect(suggestion);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          autoComplete="off"
          required={required}
          value={input}
          placeholder={placeholder}
          className={inputClassName}
          data-testid={dataTestId}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={`${id}-suggestions`}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(event) => handleChange(event.target.value)}
        />
        <Search
          aria-hidden="true"
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>

      {showList && (
        <div
          id={`${id}-suggestions`}
          role="listbox"
          className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-xl"
        >
          {waitingForDebounce || search.isLoading ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Buscando endereços…
            </p>
          ) : search.isError ? (
            <p className="px-3 py-2.5 text-xs text-amber-800">
              A busca de endereços está indisponível. Você ainda pode informar
              o endereço manualmente.
            </p>
          ) : search.data?.length ? (
            search.data.map((suggestion, index) => (
              <button
                key={`${suggestion.formatted}-${index}`}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[#f7f6f4] focus:bg-[#f7f6f4] focus:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(suggestion)}
              >
                <MapPin
                  size={15}
                  className="mt-0.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>{suggestion.formatted}</span>
              </button>
            ))
          ) : debounced.length >= 3 && search.data ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Nenhum endereço encontrado. Confira o texto ou continue digitando.
            </p>
          ) : (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Continue digitando para buscar endereços.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
