import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { FastApplyEngine } from '../../packages/core/src/core/fastapply/FastApplyEngine';

describe('FastApplyEngine: Hızlı ve Akıllı Kod Değişikliği Uygulama', () => {
  it('tam eşleşen kod bloğunu başarıyla değiştirir', () => {
    const original = `function add(a: number, b: number): number {\n  return a + b;\n}\n`;
    const target = `  return a + b;`;
    const replacement = `  // Toplama işlemi\n  return a + b;`;

    const res = FastApplyEngine.fuzzyReplace(original, target, replacement);
    assert.ok(res, 'Değiştirme sonucu dönmeli');
    assert.equal(res.confidence, 1.0, 'Tam eşleşmede güven 1.0 olmalı');
    assert.match(res.updatedContent, /\/\/ Toplama işlemi/);
  });

  it('girinti farkı olan blokları toleranslı (fuzzy) olarak algılar ve uygular', () => {
    // Orijinal kodda 4 boşluk girinti varken, model 2 boşluk veya tab ile göndermiş olsun
    const original = [
      'class Calculator {',
      '    computeTotal(items: Item[]): number {',
      '        let sum = 0;',
      '        for (const item of items) {',
      '            sum += item.price;',
      '        }',
      '        return sum;',
      '    }',
      '}'
    ].join('\n');

    // Modelin aradığı (2 boşluk girintili):
    const target = ['  for (const item of items) {', '    sum += item.price;', '  }'].join('\n');

    const replacement = [
      '    for (const item of items) {',
      '        if (item.active) sum += item.price;',
      '    }'
    ].join('\n');

    const res = FastApplyEngine.fuzzyReplace(original, target, replacement, 0.75);
    assert.ok(res, 'Fuzzy eşleşme başarılı olmalı');
    assert.ok(res.confidence >= 0.75, `Güven skoru (${res.confidence}) eşiği geçmeli`);
    assert.match(res.updatedContent, /if \(item\.active\)/);
  });

  it('SEARCH / REPLACE bloklarını (Cursor/Aider formatı) ayrıştırır ve uygular', () => {
    const original = [
      'import * as fs from "fs";',
      '',
      'export function loadConfig() {',
      '  return JSON.parse(fs.readFileSync("config.json", "utf8"));',
      '}'
    ].join('\n');

    const diffText = [
      '<<<<<<< SEARCH',
      'export function loadConfig() {',
      '  return JSON.parse(fs.readFileSync("config.json", "utf8"));',
      '}',
      '=======',
      'export async function loadConfig(): Promise<Config> {',
      '  const data = await fs.promises.readFile("config.json", "utf8");',
      '  return JSON.parse(data);',
      '}',
      '>>>>>>> REPLACE'
    ].join('\n');

    const result = FastApplyEngine.applyDiff(original, diffText);
    assert.ok(result.success, 'Diff başarıyla uygulanmalı');
    assert.equal(result.appliedCount, 1);
    assert.match(result.content, /async function loadConfig/);
    assert.match(result.content, /fs\.promises\.readFile/);
  });

  it('Unified diff formatındaki hunk bloklarını ayrıştırır ve uygular', () => {
    const original = [
      'function test() {',
      '  console.log("start");',
      '  console.log("middle");',
      '  console.log("end");',
      '}'
    ].join('\n');

    const unifiedDiff = [
      '@@ -2,3 +2,3 @@',
      '   console.log("start");',
      '-  console.log("middle");',
      '+  console.log("updated-middle");',
      '   console.log("end");'
    ].join('\n');

    const result = FastApplyEngine.applyDiff(original, unifiedDiff);
    assert.ok(result.success, 'Unified diff uygulanmalı');
    assert.match(result.content, /updated-middle/);
    assert.doesNotMatch(result.content, /console\.log\("middle"\)/);
  });

  it('Uyuşmayan bloklarda hata üretmeden durumu güvenle bildirir', () => {
    const original = `const a = 1;\n`;
    const target = `tamamen alakasız ve dosyada olmayan bir kod parçası`;
    const replacement = `yeni kod`;

    const res = FastApplyEngine.fuzzyReplace(original, target, replacement, 0.85);
    assert.equal(res, undefined, 'Eşleşme bulunamayınca undefined dönmeli');
  });
});
