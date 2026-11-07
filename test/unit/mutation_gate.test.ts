/**
 * Sabotaj (guard) testleri: kanıt katmanının kritik değişmezleri.
 *
 * Anlamı INVARIANTS.md'de tanımlı; bu dosya o değişmezlerin TESTLE KANITLANIR
 * olduğunu gösterir. Yöntem: kanıt kontrolünü "sabote etmiş" bir dünyayı
 * sözleşme üzerinden kur (sahte PASS kaydı, ters çevrilmiş makine girdisi,
 * kapsamasız kapanış) ve gerçek uygulamanın bunu REDDETTİĞİNİ doğrula.
 * Bir sabote girdi test geçmeye devam ederse kör nokta oradadır.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeChangesDigest,
  machineCheckPass,
  evaluateReleaseGate
} from '@evren-kod/core/core/gate/ReleaseGate';
import { gateForStage, createWorkflowState } from '@evren-kod/core/core/workflow/TaskWorkflow';
import {
  recordWrites,
  markReviewed,
  unreviewedFiles,
  normalizeFile,
  verifyLedgerFreshness,
  computeWorldSnapshotId,
  type FileFingerprint
} from '@evren-kod/core/core/gate/ReviewLedger';
import type {
  ReleaseGateRecord,
  ReviewLedgerEntry,
  ReviewedFileEvidence
} from '@evren-kod/core/shared/types';

/** Saf defter testi için biçimce geçerli okuma kanıtı. */
function ev(...paths: string[]): ReviewedFileEvidence[] {
  return paths.map((path) => ({
    path,
    contentHash: `hash:${path}`,
    size: 10,
    reviewedAt: '2026-01-01T00:00:00.000Z',
    reviewerId: 'reviewer',
    snapshotId: 'snap-1'
  }));
}

/** Ölçülemeyen komut kaydı için gölge kanıt. */
function shadow(path: string): ReviewedFileEvidence {
  return {
    path,
    contentHash: 'shadow',
    size: 0,
    reviewedAt: '2026-01-01T00:00:00.000Z',
    reviewerId: 'reviewer',
    snapshotId: 'snap-1'
  };
}

const GREEN = {
  hasSpec: true,
  criteriaMet: true,
  verificationPassed: true,
  unreviewedChanges: [] as string[]
};

const WORLD = {
  files: ['src/a.ts', 'src/b.ts'],
  criteriaDone: ['ac-1'],
  verificationStatus: 'passed',
  unreviewed: [] as string[]
};

function passRecord(overrides: Partial<ReleaseGateRecord> = {}): ReleaseGateRecord {
  return {
    specId: 'spec-1',
    verdict: 'pass',
    reasons: ['tam denetim'],
    criteriaEvidence: [{ id: 'ac-1', note: 'test' }],
    risks: [],
    rollback: 'git revert',
    verificationStatus: 'passed',
    digest: computeChangesDigest(WORLD),
    recordedAt: new Date().toISOString(),
    recordedBy: 'release-gate',
    ...overrides
  };
}

