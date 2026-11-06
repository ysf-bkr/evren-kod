import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeChangesDigest,
  machineCheckPass,
  evaluateReleaseGate,
  formatGateRecord
} from '@evren-kod/core/core/gate/ReleaseGate';
import { gateForStage, createWorkflowState } from '@evren-kod/core/core/workflow/TaskWorkflow';
import { recordReleaseGateTool } from '@evren-kod/core/tools/gate';
import { recordWrites, markReviewed, unreviewedFiles } from '@evren-kod/core/core/gate/ReviewLedger';
import type { ReleaseGateRecord } from '@evren-kod/core/shared/types';

const WORLD = {
  files: ['src/a.ts', 'src/b.ts'],
  criteriaDone: ['ac-1', 'ac-2'],
  verificationStatus: 'passed',
  unreviewed: []
};

function makeRecord(overrides: Partial<ReleaseGateRecord> = {}): ReleaseGateRecord {
  return {
    specId: 'spec-1',
    verdict: 'pass',
    reasons: ['tüm kriterler koşuldu'],
    criteriaEvidence: [{ id: 'ac-1', note: 'birim testi geçti' }],
    risks: [],
    rollback: 'git revert ile tek commit geri alınır',
    verificationStatus: 'passed',
    digest: computeChangesDigest(WORLD),
    recordedAt: new Date().toISOString(),
    recordedBy: 'release-gate',
    ...overrides
  };
}

describe('Yayın kapısı: digest ve tazelik', () => {
  test('digest deterministiktir; sıra ve tekrar etkilemez', () => {
    const a = computeChangesDigest(WORLD);
    const b = computeChangesDigest({
      files: ['src/b.ts', 'src/a.ts', 'src/a.ts'],
      criteriaDone: ['ac-2', 'ac-1'],
      verificationStatus: 'passed',
      unreviewed: []
    });
    assert.equal(a, b);
  });

  test('dosya listesi, kriter ya da doğrulama değişirse digest değişir', () => {
    const base = computeChangesDigest(WORLD);
    assert.notEqual(base, computeChangesDigest({ ...WORLD, files: [...WORLD.files, 'src/c.ts'] }));
    assert.notEqual(base, computeChangesDigest({ ...WORLD, criteriaDone: [...WORLD.criteriaDone, 'ac-3'] }));
    assert.notEqual(base, computeChangesDigest({ ...WORLD, verificationStatus: 'failed' }));
  });

  test('karar sonrası dosya değişimi kapıyı bayatlatır', () => {
    const record = makeRecord();
    const fresh = evaluateReleaseGate(record, { currentSpecId: 'spec-1', currentDigest: record.digest });
    assert.equal(fresh.ok, true);
    const stale = evaluateReleaseGate(record, {
      currentSpecId: 'spec-1',
      currentDigest: computeChangesDigest({ ...WORLD, files: [...WORLD.files, 'src/d.ts'] })
    });
    assert.equal(stale.ok, false);
    assert.match(String(stale.reason), /değişti/);
  });

  test('kayıt yoksa, yanlış spec ise ya da block ise kapı açılmaz', () => {
    const digest = record_digest();
    assert.equal(
      evaluateReleaseGate(undefined, { currentSpecId: 'spec-1', currentDigest: digest }).ok,
      false
    );
    assert.equal(
      evaluateReleaseGate(makeRecord(), { currentSpecId: 'spec-2', currentDigest: digest }).ok,
      false
    );
    assert.equal(
      evaluateReleaseGate(makeRecord({ verdict: 'block', reasons: ['test eksik'] }), {
        currentSpecId: 'spec-1',
        currentDigest: digest
      }).ok,
      false
    );
  });

  test('makine denetimi: pass için spec + kriter + doğrulama şart', () => {
    assert.deepEqual(
      machineCheckPass({ hasSpec: true, criteriaMet: true, verificationPassed: true, unreviewedChanges: [] }),
      []
    );
    assert.equal(
      machineCheckPass({ hasSpec: false, criteriaMet: true, verificationPassed: true, unreviewedChanges: [] })
        .length,
      1
    );
    assert.equal(
      machineCheckPass({ hasSpec: true, criteriaMet: false, verificationPassed: true, unreviewedChanges: [] })
        .length,
      1
    );
    assert.equal(
      machineCheckPass({ hasSpec: true, criteriaMet: true, verificationPassed: false, unreviewedChanges: [] })
        .length,
      1
    );
    assert.equal(
      machineCheckPass({
        hasSpec: false,
        criteriaMet: false,
        verificationPassed: false,
        unreviewedChanges: []
      }).length,
      3
    );
  });

  test('karar özeti Türkçe ve karar durumunu taşır', () => {
    const text = formatGateRecord(makeRecord());
    assert.match(text, /Yayın kapısı kararı: PASS/);
    assert.match(text, /Geri alma:/);
  });
});

