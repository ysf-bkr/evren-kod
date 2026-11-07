import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { EVREN_KOD_DIR } from '../../shared/constants';
import { AuditLog, GENESIS_HASH, type AuditVerifyResult } from './AuditLog';

/**
 * Denetim zinciri için harici çapalama (external anchoring).
 *
 * Hash zinciri tek başına şunu savunamaz: makineyi ele geçiren saldırgan
 * `audit.log` dosyasını SİLİP geçerli görünen yepyeni bir zincir kurabilir.
 * Çapalama, zincirin uç hash'ini İKİNCİ bir güven alanına kopyalar:
 *
 *  1. Depo içi: `.evren-kod/audit-anchors.log` — commit'lenip uzak
 *     deposuna itildiğinde GitHub tanık hâline gelir.
 *  2. Kullanıcı evi: `~/.evren-kod/anchors/<depo-kimliği>.log` — çalışma
 *     alanını silip yeniden kuran saldırganın dokunmadığı ikinci alan.
 *
 * Doğrulama artık yalnız "zincir kendi içinde tutarlı mı?" diye sormaz;
 * "zincir, dışarıda damgalanmış geçmişini hâlâ içeriyor mu?" de sorar.
 * Çapalanmış uç hash mevcut zincirde yoksa geçmiş silinmiş/yeniden
 * kurulmuştur — bu, salt yerel dosyaya bakarak GİZLENEBİLİR bir suç değildir.
 */

export interface AuditAnchor {
  /** Depo içindeki monoton sıra numarası. */
  seq: number;
  /** Bir önceki çapanın hash'i — çapalar da kendi zincirini oluşturur. */
  prevAnchorHash: string;
  /** Çapalama anındaki denetim zincirinin uç hash'i. */
  headHash: string;
  /** Çapalama anındaki doğrulanmış kayıt sayısı. */
  entries: number;
  anchoredAt: string;
  anchorHash: string;
}

export interface AnchorStoreOptions {
  /** Test amaçlı ev alanı kökü; varsayılan gerçek homedir. */
  homeRoot?: string;
}

export interface AnchorReport {
  ok: boolean;
  anchor?: AuditAnchor;
  message: string;
}

export interface AnchorVerifyResult extends AuditVerifyResult {
  anchors: {
    workspaceCount: number;
    homeCount: number;
    ok: boolean;
    message: string;
  };
}

function computeAnchorHash(anchor: Omit<AuditAnchor, 'anchorHash'>): string {
  const payload = [
    String(anchor.seq),
    anchor.prevAnchorHash,
    anchor.headHash,
    String(anchor.entries),
    anchor.anchoredAt
  ].join('\u0000');
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

export function workspaceAnchorFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, EVREN_KOD_DIR, 'audit-anchors.log');
}

export function homeAnchorFile(workspaceRoot: string, homeRoot?: string): string {
  const home = homeRoot || os.homedir();
  const id = createHash('sha256').update(path.resolve(workspaceRoot), 'utf-8').digest('hex').slice(0, 16);
  return path.join(home, EVREN_KOD_DIR, 'anchors', `${id}.log`);
}

async function readAnchors(file: string): Promise<{ anchors: AuditAnchor[]; malformed: number }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    return { anchors: [], malformed: 0 };
  }
  const anchors: AuditAnchor[] = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditAnchor;
      if (
        typeof parsed.seq === 'number' &&
        typeof parsed.headHash === 'string' &&
        typeof parsed.prevAnchorHash === 'string' &&
        typeof parsed.anchorHash === 'string'
      ) {
        anchors.push(parsed);
      } else {
        malformed++;
      }
    } catch {
      malformed++;
    }
  }
  return { anchors, malformed };
}

/** Çapa zincirinin bütünlüğü: sıra, prev bağlantısı ve kendi hash'i. */
function checkAnchorChain(anchors: AuditAnchor[], label: string): string | undefined {
  let prev = GENESIS_HASH;
  for (const anchor of anchors) {
    if (anchor.prevAnchorHash !== prev) {
      return `${label}: anchor chain break at seq ${anchor.seq} (an anchor was removed or reordered).`;
    }
    const recomputed = computeAnchorHash({
      seq: anchor.seq,
      prevAnchorHash: anchor.prevAnchorHash,
      headHash: anchor.headHash,
      entries: anchor.entries,
      anchoredAt: anchor.anchoredAt
    });
    if (recomputed !== anchor.anchorHash) {
      return `${label}: anchor seq ${anchor.seq} was modified after it was written.`;
    }
    prev = anchor.anchorHash;
  }
  return undefined;
}

