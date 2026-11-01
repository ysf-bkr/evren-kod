/**
 * Araç hattı için saf yardımcı fonksiyonlar.
 *
 * Sınıf bağlamına bağlı olmayan, `toolPipelineController.ts`'den ayrılmış
 * salt veri dönüşüm fonksiyonları burada tutulur.
 */

/** Araç argümanından metin okur. */
export function toolArgString(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Araç argümanından boolean okur. */
export function toolArgBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true || args[key] === 'true';
}
