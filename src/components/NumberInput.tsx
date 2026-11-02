import { useState } from "react";

export function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  // Texto propio mientras se escribe: permite dejar el campo vacío; se ajusta al rango al salir.
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      inputMode="numeric"
      value={text ?? value}
      min={min}
      max={max}
      onChange={(e) => {
        setText(e.target.value);
        const n = Math.round(Number(e.target.value));
        if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      onBlur={() => setText(null)}
      className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-1.5 font-normal text-ink"
    />
  );
}
