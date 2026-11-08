import { TraceableRequirement } from '../spec/TraceabilityManager';

/** Desteklenen harici sorun/görev takip platformları. */
export type IssueTrackerProvider = 'jira' | 'github' | 'gitlab';

/** Harici takip sistemi yapılandırması. */
export interface IssueTrackerConfig {
  provider: IssueTrackerProvider;
  endpointUrl: string;
  projectKey: string;
  apiToken?: string;
  autoSyncStatus?: boolean;
}

/** Harici görev kaydı. */
export interface ExternalIssue {
  id: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  requirementId?: string;
  url: string;
}

/** Senkronizasyon sonucu raporu. */
export interface SyncReport {
  syncedRequirements: number;
  unlinkedRequirements: string[];
  externalIssuesFound: number;
  statusMismatches: Array<{
    requirementId: string;
    externalKey: string;
    localStatus: string;
    remoteStatus: string;
  }>;
}

/**
 * Harici Görev ve Hata Takip Bağlayıcısı (Jira / GitHub / GitLab).
 *
 * Evren Kod TraceabilityManager matrisi ile kurumsal görev yönetim araçları
 * (Jira epic/story, GitHub Issues) arasında çift yönlü izlenebilirlik kurar.
 */
export class IssueTrackerConnector {
  private config: IssueTrackerConfig;
  private externalIssues = new Map<string, ExternalIssue>();

  constructor(config: IssueTrackerConfig) {
    this.config = config;
  }

  /**
   * Harici sorun kaydını kaydeder/önbelleğe alır.
   */
  public registerExternalIssue(issue: ExternalIssue): void {
    this.externalIssues.set(issue.key, issue);
    if (issue.requirementId) {
      this.externalIssues.set(issue.requirementId, issue);
    }
  }

  /**
   * Yerel gereksinim kimliğini harici görev URL'sine bağlar.
   */
  public buildIssueUrl(key: string): string {
    const base = this.config.endpointUrl.replace(/\/+$/, '');
    if (this.config.provider === 'github') {
      return `${base}/${this.config.projectKey}/issues/${key.replace('#', '')}`;
    }
    if (this.config.provider === 'jira') {
      return `${base}/browse/${key}`;
    }
    return `${base}/${this.config.projectKey}/-/issues/${key}`;
  }

  /**
   * TraceableRequirement listesi ile harici görevleri karşılaştırarak uyum raporu çıkarır.
   */
  public reconcileRequirements(requirements: TraceableRequirement[]): SyncReport {
    const unlinkedRequirements: string[] = [];
    const statusMismatches: SyncReport['statusMismatches'] = [];
    let synced = 0;

    for (const req of requirements) {
      const external = this.findMatchingIssue(req);
      if (!external) {
        unlinkedRequirements.push(req.id);
      } else {
        synced++;
        const remoteStatus = this.normalizeRemoteStatus(external.status);
        const localStatus = this.mapLocalRequirementStatus(req);
        if (remoteStatus !== localStatus) {
          statusMismatches.push({
            requirementId: req.id,
            externalKey: external.key,
            localStatus,
            remoteStatus
          });
        }
      }
    }

    return {
      syncedRequirements: synced,
      unlinkedRequirements,
      externalIssuesFound: this.externalIssues.size,
      statusMismatches
    };
  }

  /**
   * Webhook üzerinden gelen harici bildirim yükünü çözümler.
   */
  public parseWebhookPayload(payload: Record<string, unknown>): ExternalIssue | null {
    if (this.config.provider === 'github') {
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue) return null;
      const key = `#${issue.number}`;
      const state = String(issue.state);
      return {
        id: String(issue.id || ''),
        key,
        title: String(issue.title || ''),
        status: state === 'closed' ? 'done' : 'in_progress',
        url: String(issue.html_url || '')
      };
    }

    if (this.config.provider === 'jira') {
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue) return null;
      const key = String(issue.key || '');
      const fields = (issue.fields || {}) as Record<string, unknown>;
      const statusObj = (fields.status || {}) as Record<string, unknown>;
      const statusName = String(statusObj.name || '').toLowerCase();

      return {
        id: String(issue.id || ''),
        key,
        title: String(fields.summary || ''),
        status:
          statusName.includes('done') || statusName.includes('closed')
            ? 'done'
            : statusName.includes('progress')
              ? 'in_progress'
              : 'todo',
        url: this.buildIssueUrl(key)
      };
    }

    return null;
  }

  private findMatchingIssue(req: TraceableRequirement): ExternalIssue | undefined {
    return this.externalIssues.get(req.id) || this.externalIssues.get(req.title);
  }

  private normalizeRemoteStatus(status: ExternalIssue['status']): string {
    return status === 'done' ? 'completed' : status === 'in_progress' ? 'in_progress' : 'pending';
  }

  private mapLocalRequirementStatus(req: TraceableRequirement): string {
    if (req.status === 'verified') return 'completed';
    if (req.status === 'in_progress' || req.status === 'implemented') return 'in_progress';
    return 'pending';
  }
}
