/** Araç tanımları için paylaşılan argüman yardımcıları. */
export function argString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function argBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Pozitif tam sayıya çevirir; `max` verilirse üst sınırdan kırpılır (çılgan limitleri durdurur). */
export function toPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(parsed, max) : fallback;
}
