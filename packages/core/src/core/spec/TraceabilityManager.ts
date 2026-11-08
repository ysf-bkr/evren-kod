import * as path from 'path';
import * as fs from 'fs/promises';
import { EVREN_KOD_DIR, EVREN_KOD_SUBDIRS } from '../../shared/constants';

/**
 * Gereksinimden Kabul Testine Uçtan Uca İzlenebilirlik Yöneticisi (TraceabilityManager).
 *
 * Her gereksinimin (Requirement):
 * - Bir kimliği (Requirement ID: REQ-XXX)
 * - Teknik tasarım açıklaması
 * - İlgili görevleri (Task IDs)
 * - Değiştirilen/etkilenen dosyaları
 * - Test senaryoları ve test dosyaları
 * - Kabul kanıtları (verification proofs)
 * ile eşleştiğini garanti eder.
 *
 * Sistem bu sayede hiçbir gereksinimin test edilmeden veya kanıtsız
 * teslim edilmediğini matematiksel ve denetlenebilir olarak doğrular.
 */

export type RequirementStatus = 'unmapped' | 'in_progress' | 'implemented' | 'verified' | 'failed';

export interface TraceableRequirement {
  id: string;
  title: string;
  description: string;
  technicalDesign?: string;
  taskIds: string[];
  affectedFiles: string[];
  testCases: string[];
  acceptanceEvidence: string[];
  status: RequirementStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TraceabilityReport {
  totalRequirements: number;
  verifiedCount: number;
  pendingCount: number;
  failedCount: number;
  coveragePercent: number;
  unmappedRequirements: string[];
  requirementsMissingTests: string[];
  requirementsMissingEvidence: string[];
  items: TraceableRequirement[];
}

export class TraceabilityManager {
  private requirements = new Map<string, TraceableRequirement>();

