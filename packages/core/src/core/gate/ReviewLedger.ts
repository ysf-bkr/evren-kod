/**
 * Denetim defteri (Review Ledger).
 *
 * Sözleşme: bir uzmanın yazdığı değişiklik, ondan BAĞIMSIZ bir reviewer rolü
 * (kalite/güvenlik/mimari kategorisindeki salt-okunur uzman) görene kadar
 * yayın kapısından geçemez. Defter saf fonksiyonlarla işlenir; kalıcılığı
 * `WorkflowState.reviewLedger` üzerinden konağın durum dosyasında durur.
 */
import type { AgentCategory, ReviewLedgerEntry } from '../../shared/types';

/** Deftere yazılacak en fazla giriş; eski incelemeler sıkıştırılıp atılır. */
const MAX_ENTRIES = 200;

/** Incelemeye yetkili katalog kategorileri: kod yazmayan, denetleyen uzmanlar. */
export const REVIEWER_CATEGORIES: ReadonlySet<AgentCategory> = new Set<AgentCategory>([
  'quality',
  'security',
  'architecture'
]);

/**
 * Yazma olayını deftere işler. Aynı dosya yeniden yazılırsa eski inceleme
 * kararı geçersizdir: giriş, incelemesiz olarak en yeni hâliyle tazelenir.
 */
export function recordWrites(
  ledger: readonly ReviewLedgerEntry[],
  writer: string,
  files: readonly string[],
  at = new Date().toISOString()
): ReviewLedgerEntry[] {
  const touched = new Set([...new Set(files)].filter(Boolean).map(normalizeFile));
  if (touched.size === 0) return [...ledger];
  const kept = ledger.filter((entry) => !touched.has(entry.file));
  const fresh: ReviewLedgerEntry[] = [...touched].sort().map((file) => ({ file, writer, at }));
  return [...kept, ...fresh].slice(-MAX_ENTRIES);
}

/** Hâlâ bağımsız inceleme bekleyen dosyalar; sıralı ve benzersiz. */
export function unreviewedFiles(ledger: readonly ReviewLedgerEntry[]): string[] {
  return [...new Set(ledger.filter((entry) => !entry.reviewedBy).map((entry) => entry.file))].sort();
}

/**
 * Reviewer turunun tamamlandığını deftere işler. Kapsama kuralı dürüsttür:
 * yalnızca reviewer'ın GERÇEKTEN okuduğu dosyalar "incelendi" sayılır;
 * okunmamış borç yerinde kalır. Kendi yazdığını kendi inceleyemez —
 * bağımsızlık makinece uygulanır, niyete bırakılmaz.
 */
export function markReviewed(
  ledger: readonly ReviewLedgerEntry[],
  reviewer: string,
  seenFiles?: Iterable<string>
): ReviewLedgerEntry[] {
  const seen = seenFiles ? new Set([...seenFiles].map(normalizeFile)) : undefined;
  return ledger.map((entry) => {
    if (entry.reviewedBy || entry.writer === reviewer) return entry;
    // Gölge borç (`command:*`): hangi dosyanın değiştiği ölçülememiş; dosya
    // okunarak kapatılamaz. Herhangi bir bağımsız denetim turu kapatır.
    const covered = !seen || entry.file.startsWith('command:') || seen.has(entry.file);
    return covered ? { ...entry, reviewedBy: reviewer } : entry;
  });
}

/** Windows ayraçları ve göreli noktalı yollar tek biçime gelir. */
export function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}
