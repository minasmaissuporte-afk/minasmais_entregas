import { useEffect, useState, type KeyboardEvent } from "react";
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

/**
 * Address search following the WAI-ARIA combobox pattern: focus stays in the
 * input, ↑/↓ move the highlighted suggestion, Enter picks it and Esc closes the
 * list (without closing the surrounding modal).
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
  const showList = focused && !selected && !dismissed && input.trim().length >= 3;
  const waitingForDebounce = showList && input.trim() !== debounced;
  const suggestions = showList && !waitingForDebounce && !search.isLoading && !search.isError
    ? search.data ?? []
    : [];
  const listId = `${id}-suggestions`;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => setActiveIndex(-1), [debounced, search.data]);

  const handleChange = (nextValue: string) => {
    setInput(nextValue);
    setSelected(false);
    setDismissed(false);
    onChange(nextValue);
  };

  const chooseSuggestion = (suggestion: AddressSuggestion) => {
    setInput(suggestion.formatted);
    setSelected(true);
    setActiveIndex(-1);
    onChange(suggestion.formatted);
    onSelect(suggestion);
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
      // Enter on a highlighted suggestion picks it instead of submitting the form.
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        chooseSuggestion(suggestions[activeIndex]);
      }
    } else if (event.key === "Escape" && showList) {
      // Close only the list; keep the modal open.
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
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Search
          aria-hidden="true"
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Sugestões de endereço"
          className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-xl"
        >
          {waitingForDebounce || search.isLoading ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground" role="status">
              Buscando endereços…
            </p>
          ) : search.isError ? (
            <p className="px-3 py-2.5 text-xs text-amber-800" role="status">
              A busca de endereços está indisponível. Você ainda pode informar
              o endereço manualmente.
            </p>
          ) : suggestions.length ? (
            suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.formatted}-${index}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[#f7f6f4] ${index === activeIndex ? "bg-[#f7f6f4] ring-1 ring-inset ring-primary/40" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseSuggestion(suggestion)}
              >
                <MapPin
                  size={15}
                  className="mt-0.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>{suggestion.formatted}</span>
              </div>
            ))
          ) : debounced.length >= 3 && search.data ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground" role="status">
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