describe('Sabotaj: doğrulama zinciri tek tek koparılamaz', () => {
  test('makine denetimi: tüm girdiler yeşilken kapı açık, her tek girdi çöküşü yakalanır', () => {
    // Sabote girdi üretemeyen (gerçek) makine denetimi boş liste vermeli...
    assert.deepEqual(machineCheckPass(GREEN), []);
    // ...her sabotaj senaryosu ayrı bir red üretmeli:
    assert.equal(machineCheckPass({ ...GREEN, hasSpec: false }).length, 1); // "spec yok" mutasyonu
    assert.equal(machineCheckPass({ ...GREEN, criteriaMet: false }).length, 1); // kriter atlama
    assert.equal(machineCheckPass({ ...GREEN, verificationPassed: false }).length, 1); // sahte test geçişi
    assert.equal(machineCheckPass({ ...GREEN, unreviewedChanges: ['src/a.ts'] }).length, 1); // borç atlama
    // hepsi birden: dört ayrı gerekçe, biri bile yutulmaz
    const all = machineCheckPass({
      hasSpec: false,
      criteriaMet: false,
      verificationPassed: false,
      unreviewedChanges: ['src/a.ts', 'src/b.ts']
    });
    assert.equal(all.length, 4);
    assert.ok(all.some((r) => r.includes('src/a.ts'))); // borç listesi kullanıcıya görünür
  });

  test('tazelik kanıtı çıkarılamaz: içerik, kriter, doğrulama, borç değişimi digesti kırar', () => {
    const base = computeChangesDigest(WORLD);
    // "hash karşılaştırması kaldırılsın" sabotajının vurulduğu alanlar:
    assert.notEqual(base, computeChangesDigest({ ...WORLD, files: [...WORLD.files, 'src/c.ts'] })); // yeni dosya
    assert.notEqual(base, computeChangesDigest({ ...WORLD, files: ['src/a.ts'] })); // silinen dosya
    assert.notEqual(base, computeChangesDigest({ ...WORLD, files: ['src/a.ts', 'src/b_renamed.ts'] })); // yeniden adlandırma
    assert.notEqual(base, computeChangesDigest({ ...WORLD, criteriaDone: [] })); // kriter geri alındı
    assert.notEqual(base, computeChangesDigest({ ...WORLD, verificationStatus: 'failed' })); // doğrulama düştü
    assert.notEqual(base, computeChangesDigest({ ...WORLD, unreviewed: ['src/c.ts'] })); // yeni borç
  });

  test('uydurma PASS kaydı done kapısını açamaz', () => {
    const world = computeChangesDigest(WORLD);
    const ctx = {
      state: createWorkflowState({ stage: 'verify', specApproved: true, planApproved: true }),
      hasApprovedSpec: true,
      hasPlan: true,
      hasModules: true,
      criteriaMet: true,
      verificationPassed: true,
      releaseGatePassed: false
    };
    // Doğru digest + spec: tek meşru geçiş yolu bu, ve kapı PASS'i SORAR.
    assert.equal(gateForStage('done', ctx, 'code').allowed, false);
    // Uydurma karar nesnesi (yanlış digest) evaluate'ı geçemez:
    const forged = passRecord({ digest: 'deadbeefdeadbeef' });
    assert.equal(evaluateReleaseGate(forged, { currentSpecId: 'spec-1', currentDigest: world }).ok, false);
    // Yanlış spec'e ait PASS başka görevin kapısını açamaz:
    assert.equal(
      evaluateReleaseGate(passRecord(), { currentSpecId: 'spec-2', currentDigest: world }).ok,
      false
    );
    // Kayıt hiç yoksa da kapalı:
    assert.equal(evaluateReleaseGate(undefined, { currentSpecId: 'spec-1', currentDigest: world }).ok, false);
    // Doğru dünya + doğru spec: geçiş ancak GERÇEK taze PASS ile açılır.
    assert.equal(
      evaluateReleaseGate(passRecord(), { currentSpecId: 'spec-1', currentDigest: world }).ok,
      true
    );
  });
});

