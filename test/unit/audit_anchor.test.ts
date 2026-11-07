import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { AuditLog } from '@evren-kod/core/core/audit/AuditLog';
import {
  addAnchor,
  verifyWithAnchors,
  workspaceAnchorFile,
  homeAnchorFile
} from '@evren-kod/core/core/audit/Anchors';
import { createWorkspaceTracker } from '../support/agentHarness';

/**
 * Harici çapalama testleri (Adım Beş, senaryo 17):
 * "Yerel AuditLog dosyasını tamamen silip yeniden oluştur — çapalama
 * geçmişin yeniden kurulduğunu tespit edebilmelidir."
 */
const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-anchor-');

/** İzole ev alanı: testler gerçek ~/.evren-kod yazmaz. */
async function fakeHome(): Promise<string> {
  const root = await workspace();
  const home = `${root}-home`;
  await fs.mkdir(home, { recursive: true });
  return home;
}

async function appendEntries(root: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await AuditLog.append(root, { decision: 'allow', tool: 'execute_command', args: `npm test -- run ${i}` });
  }
}

describe('AuditAnchor: harici çapalama geçmiş silmeyi görünür kılar', () => {
  it('çapalama iki güven alanına birden yazır ve doğrulama geçer', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 3);

    const report = await addAnchor(root, { homeRoot: home });
    assert.equal(report.ok, true);
    assert.equal(report.anchor?.entries, 3);
    await fs.stat(workspaceAnchorFile(root)); // depo içi kopya
    await fs.stat(homeAnchorFile(root, home)); // ev alanı kopyası
    const result = await verifyWithAnchors(root, { homeRoot: home });
    assert.equal(result.ok, true);
    assert.equal(result.anchors.ok, true);
    assert.equal(result.anchors.workspaceCount, 1);
    assert.equal(result.anchors.homeCount, 1);
  });

  it('SIL ve YENİDEN KUR saldırısı: yerel zincir kendi içinde geçerlidir ama çapa ihlali patlar', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 4);
    await addAnchor(root, { homeRoot: home });

    // Saldırgan: audit.log'u sil, geçerli görünen 2 kayıtlık yeni zincir kur.
    const file = `${root}/.evren-kod/audit.log`;
    await fs.rm(file);
    await appendEntries(root, 2);

    // Salt yerel doğrulama saldırıyı YAKALAYAMAZ — iddiamızın ölçüsü bu:
    const naive = await AuditLog.verify(root);
    assert.equal(naive.ok, true, 'zincir kendi içinde tutarlı görünüyor (beklenen zayıflık)');

    // Çapalı doğrulama kaçınılmaz olarak yakalar:
    const result = await verifyWithAnchors(root, { homeRoot: home });
    assert.equal(result.ok, false);
    assert.match(result.message, /ANCHOR VIOLATION/);
    assert.match(result.message, /deleted or rebuilt/);
  });

  it('son kayıtların kırpılması (truncate) da çapa ihlalidir', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 5);
    await addAnchor(root, { homeRoot: home });
    const file = `${root}/.evren-kod/audit.log`;
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    await fs.writeFile(file, lines.slice(0, 3).join('\n') + '\n');
    const result = await verifyWithAnchors(root, { homeRoot: home });
    assert.equal(result.ok, false);
    assert.match(result.message, /ANCHOR VIOLATION/);
  });

  it('çapa zinciri de bozulmaya kapalıdır: ortadan çapa silme yakalanır', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 1);
    await addAnchor(root, { homeRoot: home });
    await appendEntries(root, 2);
    await addAnchor(root, { homeRoot: home });
    const file = workspaceAnchorFile(root);
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    await fs.writeFile(file, lines[1] as string); // ilk çapa silindi, ikincisi kaldı → prev bağı kopar
    const result = await verifyWithAnchors(root, { homeRoot: home });
    assert.equal(result.ok, false);
    assert.match(result.message, /ANCHOR VIOLATION/);
    assert.match(result.message, /anchor chain break/);
  });

  it('bozuk denetim zincirinin üstüne çapa yapılmaz', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 2);
    const file = `${root}/.evren-kod/audit.log`;
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    lines[0] = String(lines[0]).replace('"decision":"allow"', '"decision":"DENIED-DEĞİŞTİ"');
    await fs.writeFile(file, lines.join('\n') + '\n');
    const report = await addAnchor(root, { homeRoot: home });
    assert.equal(report.ok, false);
    assert.match(report.message, /Anchor refused/);
  });

  it('artan zincir: ikinci çapa ilkine bağlanır, geçmiş uzadıkça doğrulanır', async () => {
    const root = await workspace();
    const home = await fakeHome();
    await appendEntries(root, 2);
    await addAnchor(root, { homeRoot: home });
    await appendEntries(root, 3);
    const second = await addAnchor(root, { homeRoot: home });
    assert.equal(second.ok, true);
    assert.equal(second.anchor?.seq, 2);
    // Eski uç hâlâ zincirin parçası: ihlal yok.
    const result = await verifyWithAnchors(root, { homeRoot: home });
    assert.equal(result.ok, true);
    assert.match(result.anchors.message, /2 external anchor\(s\) verified/);
  });
});

after(async () => {
  await cleanup();
});
