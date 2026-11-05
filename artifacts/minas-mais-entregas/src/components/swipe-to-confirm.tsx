import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export default function SwipeToConfirm({
  disabled,
  onConfirm,
  label = "Deslize para confirmar a entrega",
}: {
  disabled: boolean;
  onConfirm: () => void;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const confirmedRef = useRef(false);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const updateOffset = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  useEffect(() => {
    if (!disabled) {
      confirmedRef.current = false;
      updateOffset(0);
    }
  }, [disabled]);

  const maxOffset = () =>
    Math.max(
      0,
      (trackRef.current?.clientWidth ?? 0) -
        (thumbRef.current?.offsetWidth ?? 52) -
        8,
    );

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || confirmedRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startOffset: offsetRef.current };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || disabled) return;
    const nextOffset = Math.min(
      maxOffset(),
      Math.max(0, dragRef.current.startOffset + event.clientX - dragRef.current.startX),
    );
    updateOffset(nextOffset);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const max = maxOffset();
    if (max > 0 && offsetRef.current >= max * 0.82 && !disabled) {
      confirmedRef.current = true;
      updateOffset(max);
      onConfirm();
    } else {
      updateOffset(0);
    }
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setDragging(false);
    updateOffset(0);
  };

  const confirmByButton = () => {
    if (disabled || confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <div className="space-y-2" role="group" aria-label="Confirmar entrega">
      <div
        ref={trackRef}
        className={`relative h-14 overflow-hidden rounded-xl border border-[#e6d5d7] bg-[#fff7f7] ${disabled ? "opacity-60" : ""}`}
        style={{ touchAction: "pan-y" }}
      >
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center px-14 text-center text-xs font-semibold text-[#8d2832] transition-opacity"
          style={{ opacity: Math.max(0.15, 1 - offset / Math.max(1, maxOffset())) }}
        >
          {disabled ? "Aguarde a confirmação…" : label}
        </span>
        <button
          ref={thumbRef}
          type="button"
          className="absolute left-1 top-1 grid h-12 w-12 place-items-center rounded-lg bg-[#E20210] text-white shadow-sm disabled:cursor-wait"
          style={{
            transform: `translateX(${offset}px)`,
            transition: dragging ? "none" : "transform 180ms ease",
            touchAction: "pan-y",
          }}
          aria-label={label}
          aria-busy={disabled}
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {disabled ? <LoaderCircle size={19} className="animate-spin" /> : <ChevronRight size={22} />}
        </button>
      </div>
      <button
        className="button-quiet min-h-9 w-full justify-center text-xs"
        type="button"
        disabled={disabled}
        onClick={confirmByButton}
      >
        Ou toque para confirmar
      </button>
    </div>
  );
}
