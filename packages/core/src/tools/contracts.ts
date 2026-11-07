/**
 * Araçların çekirdekten gördüğü dar yüzeyler.
 *
 * `ToolExecutionContext` önceden 10 somut çekirdek sınıfını açıyordu; her araç
 * o sınıfların **tüm** public API'sine erişebiliyordu. Buradaki portlar yalnızca
 * araçların gerçekten kullandığı metotları açar. İmzalar `Pick` ile sınıftan
 * türetildiği için tekrar yazılmaz ve sınıf değişince port kendiliğinden
 * güncellenir.
 *
 * `import type` zorunludur: araç katmanı çekirdeğin çalışma zamanına bağlanmaz
 * (`architecture.test.ts` bunu doğrular).
 */
import type { LspClientPort } from '../core/lsp/port';
import type { PermissionManager } from '../core/permission/PermissionManager';
import type { SnapshotManager } from '../core/snapshot/SnapshotManager';
import type { VerificationManager } from '../core/verification/VerificationManager';
import type { GitManager } from '../core/git/GitManager';
import type { ProjectMemoryManager } from '../core/memory/ProjectMemoryManager';
import type { VectorMemory } from '../core/memory/VectorMemory';
import type { KnowledgeStore } from '../core/knowledge/KnowledgeStore';
import type { EmbeddingIndex } from '../core/knowledge/EmbeddingIndex';
import type { SpecStore } from '../core/spec/SpecStore';
import type { CallGraphManager } from '../core/callgraph/CallGraphManager';

/** Sembol ve tanı sorguları. */
export type LspPort = Pick<
  LspClientPort,
  'getDiagnostics' | 'getDefinition' | 'getHover' | 'getReferences' | 'getWorkspaceSymbols'
>;

/** Yazma öncesi anlık görüntü ve geri alma. */
export type SnapshotPort = Pick<SnapshotManager, 'createSnapshot' | 'revertLast' | 'getSnapshots'>;

/**
 * Okuma izni kapısı: arama gibi dolaylı okuma yollarının, `read_file` ile aynı
 * deny/hassas dosya kararını uygulaması için (denetim bulgusu F04).
 */
export type PermissionPort = Pick<PermissionManager, 'isToolBlocked'>;

/** Test/lint/tip doğrulaması. */
export type VerificationPort = Pick<VerificationManager, 'verify' | 'formatForPrompt'>;

/** Depo işlemleri. */
export type GitPort = Pick<
  GitManager,
  'createBranch' | 'stage' | 'commit' | 'preparePrBody' | 'diff' | 'status' | 'treeHash' | 'headTreeHash'
>;

/** Geçmiş görev hafızası. */
export type ProjectMemoryPort = Pick<ProjectMemoryManager, 'search'>;

/** Vektör bellek araması. */
export type VectorMemoryPort = Pick<VectorMemory, 'search'>;

/** Bilgi tabanı: okuma, arama, indeksleme ve küratörlü yazma. */
export type KnowledgePort = Pick<
  KnowledgeStore,
  | 'getStatus'
  | 'getSummary'
  | 'formatStatus'
  | 'formatForPrompt'
  | 'search'
  | 'findSymbols'
  | 'analyzeImpact'
  | 'semanticCorpus'
  | 'embeddingsDir'
  | 'indexWorkspace'
  | 'ensureFresh'
  | 'appendNote'
  | 'writeHumanFile'
  // Bilgi grafının ihtiyaç duyduğu dar sorgular.
  | 'symbolsOf'
  | 'findFiles'
  | 'filesUnder'
  | 'dependentsOf'
  | 'importsOf'
  | 'fileIndex'
  | 'getFile'
  | 'knowledgeNotes'
  | 'knowledgeBullets'
  | 'knowledgeStats'
>;

/** Yerel anlamsal sıralama. */
export type EmbeddingPort = Pick<EmbeddingIndex, 'rank'>;

/** Spec yaşam döngüsü. */
export type SpecPort = Pick<SpecStore, 'create' | 'get' | 'setCriterionDone'>;

/**
 * Yayın kapısı kararı: kaydı konağın gerçek durumuna (kriterler, doğrulama,
 * değişen dosyalar) karşı makine denetiminden geçiren servis. Motor konağı
 * görmez; denetim kurallarının saf kısmı `core/gate/ReleaseGate.ts`'te yaşar.
 */
export interface ReleaseGatePort {
  record(input: {
    verdict: 'pass' | 'block';
    reasons: string[];
    criteriaEvidence: Array<{ id: string; note: string }>;
    risks: string[];
    rollback: string;
  }): Promise<string>;
  /** Taze PASS kararı var mı? Commit sınırı bu cevabı sorar. */
  evaluate?(): { ok: boolean; reason?: string };
  /**
   * Commit öncesi muhafız: aktif bir görev (spec) varsa commit gate PASS
   * ister (`required: true`); görev dışı hızlı commit'ler işaretli geçer.
   */
  preCommitGuard?(): { required: boolean; ok: boolean; reason?: string };
}

/** Çağrı haritası durumu (salt-okunur). */
export type CallGraphPort = Pick<CallGraphManager, 'status' | 'getDocument'>;
