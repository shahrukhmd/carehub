import { PERCENTILE_LINES, chartSeries, percentileText, type GrowthMeasure } from "@/lib/growth-charts";

// One CDC growth chart as inline SVG: the 3rd–97th percentile curves with the patient's measurements plotted.
export function GrowthChart({ measure, sex, points }: { measure: GrowthMeasure; sex: "M" | "F"; points: { at: Date; ageMonths: number; value: number }[] }) {
  const s = chartSeries(measure, sex, points);
  const W = 640;
  const H = 400;
  const pad = { l: 46, r: 30, t: 18, b: 34 };
  const xs = s.ages;
  const allValues = [...s.lines.flatMap((l) => l.values), ...s.points.map((p) => p.value)].filter((v) => v > 0);
  const yMin = Math.floor(Math.min(...allValues) * 0.95);
  const yMax = Math.ceil(Math.max(...allValues) * 1.05);
  const x = (age: number) => pad.l + ((age - s.measure.ageMin) / (s.measure.ageMax - s.measure.ageMin)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const infant = s.measure.ageMax <= 36;
  const xTicks = infant ? xs.filter((a) => a % 3 === 0) : xs.filter((a) => a % 24 === 0);
  const yStep = yMax - yMin > 60 ? 10 : yMax - yMin > 25 ? 5 : yMax - yMin > 10 ? 2 : 1;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  const major = new Set([3, 50, 97]);

  return (
    <figure className="gc-chart">
      <figcaption>
        <strong>{s.measure.label}</strong> <span className="muted">· {sex === "F" ? "girls" : "boys"} · CDC 2000</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={s.measure.label}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="gc-grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="gc-tick">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((a) => (
          <g key={a}>
            <line x1={x(a)} x2={x(a)} y1={pad.t} y2={H - pad.b} className="gc-grid" />
            <text x={x(a)} y={H - pad.b + 16} textAnchor="middle" className="gc-tick">
              {infant ? `${a}m` : `${a / 12}y`}
            </text>
          </g>
        ))}
        <text x={(W + pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="gc-tick">
          Age
        </text>
        <text x={12} y={(H - pad.b + pad.t) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - pad.b + pad.t) / 2})`} className="gc-tick">
          {s.measure.unit}
        </text>
        {s.lines.map((l) => (
          <g key={l.pct}>
            <polyline points={xs.map((a, i) => `${x(a)},${y(l.values[i])}`).join(" ")} className={`gc-line${major.has(l.pct) ? " gc-major" : ""}`} />
            <text x={W - pad.r + 3} y={y(l.values[l.values.length - 1]) + 3} className="gc-pct">
              {l.pct}
            </text>
          </g>
        ))}
        {s.points.length > 1 && <polyline points={s.points.map((p) => `${x(p.ageMonths)},${y(p.value)}`).join(" ")} className="gc-patient" />}
        {s.points.map((p, i) => (
          <g key={i}>
            <circle cx={x(p.ageMonths)} cy={y(p.value)} r={4} className="gc-dot">
              <title>
                {p.at.toISOString().slice(0, 10)} · {p.value} {s.measure.unit} · {percentileText(p.percentile)} percentile
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <p className="muted gc-legend">Lines: {PERCENTILE_LINES.join(", ")}th percentiles. Hover a point for its value and percentile.</p>
    </figure>
  );
}