function record_digest(): string {
  return computeChangesDigest(WORLD);
}

describe('done kapısı yayın kapısını ister', () => {
  const base = {
    state: createWorkflowState({ stage: 'verify', planApproved: true, specApproved: true }),
    hasApprovedSpec: true,
    hasPlan: true,
    hasModules: true,
    criteriaMet: true,
    verificationPassed: true,
    releaseGatePassed: false
  };

  test('taze PASS yoksa done kapalıdır ve neden yayın kapısını gösterir', () => {
    const result = gateForStage('done', base, 'code');
    assert.equal(result.allowed, false);
    assert.match(String(result.reason), /release gate/i);
  });

  test('taze PASS ile done açılır', () => {
    assert.equal(gateForStage('done', { ...base, releaseGatePassed: true }, 'code').allowed, true);
  });

  test('planlama modu yayın kapısından muaftır', () => {
    assert.equal(
      gateForStage('done', { ...base, criteriaMet: false, verificationPassed: false }, 'plan').allowed,
      true
    );
  });
});

describe('record_release_gate aracı', () => {
  test('port yoksa hata verir', async () => {
    await assert.rejects(
      () =>
        recordReleaseGateTool.execute(
          { verdict: 'pass', reasons: [], criteria: [], rollback: 'geri al' },
          {}
        ),
      /not ready/i
    );
  });

  test('girdiler normalize edilip porta iletilir', async () => {
    const calls: unknown[] = [];
    const result = await recordReleaseGateTool.execute(
      {
        verdict: 'PASS',
        reasons: ['kriterler koşuldu', ''],
        criteria: [
          { id: 'ac-1', note: 'e2e geçti' },
          { id: '', note: 'eksik kimlik' },
          { id: 'ac-2', note: '' }
        ],
        risks: ['ödeme sağlayıcısı yavaş'],
        rollback: 'revert'
      },
      {
        releaseGate: {
          record: async (input) => {
            calls.push(input);
            return 'Yayın kapısı kararı: PASS';
          }
        }
      }
    );
    assert.equal(result, 'Yayın kapısı kararı: PASS');
    assert.equal(calls.length, 1);
    const input = calls[0] as {
      verdict: string;
      reasons: string[];
      criteriaEvidence: unknown[];
      risks: string[];
      rollback: string;
    };
    assert.equal(input.verdict, 'pass');
    assert.deepEqual(input.reasons, ['kriterler koşuldu']);
    assert.deepEqual(input.criteriaEvidence, [{ id: 'ac-1', note: 'e2e geçti' }]);
    assert.deepEqual(input.risks, ['ödeme sağlayıcısı yavaş']);
    assert.equal(input.rollback, 'revert');
  });

  test('pass dışı her beyan block olarak kaydedilir', async () => {
    let captured = '';
    await recordReleaseGateTool.execute(
      { verdict: 'yeşil ışık yanıyor', reasons: ['şüphe var'], criteria: [], rollback: 'revert' },
      {
        releaseGate: {
          record: async (input) => {
            captured = input.verdict;
            return 'ok';
          }
        }
      }
    );
    assert.equal(captured, 'block');
  });
});

