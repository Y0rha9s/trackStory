import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MesoSample } from "../core/mesos";
import { fmtCompact, fmtInt } from "../hooks";

/** Total de mesos a lo largo de la sesión, con una línea en el valor inicial. */
export function MesoChart({ samples }: { samples: MesoSample[] }) {
  if (samples.length < 2) {
    return <p className="py-8 text-center text-sm text-ink-soft">El gráfico aparece con la segunda lectura de mesos.</p>;
  }
  const start = samples[0].amount;
  const data = samples.map((s) => ({ t: s.t, amount: s.amount }));
  const min = Math.min(...data.map((d) => d.amount));
  const max = Math.max(...data.map((d) => d.amount));
  const pad = Math.max(1000, (max - min) * 0.15);
  // Con rangos chicos hacen falta más decimales para que las marcas del eje no se repitan.
  const range = max + pad - Math.max(0, min - pad);
  const tick = (v: number) =>
    v >= 1e6 ? `${(v / 1e6).toLocaleString("es-CL", { maximumFractionDigits: range < 200_000 ? 3 : 2 })} M` : fmtCompact(v);
  const hhmm = (t: number) => new Date(t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="mesoFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5c542" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#f5c542" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={hhmm} stroke="var(--ink-soft)" fontSize={12} />
          <YAxis domain={[Math.max(0, min - pad), max + pad]} tickFormatter={(v) => tick(Number(v))} stroke="var(--ink-soft)" fontSize={12} width={64} />
          <ReferenceLine y={start} stroke="var(--ink-soft)" strokeDasharray="4 4" label={{ value: "inicio", position: "insideTopLeft", fill: "var(--ink-soft)", fontSize: 12 }} />
          <Tooltip
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
            labelFormatter={(v) => hhmm(Number(v))}
            formatter={(v) => {
              const n = Number(v);
              const d = n - start;
              return [`${fmtInt(n)} (${d >= 0 ? "+" : "−"}${fmtInt(Math.abs(d))})`, "Mesos"];
            }}
          />
          <Area type="stepAfter" dataKey="amount" stroke="#a8740c" strokeWidth={2} fill="url(#mesoFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
