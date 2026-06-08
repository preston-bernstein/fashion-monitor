export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + Number(n).toFixed(0);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat().format(n);
}