describe('Denetim defteri: yazan uzman bağımsız reviewer görmeden kapı geçmez', () => {
  test('yazmalar incelemesiz girer; yazar kendi yazdığını inceleyemez', () => {
    let ledger = recordWrites([], 'backend', ['src/api.ts', 'src/db.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/api.ts', 'src/db.ts']);
    // Bağımsızlık makine kuralıdır: okumuş olsa bile yazar rolü kapatamaz.
    ledger = markReviewed(ledger, 'backend', ['src/api.ts', 'src/db.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/api.ts', 'src/db.ts']);
  });

  test('kapsama kuralı: reviewer yalnızca okuduğu dosyanın borcunu kapatır', () => {
    let ledger = recordWrites([], 'backend', ['src/api.ts', 'src/db.ts']);
    ledger = markReviewed(ledger, 'quality', ['src/api.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/db.ts']);
    ledger = markReviewed(ledger, 'security', ['src/db.ts']);
    assert.deepEqual(unreviewedFiles(ledger), []);
    // Okuma yolu normalize edilir: Windows ayracı ve ./ öneki eşleşmeyi bozmaz.
    ledger = recordWrites(ledger, 'backend', ['src/db.ts']);
    ledger = markReviewed(ledger, 'quality', ['src\\db.ts']);
    assert.deepEqual(unreviewedFiles(ledger), []);
  });

  test('ölçülemeyen komutun gölge borcu dosya okumayla değil, denetim turuyla kapanır', () => {
    let ledger = recordWrites([], 'manager', ['command:call_9']);
    assert.deepEqual(unreviewedFiles(ledger), ['command:call_9']);
    // Dosyayı "okumak" anlamsız: kapsama kanıtı aransa borç hiç kapanmazdı.
    ledger = markReviewed(ledger, 'manager', []);
    assert.deepEqual(unreviewedFiles(ledger), ['command:call_9'], 'yazar yine kapatamaz');
    ledger = markReviewed(ledger, 'quality', []);
    assert.deepEqual(unreviewedFiles(ledger), []);
  });

  test('incelemeden sonra yeniden yazma kararı düşürür', () => {
    let ledger = recordWrites([], 'backend', ['src/api.ts']);
    ledger = markReviewed(ledger, 'quality', ['src/api.ts']);
    assert.deepEqual(unreviewedFiles(ledger), []);
    ledger = recordWrites(ledger, 'backend', ['src/api.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/api.ts']);
  });

  test('inceleme sonrası defter değişimi digesti değiştirir (PASS sonrası inceleme kaydı bayatlatmaz: PASS zaten sıfır inceleme borcuyla kaydedilir)', () => {
    const withDebt = computeChangesDigest({ ...WORLD, unreviewed: ['src/c.ts'] });
    const clean = computeChangesDigest({ ...WORLD, unreviewed: [] });
    assert.notEqual(withDebt, clean);
  });

  test('makine denetimi: incelemesiz değişiklik varken pass kaydedilemez', () => {
    const failures = machineCheckPass({
      hasSpec: true,
      criteriaMet: true,
      verificationPassed: true,
      unreviewedChanges: ['src/api.ts']
    });
    assert.equal(failures.length, 1);
    const reason = failures[0] ?? '';
    assert.match(reason, /bağımsız incelemeden geçmedi/);
    assert.match(reason, /src\/api\.ts/);
  });

  test('defter yolu normalize eder: Windows ayraçı ve ./ öneki tek biçime gelir', () => {
    const ledger = recordWrites([], 'backend', ['src\\api.ts', './src/api.ts', 'src/api.ts']);
    assert.deepEqual(unreviewedFiles(ledger), ['src/api.ts']);
  });
});
