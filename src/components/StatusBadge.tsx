export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = value.toLowerCase().replace(/_/g, "-");
  return <span className={`badge badge-${tone}`}>{label ?? value.replaceAll("_", " ")}</span>;
}
