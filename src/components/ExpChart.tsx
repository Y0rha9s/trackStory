import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Sample } from "../core/metrics";
import { totalExp } from "../core/expTable";
import { fmtCompact, fmtInt } from "../hooks";

/** EXP ganada en la sesión a lo largo del tiempo. */
export function ExpChart({ samples }: { samples: Sample[] }) {
  if (samples.length < 2) {
    return <p className="py-12 text-center text-ink-soft">El gráfico aparece con la segunda lectura.</p>;
  }
  const t0 = samples[0].t;
  const base = totalExp(samples[0].level, samples[0].exp);
  const data = samples.map((s) => ({ min: (s.t - t0) / 60000, gained: totalExp(s.level, s.exp) - base, level: s.level }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--exp)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--exp)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeOpacity={0.5} vertical={false} />
          <XAxis
            dataKey="min"
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={(v) => fmtMinutes(Number(v))}
            stroke="var(--ink-soft)"
            fontSize={12}
          />
          <YAxis tickFormatter={(v) => fmtCompact(v)} stroke="var(--ink-soft)" fontSize={12} width={52} />
          <Tooltip
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
            labelFormatter={(v) => `A los ${fmtMinutes(Number(v))}`}
            formatter={(v, _n, p) => [`${fmtInt(Number(v))} EXP (nivel ${p.payload.level})`, "Ganada"]}
          />
          <Area type="monotone" dataKey="gained" stroke="color-mix(in oklab, var(--exp) 60%, #2f4a07)" strokeWidth={2.5} fill="url(#expFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 0.5 → "0:30", 12.25 → "12:15", 75 → "1 h 15" */
function fmtMinutes(min: number) {
  const s = Math.round(min * 60);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
