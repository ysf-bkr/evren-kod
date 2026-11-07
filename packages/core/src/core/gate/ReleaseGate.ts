/**
 * Yayın kapısı motoru.
 *
 * Kural: kapı kararı bir iddia değil, kanıt zinciridir. Karar kaydedilirken
 * mevcut dosya listesi, işaretli kabul kriterleri ve doğrulama durumu bir
 * digest'e damgalanır; karardan sonra tek bir dosya bile değişse digest
 * farklılaşır ve karar bayat sayılır. "pass" yalnızca makine kontrolleri
 * gerçekten geçtiyse kaydedilebilir — modelin beyanı tek başına yetmez.
 */
import * as crypto from 'crypto';
import type { ReleaseGateRecord } from '../../shared/types';

/** Digest'e giren taze dünya görünümü. */
export interface GateWorldSnapshot {
  /** Tura göreli değişen dosya yolları. */
  files: readonly string[];
  /**
   * Değişen dosyaların içerik parmak izleri (varsa). YOL listesi yetmez:
   * aynı yolda sessizce değişen içerik kararı bayatlatmalı — digest bunu
   * kanıtlar. Bilinemiyorsa boş bırakılır (ör. yola erişim yok).
   */
  fileContents?: readonly { path: string; contentHash: string; size: number }[];
  /** İşaretlenmiş kabul kriteri kimlikleri. */
  criteriaDone: readonly string[];
  /** Doğrulama durumu (passed/skipped/not_run/…). */
  verificationStatus: string;
  /** Bağımsız inceleme bekleyen dosyalar (denetim defterinden). */
  unreviewed: readonly string[];
}

/** Değişiklik özeti: sıralamaya ve tekrarlı girdiye duyarsız, içeriğe duyarlı. */
export function computeChangesDigest(world: GateWorldSnapshot): string {
  const canonical = JSON.stringify({
    files: [...new Set(world.files)].sort(),
    contents: [...new Map((world.fileContents ?? []).map((f) => [f.path, f])).values()]
      .map((f) => `${f.path}:${f.contentHash}:${f.size}`)
      .sort(),
    criteriaDone: [...new Set(world.criteriaDone)].sort(),
    verificationStatus: world.verificationStatus,
    unreviewed: [...new Set(world.unreviewed)].sort()
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export interface GateMachineInput {
  /** Bu iş akışının onaylı bir spec'i var mı? */
  hasSpec: boolean;
  /** Kabul kriterlerinin tamamı işaretli mi? */
  criteriaMet: boolean;
  /** Doğrulama geçti ya da kabul edilebilir bir nedenle atlandı mı? */
  verificationPassed: boolean;
  /** Bağımsız inceleme görmeden kapıya gelen dosyalar (denetim defteri). */
  unreviewedChanges: readonly string[];
}

/**
 * "pass" beyanının makine denetimi. Dönen liste boşsa pass kaydedilebilir;
 * doluysa nedeni(leri) Türkçe metindir ve kayıt block'a çevrilir.
 */
export function machineCheckPass(input: GateMachineInput): string[] {
  const failures: string[] = [];
  if (!input.hasSpec) {
    failures.push("Bu iş akışında onaylı bir spec yok; kapı kararı spec'e bağlanamaz.");
  }
  if (!input.criteriaMet) {
    failures.push('Kabul kriterlerinin tamamı işaretli değil; işlenmeyen kriter varken kapı geçilemez.');
  }
  if (!input.verificationPassed) {
    failures.push('Doğrulama geçmedi ya da kararı geçersiz; test/lint sonucu taze ve başarılı olmalı.');
  }
  if (input.unreviewedChanges.length > 0) {
    const list = input.unreviewedChanges.slice(0, 8).join(', ');
    const rest =
      input.unreviewedChanges.length > 8 ? ` +${input.unreviewedChanges.length - 8} dosya daha` : '';
    failures.push(
      `Yazan uzmanın değişikliği bağımsız incelemeden geçmedi (${input.unreviewedChanges.length} dosya: ${list}${rest}); ` +
        'önce salt-okunur bir reviewer uzmanını (ör. @quality) denetleme için çağır.'
    );
  }
  return failures;
}

export interface GateFreshnessInput {
  /** Kararın ait olduğu spec; iş akışı değiştiyse karar geçersizdir. */
  currentSpecId?: string;
  /** Şu anki dünyanın digest'i. */
  currentDigest: string;
}

/**
 * Kayıt `done` kapısını açar mı? Bayat, yanlış spec'e ait ya da block
 * kararlı kayıt kapıyı açmaz; neden Türkçe döner.
 */
export function evaluateReleaseGate(
  record: ReleaseGateRecord | undefined,
  current: GateFreshnessInput
): { ok: boolean; reason?: string } {
  if (!record) {
    return {
      ok: false,
      reason:
        'Yayın kapısı kararı yok: @release-gate uzmanını çağır ve kararı record_release_gate ile kaydet.'
    };
  }
  if (!current.currentSpecId || record.specId !== current.currentSpecId) {
    return { ok: false, reason: "Kapı kararı bu görevin spec'ine ait değil; gate yeniden koşmalı." };
  }
  if (record.verdict !== 'pass') {
    return {
      ok: false,
      reason: `Yayın kapısı kararı BLOCK: ${record.reasons[0] || 'gerekçe belirtilmemiş'}`
    };
  }
  if (record.digest !== current.currentDigest) {
    return {
      ok: false,
      reason:
        'Kapı kararı kaydedildikten sonra dosya, kriter ya da doğrulama durumu değişti; gate yeniden koşmalı.'
    };
  }
  return { ok: true };
}

/** Karar kaydının kullanıcıya dönük Türkçe özeti (araç sonucu ve log için). */
export function formatGateRecord(record: ReleaseGateRecord): string {
  const lines = [
    `Yayın kapısı kararı: ${record.verdict === 'pass' ? 'PASS' : 'BLOCK'}`,
    `Spec: ${record.specId} | Doğrulama: ${record.verificationStatus} | Digest: ${record.digest}`
  ];
  if (record.reasons.length > 0) lines.push(`Gerekçe: ${record.reasons.join(' | ')}`);
  if (record.criteriaEvidence.length > 0) {
    lines.push(
      `Kriter kanıtları: ${record.criteriaEvidence.map((item) => `${item.id}→${item.note}`).join('; ')}`
    );
  }
  if (record.risks.length > 0) lines.push(`Riskler: ${record.risks.join(' | ')}`);
  lines.push(`Geri alma: ${record.rollback || '(belirtilmedi)'}`);
  return lines.join('\n');
}