async function appendAnchorLine(file: string, anchor: AuditAnchor): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(anchor)}\n`, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Mevcut zincir ucunu iki güven alanına birden damgalar. Zincir bozuksa ya
 * da mevcut çapalar mevcut zincirle çelişiyorsa çapalama YAPILMAZ ve durum
 * rapor edilir — çelişkinin üstüne inşa etmek kanıtı kirletir.
 */
export async function addAnchor(workspaceRoot: string, opts: AnchorStoreOptions = {}): Promise<AnchorReport> {
  const verification = await AuditLog.verify(workspaceRoot);
  if (!verification.ok) {
    return { ok: false, message: `Anchor refused: ${verification.message}` };
  }
  const wf = workspaceAnchorFile(workspaceRoot);
  const hf = homeAnchorFile(workspaceRoot, opts.homeRoot);
  const [ws, home] = await Promise.all([readAnchors(wf), readAnchors(hf)]);

  if (ws.malformed > 0 || home.malformed > 0) {
    return { ok: false, message: 'Anchor refused: anchor store contains malformed lines.' };
  }
  const chainIssue =
    checkAnchorChain(ws.anchors, 'workspace anchor store') ||
    checkAnchorChain(home.anchors, 'home anchor store');
  if (chainIssue) {
    return { ok: false, message: `Anchor refused: ${chainIssue}` };
  }
  const mismatch = compareStores(ws.anchors, home.anchors);
  if (mismatch) {
    return { ok: false, message: `Anchor refused: ${mismatch}` };
  }
  const known = ws.anchors.length >= home.anchors.length ? ws.anchors : home.anchors;
  const last = known[known.length - 1];
  const anchorBase: Omit<AuditAnchor, 'anchorHash'> = {
    seq: (last?.seq ?? 0) + 1,
    prevAnchorHash: last?.anchorHash ?? GENESIS_HASH,
    headHash: verification.headHash ?? GENESIS_HASH,
    entries: verification.entries,
    anchoredAt: new Date().toISOString()
  };
  const anchor: AuditAnchor = { ...anchorBase, anchorHash: computeAnchorHash(anchorBase) };
  await appendAnchorLine(wf, anchor);
  await appendAnchorLine(hf, anchor);
  return { ok: true, anchor, message: `Anchored chain head ${anchor.headHash} (seq ${anchor.seq}).` };
}

function compareStores(ws: AuditAnchor[], home: AuditAnchor[]): string | undefined {
  const shared = Math.min(ws.length, home.length);
  for (let i = 0; i < shared; i++) {
    if (ws[i]?.anchorHash !== home[i]?.anchorHash) {
      return `anchor stores disagree at position ${i + 1}: one copy was rewritten (possible history reset).`;
    }
  }
  return undefined;
}

/**
 * Zinciri hem kendi içinde hem de harici çapalara karşı doğrular.
 * Çapalanmış bir uç hash mevcut zincirde bulunamıyorsa geçmiş silinmiş ya da
 * sıfırdan yeniden kurulmuş demektir — kullanıcıların özel istediği senaryo.
 */
export async function verifyWithAnchors(
  workspaceRoot: string,
  opts: AnchorStoreOptions = {}
): Promise<AnchorVerifyResult> {
  const base = await AuditLog.verify(workspaceRoot);
  const wf = workspaceAnchorFile(workspaceRoot);
  const hf = homeAnchorFile(workspaceRoot, opts.homeRoot);
  const [ws, home] = await Promise.all([readAnchors(wf), readAnchors(hf)]);
  const anchorsMeta = {
    workspaceCount: ws.anchors.length,
    homeCount: home.anchors.length,
    ok: true,
    message: 'No external anchors yet; anchoring starts with the first gate decision.'
  };

  const problems: string[] = [];
  if (ws.malformed > 0 || home.malformed > 0) {
    problems.push('anchor store contains malformed lines.');
  }
  const chainIssue =
    checkAnchorChain(ws.anchors, 'workspace anchor store') ||
    checkAnchorChain(home.anchors, 'home anchor store');
  if (chainIssue) problems.push(chainIssue);
  const mismatch = compareStores(ws.anchors, home.anchors);
  if (mismatch) problems.push(mismatch);

  const all = ws.anchors.length >= home.anchors.length ? ws.anchors : home.anchors;
  if (all.length > 0) {
    const { hashes } = await AuditLog.chainHashes(workspaceRoot);
    const present = new Set(hashes);
    for (const anchor of all) {
      if (anchor.headHash !== GENESIS_HASH && !present.has(anchor.headHash)) {
        problems.push(
          `anchored history seq ${anchor.seq} (head ${anchor.headHash.slice(0, 12)}…, ` +
            `${anchor.entries} entries) is NOT part of the current log: the audit log was deleted or rebuilt.`
        );
      }
    }
    if (problems.length === 0) {
      anchorsMeta.message = `${all.length} external anchor(s) verified against the current chain.`;
    }
  }

  const anchorsOk = problems.length === 0;
  const ok = base.ok && anchorsOk;
  let message = base.message;
  if (!anchorsOk) {
    message = `ANCHOR VIOLATION: ${problems.join(' | ')}`;
  }
  return {
    ...base,
    ok,
    message,
    anchors: { ...anchorsMeta, ok: anchorsOk }
  };
}