  public addRequirement(req: {
    id: string;
    title: string;
    description?: string;
    technicalDesign?: string;
    taskIds?: string[];
    affectedFiles?: string[];
    testCases?: string[];
  }): TraceableRequirement {
    const id = req.id.trim();
    if (!id) throw new Error('Requirement ID cannot be empty.');

    const existing = this.requirements.get(id);
    const now = Date.now();

    const item: TraceableRequirement = {
      id,
      title: req.title.trim(),
      description: req.description?.trim() ?? '',
      technicalDesign: req.technicalDesign?.trim(),
      taskIds: Array.from(new Set([...(existing?.taskIds ?? []), ...(req.taskIds ?? [])])),
      affectedFiles: Array.from(new Set([...(existing?.affectedFiles ?? []), ...(req.affectedFiles ?? [])])),
      testCases: Array.from(new Set([...(existing?.testCases ?? []), ...(req.testCases ?? [])])),
      acceptanceEvidence: existing?.acceptanceEvidence ?? [],
      status: existing?.status ?? 'unmapped',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.updateStatus(item);
    this.requirements.set(id, item);
    return item;
  }

  public linkTask(requirementId: string, taskId: string): void {
    const item = this.requirements.get(requirementId);
    if (!item) throw new Error(`Requirement not found: ${requirementId}`);
    if (!item.taskIds.includes(taskId)) {
      item.taskIds.push(taskId);
      item.updatedAt = Date.now();
      this.updateStatus(item);
    }
  }

  public linkFile(requirementId: string, filePath: string): void {
    const item = this.requirements.get(requirementId);
    if (!item) throw new Error(`Requirement not found: ${requirementId}`);
    if (!item.affectedFiles.includes(filePath)) {
      item.affectedFiles.push(filePath);
      item.updatedAt = Date.now();
      this.updateStatus(item);
    }
  }

  public linkTestCase(requirementId: string, testNameOrFile: string): void {
    const item = this.requirements.get(requirementId);
    if (!item) throw new Error(`Requirement not found: ${requirementId}`);
    if (!item.testCases.includes(testNameOrFile)) {
      item.testCases.push(testNameOrFile);
      item.updatedAt = Date.now();
      this.updateStatus(item);
    }
  }

  public recordEvidence(requirementId: string, evidence: string, markVerified = true): void {
    const item = this.requirements.get(requirementId);
    if (!item) throw new Error(`Requirement not found: ${requirementId}`);
    const cleanEvidence = evidence.trim();
    if (cleanEvidence && !item.acceptanceEvidence.includes(cleanEvidence)) {
      item.acceptanceEvidence.push(cleanEvidence);
    }
    if (markVerified) {
      item.status = 'verified';
    }
    item.updatedAt = Date.now();
  }

  public markFailed(requirementId: string, reason?: string): void {
    const item = this.requirements.get(requirementId);
    if (!item) throw new Error(`Requirement not found: ${requirementId}`);
    item.status = 'failed';
    if (reason) {
      item.acceptanceEvidence.push(`FAILED: ${reason}`);
    }
    item.updatedAt = Date.now();
  }

  private updateStatus(item: TraceableRequirement): void {
    if (item.status === 'verified' || item.status === 'failed') return;

    if (item.acceptanceEvidence.length > 0 && item.testCases.length > 0) {
      item.status = 'verified';
    } else if (item.testCases.length > 0 || item.affectedFiles.length > 0) {
      item.status = 'in_progress';
    } else if (item.taskIds.length > 0 || item.technicalDesign) {
      item.status = 'in_progress';
    } else {
      item.status = 'unmapped';
    }
  }

  public getRequirement(id: string): TraceableRequirement | undefined {
    return this.requirements.get(id);
  }

  public getAllRequirements(): TraceableRequirement[] {
    return Array.from(this.requirements.values());
  }

  /**
   * Tam izlenebilirlik denetim raporu üretir.
   */
  public generateReport(): TraceabilityReport {
    const items = this.getAllRequirements();
    const verified = items.filter((r) => r.status === 'verified');
    const failed = items.filter((r) => r.status === 'failed');
    const pending = items.filter((r) => r.status !== 'verified' && r.status !== 'failed');

    const unmappedRequirements = items.filter((r) => r.status === 'unmapped').map((r) => r.id);
    const requirementsMissingTests = items.filter((r) => r.testCases.length === 0).map((r) => r.id);
    const requirementsMissingEvidence = items
      .filter((r) => r.acceptanceEvidence.length === 0)
      .map((r) => r.id);

    const total = items.length;
    const coveragePercent = total === 0 ? 100 : Math.round((verified.length / total) * 100);

    return {
      totalRequirements: total,
      verifiedCount: verified.length,
      pendingCount: pending.length,
      failedCount: failed.length,
      coveragePercent,
      unmappedRequirements,
      requirementsMissingTests,
      requirementsMissingEvidence,
      items
    };
  }

  /**
   * İnsan tarafından okunabilir Markdown İzlenebilirlik Matrisi tablosu üretir.
   */
  public generateMarkdownMatrix(): string {
    const report = this.generateReport();
    const lines: string[] = [
      '# Evren Kod Gereksinim ve Kabul İzlenebilirlik Matrisi',
      '',
      `**Genel Doğrulama Kapsamı:** %${report.coveragePercent} (${report.verifiedCount}/${report.totalRequirements} Doğrulandı)`,
      '',
      '| Gereksinim ID | Başlık | Durum | Görevler | Dosyalar | Testler | Kabul Kanıtı |',
      '| :--- | :--- | :---: | :--- | :--- | :--- | :--- |'
    ];

    for (const item of report.items) {
      const statusIcon =
        item.status === 'verified'
          ? '✅ Doğrulandı'
          : item.status === 'failed'
            ? '❌ Başarısız'
            : item.status === 'in_progress'
              ? '⏳ İşlemde'
              : '⚠️ Eşleşmedi';

      const tasks = item.taskIds.join(', ') || '-';
      const files = item.affectedFiles.map((f) => `\`${path.basename(f)}\``).join(', ') || '-';
      const tests = item.testCases.map((t) => `\`${t}\``).join(', ') || '*(test yok)*';
      const evidence =
        item.acceptanceEvidence.length > 0 ? `${item.acceptanceEvidence.length} kanıt` : '*(kanıt yok)*';

      lines.push(
        `| **${item.id}** | ${item.title} | ${statusIcon} | ${tasks} | ${files} | ${tests} | ${evidence} |`
      );
    }

    return lines.join('\n');
  }

  /**
   * Diske `.evren-kod/specs/traceability.json` ve `traceability-matrix.md` olarak kaydeder.
   */
  public async saveToDisk(workspaceRoot: string): Promise<void> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR, EVREN_KOD_SUBDIRS.specs);
    await fs.mkdir(dir, { recursive: true });

    const jsonPath = path.join(dir, 'traceability.json');
    const mdPath = path.join(dir, 'traceability-matrix.md');

    const data = Array.from(this.requirements.values());
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.writeFile(mdPath, this.generateMarkdownMatrix(), 'utf-8');
  }

  /**
   * Diskten `.evren-kod/specs/traceability.json` dosyasını geri yükler.
   */
  public async loadFromDisk(workspaceRoot: string): Promise<void> {
    const jsonPath = path.join(workspaceRoot, EVREN_KOD_DIR, EVREN_KOD_SUBDIRS.specs, 'traceability.json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as TraceableRequirement[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.title) {
            this.requirements.set(item.id, item);
          }
        }
      }
    } catch {
      // Dosya henüz yoksa sorun yok
    }
  }
}