describe('Sabotaj: denetim defteri kuralları atlatılamaz', () => {
  test('kendi yazan incelemez — bağımsızlık kontrolü kaldırılamaz', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    // writer'ın kendi turu borcu kapatamaz
    ledger = markReviewed(ledger, 'backend', ev('src/a.ts'));
    assert.deepEqual(unreviewedFiles(ledger), ['src/a.ts']);
    // bağımsız reviewer okuduysa kanıtla kapanır
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    assert.deepEqual(unreviewedFiles(ledger), []);
    assert.equal(ledger[0]?.reviewedBy, 'quality');
    assert.equal(ledger[0]?.review?.contentHash, 'hash:src/a.ts', 'içerik kanıtı bağlanmalı');
    assert.equal(ledger[0]?.review?.reviewerId, 'quality');
  });

  test('okumadan kapanmaz — seenFiles kontrolü kaldırılamaz', () => {
    const ledger = recordWrites([], 'frontend', ['src/a.ts', 'src/b.ts']);
    // boş okuma kümesi hiçbir dosya borcunu kapatmaz
    const untouched = markReviewed(ledger, 'quality', []);
    assert.deepEqual(unreviewedFiles(untouched), ['src/a.ts', 'src/b.ts']);
    // kısmi okuma yalnız okunanı kapatır
    const partial = markReviewed(ledger, 'quality', ev('src/a.ts'));
    assert.deepEqual(unreviewedFiles(partial), ['src/b.ts']);
  });

  test('gölge borç ayrımı: ölçülemez kayıt denetim kanıtıyla kapanır, dosya borcu kapanmaz', () => {
    const ledger = recordWrites([], 'manager', ['src/a.ts', 'command:run-1']);
    // hiçbir şey okumayan tur hiçbir borcu kapatmaz (denetim sayılmaz)
    const idle = markReviewed(ledger, 'security', []);
    assert.deepEqual(unreviewedFiles(idle), ['command:run-1', 'src/a.ts']);
    // kendi yazan (manager) gölge borcu da kapatamaz
    const selfRun = markReviewed(ledger, 'manager', [shadow('command:run-1')]);
    assert.deepEqual(unreviewedFiles(selfRun), ['command:run-1', 'src/a.ts']);
    // dosya okumak gölge borcu KAPATMAZ: ölçülemezlik kanıtı ayrıdır
    const filesOnly = markReviewed(ledger, 'security', ev('src/a.ts'));
    assert.deepEqual(unreviewedFiles(filesOnly), ['command:run-1']);
    // dosya + gölge kanıtı birlikte ikisini de kapatır
    const full = markReviewed(ledger, 'security', [...ev('src/a.ts'), shadow('command:run-1')]);
    assert.deepEqual(unreviewedFiles(full), []);
  });

  test('yazma eski incelemeyi geçersiz kılar — sil-yaz ile borç sıfırlanamaz', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    assert.deepEqual(unreviewedFiles(ledger), []);
    // aynı dosya yeniden yazılırsa karar bayatlar: borç yeniden doğar
    ledger = recordWrites(ledger, 'backend', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/a.ts']);
    assert.equal(ledger[0]?.reviewedBy, undefined);
  });

  test('defter durum günlüğünden geçerek bozulmadan döner (JSON round-trip)', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    ledger = recordWrites(ledger, 'security', ['command:c-1']);
    const revived: ReviewLedgerEntry[] = JSON.parse(JSON.stringify(ledger));
    assert.deepEqual(unreviewedFiles(revived), ['command:c-1']);
    // kanıt nesnesi de gidiş-dönümden sağ çıkar
    assert.equal(revived[0]?.review?.contentHash, 'hash:src/a.ts');
    // digest defter içeriğine duyarlıdır ve dönüşümde sabittir
    const a = computeChangesDigest({ ...WORLD, unreviewed: unreviewedFiles(ledger) });
    const b = computeChangesDigest({ ...WORLD, unreviewed: unreviewedFiles(revived) });
    assert.equal(a, b);
  });

  test('girdi temizliği: yol biçimleri ve boş girdiler defteri zehirleyemez', () => {
    const ledger = recordWrites([], 'backend', ['./src/a.ts', 'src\\b.ts', '', 'src/a.ts']);
    assert.deepEqual(
      ledger.map((e) => e.file),
      ['src/a.ts', 'src/b.ts']
    );
    // normalizeFile hem Windows hem göreli biçimi tekilleştirir
    assert.equal(normalizeFile('.\\src/c.ts'), 'src/c.ts');
    // boş yazma listesi deftere dokunmaz
    assert.deepEqual(recordWrites(ledger, 'backend', []), ledger);
  });

  test('defter büyüklüğü sınırlıdır: uzun görevde sınırsız büyümeyebilir', () => {
    const ledger = recordWrites(
      [],
      'backend',
      Array.from({ length: 300 }, (_, i) => `f${i}.ts`)
    );
    assert.ok(ledger.length <= 200, `defter sınırı aşıldı: ${ledger.length}`);
    // sınır aşımında en yeniler korunur (borç kaybolmaz: kalanlar yine inceleme bekler)
    assert.ok(unreviewedFiles(ledger).length > 0);
  });
});

