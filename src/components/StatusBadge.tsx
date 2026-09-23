export function StatusBadge({ value }: { value: string }) {
  const tone = value.toLowerCase().replace(/_/g, "-");
  return <span className={`badge badge-${tone}`}>{value.replaceAll("_", " ")}</span>;
}
