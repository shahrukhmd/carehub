type Point = { date: Date; areaCm2: number | null };

export function WoundTrendChart({ points }: { points: Point[] }) {
  const data = points.filter((p): p is { date: Date; areaCm2: number } => p.areaCm2 !== null);

  if (data.length < 2) {
    return <p className="muted">Record area (length &times; width) on at least two visits to see a healing trend.</p>;
  }

  const width = 560;
  const height = 180;
  const padding = { top: 12, right: 16, bottom: 24, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxArea = Math.max(...data.map((d) => d.areaCm2), 0.1);
  const minTime = data[0].date.getTime();
  const maxTime = data[data.length - 1].date.getTime();
  const timeSpan = Math.max(maxTime - minTime, 1);

  const toXY = (p: { date: Date; areaCm2: number }) => {
    const x = padding.left + ((p.date.getTime() - minTime) / timeSpan) * plotWidth;
    const y = padding.top + plotHeight - (p.areaCm2 / maxArea) * plotHeight;
    return [x, y];
  };

  const pathD = data
    .map((p, i) => {
      const [x, y] = toXY(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Wound area healing trend">
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={padding.top + plotHeight}
        stroke="var(--line, #d9d0c3)"
      />
      <line
        x1={padding.left}
        y1={padding.top + plotHeight}
        x2={padding.left + plotWidth}
        y2={padding.top + plotHeight}
        stroke="var(--line, #d9d0c3)"
      />
      <text x={4} y={padding.top + 4} fontSize="10" fill="var(--muted, #5c6b66)">
        {maxArea.toFixed(1)}
      </text>
      <text x={4} y={padding.top + plotHeight} fontSize="10" fill="var(--muted, #5c6b66)">
        0
      </text>
      <path d={pathD} fill="none" stroke="var(--teal, #1f6f64)" strokeWidth={2} />
      {data.map((p, i) => {
        const [x, y] = toXY(p);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--teal, #1f6f64)" />;
      })}
      <text x={padding.left} y={height - 4} fontSize="10" fill="var(--muted, #5c6b66)">
        {formatDate(data[0].date)}
      </text>
      <text x={padding.left + plotWidth} y={height - 4} fontSize="10" fill="var(--muted, #5c6b66)" textAnchor="end">
        {formatDate(data[data.length - 1].date)}
      </text>
    </svg>
  );
}