describe('Sabotaj: içerik kanıtı olmadan inceleme ayakta kalamaz (fail closed)', () => {
  const fp = (contentHash: string, size = 10): FileFingerprint => ({ contentHash, size });

  test('kanıtsız "incelendi" kaydı (tahrif/eski sürüm) borca döner', () => {
    const tampered: ReviewLedgerEntry[] = [
      { file: 'src/a.ts', writer: 'backend', reviewedBy: 'quality', at: 't' }
    ];
    const res = verifyLedgerFreshness(tampered, new Map([['src/a.ts', fp('hash:src/a.ts')]]));
    assert.deepEqual(unreviewedFiles(res.ledger), ['src/a.ts']);
    assert.ok(res.reasons.some((r) => r.includes('kanıtsız')));
    assert.equal(res.changed, true);
  });

  test('incelemeden sonra içerik değişirse kanıt bayatlar, borç yeniden doğar', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    // "hash karşılaştırması kaldırılsın" sabotajı bu testle geri alınır:
    const res = verifyLedgerFreshness(ledger, new Map([['src/a.ts', fp('DEĞİŞMİŞ-İÇERİK')]]));
    assert.deepEqual(unreviewedFiles(res.ledger), ['src/a.ts']);
    assert.ok(res.reasons.some((r) => r.includes('bayat')));
    // aynı içerik + aynı boy: kanıt durur, borç açılmaz
    const clean = verifyLedgerFreshness(ledger, new Map([['src/a.ts', fp('hash:src/a.ts')]]));
    assert.deepEqual(unreviewedFiles(clean.ledger), []);
    assert.equal(clean.changed, false);
  });

  test('boy farkı tek başına da yakalanır', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    const res = verifyLedgerFreshness(ledger, new Map([['src/a.ts', fp('hash:src/a.ts', 999)]]));
    assert.deepEqual(unreviewedFiles(res.ledger), ['src/a.ts']);
  });

  test('dünyadan düşen yol (geri alınan/silinen değişiklik) defterden düşer; gölge kayıt durur', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ev('src/a.ts'));
    ledger = recordWrites(ledger, 'manager', ['command:run-9']);
    const res = verifyLedgerFreshness(ledger, new Map()); // src/a.ts artık dünyada yok
    assert.deepEqual(
      res.ledger.map((e) => e.file),
      ['command:run-9']
    );
    // silinmiş dosya hayalet borç üretmez; gölge kayıt olduğu gibi kalır
    assert.equal(res.reasons.length, 0);
  });

  test('gölge kanıt hash kıyaslamasından muaftır (dosya yok ki)', () => {
    let ledger = recordWrites([], 'manager', ['command:run-1']);
    ledger = markReviewed(ledger, 'quality', [shadow('command:run-1')]);
    const res = verifyLedgerFreshness(ledger, new Map());
    assert.deepEqual(unreviewedFiles(res.ledger), []);
    assert.equal(res.changed, false);
  });

  test('snapshot kimliği içeriğe bağlıdır: tek bayt değişim kimliği kırar', () => {
    const base = computeWorldSnapshotId(new Map([['src/a.ts', fp('h1')]]));
    assert.equal(base, computeWorldSnapshotId(new Map([['src/a.ts', fp('h1')]])));
    assert.notEqual(base, computeWorldSnapshotId(new Map([['src/a.ts', fp('h2')]])));
    assert.notEqual(
      base,
      computeWorldSnapshotId(
        new Map([
          ['src/a.ts', fp('h1')],
          ['src/b.ts', fp('h0')]
        ])
      )
    );
  });

  test("aynı yolda sessiz içerik değişimi kapı digest'ini kırar (yol listesi yetmez)", () => {
    const before = computeChangesDigest({
      ...WORLD,
      fileContents: [{ path: 'src/a.ts', contentHash: 'h1', size: 10 }]
    });
    const after = computeChangesDigest({
      ...WORLD,
      fileContents: [{ path: 'src/a.ts', contentHash: 'h2', size: 10 }]
    });
    assert.notEqual(before, after);
    // kanıt yoksa eski yol-digest davranışı korunur (geriye dönük uyum)
    assert.equal(computeChangesDigest(WORLD), computeChangesDigest({ ...WORLD, fileContents: [] }));
  });
});
