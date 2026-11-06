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
  normalizeFile
} from '@evren-kod/core/core/gate/ReviewLedger';
import type { ReleaseGateRecord } from '@evren-kod/core/shared/types';

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
    ledger = markReviewed(ledger, 'backend', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/a.ts']);
    // bağımsız reviewer okuduysa kapanır
    ledger = markReviewed(ledger, 'quality', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(ledger), []);
    assert.equal(ledger[0]?.reviewedBy, 'quality');
  });

  test('okumadan kapanmaz — seenFiles kontrolü kaldırılamaz', () => {
    const ledger = recordWrites([], 'frontend', ['src/a.ts', 'src/b.ts']);
    // boş okuma kümesi hiçbir dosya borcunu kapatmaz
    const untouched = markReviewed(ledger, 'quality', []);
    assert.deepEqual(unreviewedFiles(untouched), ['src/a.ts', 'src/b.ts']);
    // kısmi okuma yalnız okunanı kapatır
    const partial = markReviewed(ledger, 'quality', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(partial), ['src/b.ts']);
  });

  test('gölge borç ayrımı: command:* bağımsız turda kapanır, dosya borcu kapanmaz', () => {
    const ledger = recordWrites([], 'manager', ['src/a.ts', 'command:run-1']);
    // bağımsız denetim yalnız gölge kaydı kapatır (dosya ölçülemedi), dosya borcu kalır
    const after = markReviewed(ledger, 'security', []);
    assert.deepEqual(unreviewedFiles(after), ['src/a.ts']);
    // kendi yazan (manager) gölge borcu da kapatamaz
    const selfRun = markReviewed(ledger, 'manager', []);
    assert.deepEqual(unreviewedFiles(selfRun), ['command:run-1', 'src/a.ts']);
    // okumalarla birlikte gölge de kapanır
    const full = markReviewed(ledger, 'security', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(full), []);
  });

  test('yazma eski incelemeyi geçersiz kılar — sil-yaz ile borç sıfırlanamaz', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(ledger), []);
    // aynı dosya yeniden yazılırsa karar bayatlar: borç yeniden doğar
    ledger = recordWrites(ledger, 'backend', ['src/a.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/a.ts']);
    assert.equal(ledger[0]?.reviewedBy, undefined);
  });

  test('defter durum günlüğünden geçerek bozulmadan döner (JSON round-trip)', () => {
    let ledger = recordWrites([], 'backend', ['src/a.ts']);
    ledger = markReviewed(ledger, 'quality', ['src/a.ts']);
    ledger = recordWrites(ledger, 'security', ['command:c-1']);
    const revived = JSON.parse(JSON.stringify(ledger));
    assert.deepEqual(unreviewedFiles(revived), ['command:c-1']);
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
    let ledger = recordWrites(
      [],
      'backend',
      Array.from({ length: 300 }, (_, i) => `f${i}.ts`)
    );
    assert.ok(ledger.length <= 200, `defter sınırı aşıldı: ${ledger.length}`);
    // sınır aşımında en yeniler korunur (borç kaybolmaz: kalanlar yine inceleme bekler)
    assert.ok(unreviewedFiles(ledger).length > 0);
  });
});
