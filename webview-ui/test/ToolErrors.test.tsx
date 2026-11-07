import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { humanizeErrorMessage } from '../src/utils/toolErrors';

describe('humanizeErrorMessage: araç hataları kullanıcıya Türkçe anlatılır', () => {
  it('bilinen akış hatalarını Türkçeye çevirir ve teknik saymaz', () => {
    const cases: Array<[string, RegExp]> = [
      ['Tool is not allowed at this stage: write_file.', /Bu araç bu aşamada kullanılamaz: write_file/],
      ['Rejected by the user.', /reddedildi/],
      ['Approval timed out (10 minutes).', /Onay süresi doldu/],
      ['Unknown tool: yok_boyle_arac', /Bilinmeyen araç: yok_boyle_arac/],
      ['Workspace not found.', /Çalışma alanı bulunamadı/]
    ];
    for (const [raw, expected] of cases) {
      const result = humanizeErrorMessage(raw);
      assert.ok(result, `${raw} için sonuç üretilmeli`);
      assert.equal(result.technical, false, `${raw} teknik sayılmamalı`);
      assert.match(result.text, expected);
      assert.match(result.text, /[çğıöşüÇĞİÖŞÜ]/u, `${raw} Türkçe karakter içermeli`);
    }
  });

  it('kaydedilmemiş editör çakışmasını dosya adıyla birlikte anlatır', () => {
    const result = humanizeErrorMessage(
      '"src/app.ts" contains unsaved editor changes. Save or revert them first.'
    );
    assert.equal(result?.technical, false);
    assert.match(result?.text ?? '', /src\/app\.ts/);
    assert.match(result?.text ?? '', /kaydedilmemiş/);
  });

  it('Türkçe metni olduğu gibi bırakır', () => {
    const result = humanizeErrorMessage('Dosya bulunamadı.');
    assert.deepEqual(result, { text: 'Dosya bulunamadı.', technical: false });
  });

  it('çevrilemeyen serbest metni ham ve "teknik" olarak işaretler', () => {
    const result = humanizeErrorMessage('ENOENT: no such file or directory, open /x/y');
    assert.equal(result?.technical, true);
    assert.match(result?.text ?? '', /ENOENT/);
  });

  it('sağlayıcı hatalarını da Türkçeleştirir', () => {
    const cases: Array<[string, RegExp]> = [
      ['Could not reach the model server.', /Model sunucusuna ulaşılamadı/],
      ['Request cancelled by the user.', /iptal edildi/],
      ['API error [429]: rate limited', /HTTP 429/],
      [
        'Model stream ended before completion (no [DONE] received); the response may be truncated.',
        /yarım kalmış/
      ]
    ];
    for (const [raw, expected] of cases) {
      const result = humanizeErrorMessage(raw);
      assert.equal(result?.technical, false, raw);
      assert.match(result?.text ?? '', expected);
    }
  });

  it('boş hatada hiçbir şey çizdirmez', () => {
    assert.equal(humanizeErrorMessage(undefined), undefined);
    assert.equal(humanizeErrorMessage('   '), undefined);
  });
});
