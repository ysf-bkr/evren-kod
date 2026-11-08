import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SemanticCodeIndex } from '../../packages/core/src/core/knowledge/SemanticCodeIndex';

describe('SemanticCodeIndex: Kod Tabanı Semantik ve Vektörel Arama', () => {
  it('kaynak kodu örtüşen mantıksal bloklara (chunk) ayırır', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 100; i++) {
      lines.push(`const variable_${i} = ${i};`);
    }
    const content = lines.join('\n');
    const chunks = SemanticCodeIndex.chunkFile('src/utils/math.ts', content, 40, 10);

    assert.ok(chunks.length >= 3, '100 satırlık kod en az 3 parçaya bölünmeli');
    assert.equal(chunks[0]?.filePath, 'src/utils/math.ts');
    assert.equal(chunks[0]?.startLine, 1);
    assert.equal(chunks[0]?.endLine, 40);
    assert.ok(chunks[0]?.hash, 'Parçanın hash değeri olmalı');
  });

  it('doğal dil sorgusuyla ilgili kod parçasını VSM uzayında bulur', async () => {
    const index = new SemanticCodeIndex('/fake/workspace');

    const files = [
      {
        relPath: 'src/auth/jwt.ts',
        content: `
export function verifyAuthToken(token: string) {
  // Kullanıcı yetki ve oturum jetonunu doğrular
  if (!token) throw new Error('Geçersiz oturum');
  return decodeToken(token);
}
`
      },
      {
        relPath: 'src/db/pool.ts',
        content: `
export class DatabasePool {
  // Veritabanı bağlantı havuzu ve sorgu yönetimi
  connect() {
    return new Connection();
  }
}
`
      },
      {
        relPath: 'src/payment/stripe.ts',
        content: `
export function processStripePayment(amount: number) {
  // Kredi kartı ödeme ve faturalandırma işlemi
  return stripe.charge({ amount });
}
`
      }
    ];

    await index.indexFiles(files, true);

    // 1. Sorgu: "yetki ve oturum doğrula" -> src/auth/jwt.ts bulmalı
    const authMatches = await index.search('kullanıcı yetki oturum jetonu', { limit: 3 });
    assert.ok(authMatches.length > 0, 'Yetki sorgusu sonuç döndürmeli');
    assert.equal(authMatches[0]?.filePath, 'src/auth/jwt.ts', 'En yüksek eşleşme jwt.ts olmalı');
    assert.ok(authMatches[0]?.score > 0.2);

    // 2. Sorgu: "veritabanı bağlantı havuzu" -> src/db/pool.ts bulmalı
    const dbMatches = await index.search('veritabanı bağlantı havuzu', { limit: 3 });
    assert.ok(dbMatches.length > 0, 'DB sorgusu sonuç döndürmeli');
    assert.equal(dbMatches[0]?.filePath, 'src/db/pool.ts', 'En yüksek eşleşme pool.ts olmalı');

    // 3. Sorgu: "ödeme ve faturalandırma" -> src/payment/stripe.ts bulmalı
    const paymentMatches = await index.search('ödeme işlemi faturalandırma', { limit: 3 });
    assert.ok(paymentMatches.length > 0, 'Ödeme sorgusu sonuç döndürmeli');
    assert.equal(paymentMatches[0]?.filePath, 'src/payment/stripe.ts', 'En yüksek eşleşme stripe.ts olmalı');
  });

  it('boş sorgularda veya alakasız aramalarda güvenle boş dizi döner', async () => {
    const index = new SemanticCodeIndex('/fake/workspace');
    await index.indexFiles([{ relPath: 'a.ts', content: 'const x = 1;' }]);

    const empty = await index.search('');
    assert.deepEqual(empty, []);

    const irrelevant = await index.search('xyz987completelyunrelatedtoken123');
    assert.deepEqual(irrelevant, []);
  });
});
