/**
 * Denetim defteri (Review Ledger).
 *
 * Sözleşme: bir uzmanın yazdığı değişiklik, ondan BAĞIMSIZ bir reviewer rolü
 * (kalite/güvenlik/mimari kategorisindeki salt-okunur uzman) görene kadar
 * yayın kapısından geçemez. Defter saf fonksiyonlarla işlenir; kalıcılığı
 * `WorkflowState.reviewLedger` üzerinden konağın durum dosyasında durur.
 *
 * Kanıt ilkesi: "okudum" beyanı değil, inceleme anındaki İÇERİK HASH'î esas
 * alınır. mtime yardımcı metadata bile değildir; kanıt contentHash + size +
 * snapshotId üçlüsüdür. Kapı denetimi bu kanıtı tazeler dosyayla karşılaştırır;
 * tek bayt değişen inceleme bayat sayılır ve borç yeniden doğar.
 */
import * as crypto from 'crypto';
import type { AgentCategory, ReviewedFileEvidence, ReviewLedgerEntry } from '../../shared/types';

/** Deftere yazılacak en fazla giriş; eski incelemeler sıkıştırılıp atılır. */
const MAX_ENTRIES = 200;

/** Ölçülemeyen komut yan etkisi kanıtı: dosya okunamadığı için hash yok. */
export const SHADOW_REVIEW_HASH = 'shadow';

/** İncelemeye yetkili katalog kategorileri: kod yazmayan, denetleyen uzmanlar. */
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
 * yalnızca reviewer'ın GERÇEKTEN okuduğu dosyalar — okuma anındaki içerik
 * hash'iyle kanıtlanmış biçimde — "incelendi" sayılır; okunmamış borç yerinde
 * kalır. Kendi yazdığını kendi inceleyemez — bağımsızlık makinece uygulanır,
 * niyete bırakılmaz.
 *
 * `evidence`: okunan her dosya için okuma anında üretilmiş kanıt. Gölge borç
 * (`command:*`) dosya okunarak kapatılamaz; herhangi bir bağımsız tur onu
 * kanıtsız-kapsanmış sayar ve ölçülemezlik etiketiyle damgalar.
 */
export function markReviewed(
  ledger: readonly ReviewLedgerEntry[],
  reviewer: string,
  evidence?: Iterable<ReviewedFileEvidence>
): ReviewLedgerEntry[] {
  const list = evidence ? [...evidence] : undefined;
  const byPath = list ? new Map(list.map((item) => [normalizeFile(item.path), item])) : undefined;
  // Kanıt yoksa (test/uyumluluk) eski anlam korunur: tamamı okunmuş sayılır.
  const coveredAll = !list;
  const shadowSample = list?.find((item) => item.contentHash === SHADOW_REVIEW_HASH);
  return ledger.map((entry) => {
    if (entry.reviewedBy || entry.writer === reviewer) return entry;
    if (entry.file.startsWith('command:')) {
      if (!coveredAll && !byPath?.has(entry.file) && !shadowSample) return entry;
      const source = byPath?.get(entry.file) ?? shadowSample;
      const at = source?.reviewedAt ?? new Date().toISOString();
      return {
        ...entry,
        reviewedBy: reviewer,
        review: {
          path: entry.file,
          contentHash: SHADOW_REVIEW_HASH,
          size: 0,
          reviewedAt: at,
          reviewerId: reviewer,
          snapshotId: source?.snapshotId ?? 'unmeasurable'
        }
      };
    }
    const covered = coveredAll || byPath?.has(entry.file);
    if (!covered) return entry;
    const item = byPath?.get(entry.file);
    if (!item) {
      // Kanıtsız kapanış ancak eski sürüm uyumluluğu içindir; kapı denetimi
      // kanıtsız kaydı güvenilmez sayıp borcu yeniden açar (fail closed).
      return { ...entry, reviewedBy: reviewer };
    }
    return {
      ...entry,
      reviewedBy: reviewer,
      review: { ...item, path: entry.file, reviewerId: reviewer }
    };
  });
}

/** Gate anındaki dosya dünyasının tek dosyalık parmak izi. */
export interface FileFingerprint {
  contentHash: string;
  size: number;
}

/**
 * Kapı denetimi öncesi defteri dünyayla yüzleştirir (fail closed):
 * - kanıtsız "incelendi" kaydı (tahrif/eski sürüm) → borç yeniden açık;
 * - içerik hash'i veya boyu tutmayan inceleme → BAYAT, borç yeniden açık;
 * - dünyada artık bulunmayan yol (geri alınmış/silinmiş değişiklik) → giriş
 *   düşürülür; dosya geri gelirse yazım olayı zaten yeni kayıt açar.
 * Dönen `reasons` kapı gerekçelerine eklenir; `changed` defterin değişip
 * değişmediğini söyler.
 */
export function verifyLedgerFreshness(
  ledger: readonly ReviewLedgerEntry[],
  currentFiles: ReadonlyMap<string, FileFingerprint> | undefined
): { ledger: ReviewLedgerEntry[]; reasons: string[]; changed: boolean } {
  const reasons: string[] = [];
  let changed = false;
  const next: ReviewLedgerEntry[] = [];
  for (const entry of ledger) {
    if (entry.file.startsWith('command:')) {
      next.push(entry);
      continue;
    }
    // Dünyada olmayan yol: değişiklik geri alındı ya da dosya silindi.
    // Yeni yol olarak dönerse yazım/porcelain taraması zaten borç açar.
    if (currentFiles && !currentFiles.has(entry.file)) {
      changed = true;
      continue;
    }
    if (entry.reviewedBy && !entry.review) {
      reasons.push(`${entry.file}: inceleme kaydı kanıtsız; borç yeniden açık.`);
      changed = true;
      // Borç DİRİLTİLİR (entry düşürülmez): kapı yine de inceleme görmek ister.
      next.push({ file: entry.file, writer: entry.writer, at: entry.at });
      continue;
    }
    if (entry.review && currentFiles) {
      const now = currentFiles.get(entry.file);
      if (entry.review.contentHash !== SHADOW_REVIEW_HASH && now) {
        if (now.contentHash !== entry.review.contentHash || now.size !== entry.review.size) {
          reasons.push(`${entry.file}: incelemeden sonra içerik değişti; inceleme bayat.`);
          changed = true;
          // Kanıt düşer, borç yeniden doğar.
          next.push({ file: entry.file, writer: entry.writer, at: entry.at });
          continue;
        }
      }
    }
    next.push(entry);
  }
  return { ledger: next, reasons, changed };
}

/**
 * Değişen dosyaların içerik-hash'li dünya anlık görüntüsü kimliği.
 * Reviewer kanıtları bu kimliğe bağlanır; tek dosyanın tek baytı değişirse
 * snapshot kimliği de değişir.
 */
export function computeWorldSnapshotId(files: ReadonlyMap<string, FileFingerprint>): string {
  const canonical = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, fp]) => `${path}:${fp.contentHash}:${fp.size}`)
    .join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Windows ayraçları ve göreli noktalı yollar tek biçime gelir. */
export function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}
