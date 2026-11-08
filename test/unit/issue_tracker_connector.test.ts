import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { IssueTrackerConnector } from '@evren-kod/core/core/integrations/IssueTrackerConnector';
import { TraceableRequirement } from '@evren-kod/core/core/spec/TraceabilityManager';

describe('IssueTrackerConnector: Jira ve GitHub entegrasyonu', () => {
  it('GitHub URL ve webhook yükünü doğru çözümler', () => {
    const connector = new IssueTrackerConnector({
      provider: 'github',
      endpointUrl: 'https://github.com',
      projectKey: 'evren-kod/core'
    });

    const url = connector.buildIssueUrl('#42');
    assert.strictEqual(url, 'https://github.com/evren-kod/core/issues/42');

    const issue = connector.parseWebhookPayload({
      issue: {
        id: 101,
        number: 42,
        title: 'Rollback güvenliği',
        state: 'open',
        html_url: url
      }
    });

    assert.ok(issue);
    assert.strictEqual(issue.key, '#42');
    assert.strictEqual(issue.status, 'in_progress');
  });

  it('Traceability matrisi ile harici sorunları karşılaştırıp uyum raporu üretir', () => {
    const connector = new IssueTrackerConnector({
      provider: 'jira',
      endpointUrl: 'https://jira.company.com',
      projectKey: 'EVR'
    });

    connector.registerExternalIssue({
      id: 'jira-1',
      key: 'EVR-101',
      title: 'Kullanıcı Kimlik Doğrulama',
      status: 'done',
      requirementId: 'REQ-AUTH',
      url: 'https://jira.company.com/browse/EVR-101'
    });

    const requirements: TraceableRequirement[] = [
      {
        id: 'REQ-AUTH',
        title: 'Kullanıcı Kimlik Doğrulama',
        description: 'Güvenli giriş',
        technicalDesign: 'JWT',
        taskIds: ['task-1'],
        affectedFiles: ['src/auth.ts'],
        testCases: ['tc-1'],
        acceptanceEvidence: ['proof.png'],
        status: 'verified',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'REQ-MISSING',
        title: 'Eksik Görev',
        description: 'Henüz başlanmadı',
        taskIds: [],
        affectedFiles: [],
        testCases: [],
        acceptanceEvidence: [],
        status: 'unmapped',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    const report = connector.reconcileRequirements(requirements);
    assert.strictEqual(report.syncedRequirements, 1);
    assert.strictEqual(report.unlinkedRequirements.length, 1);
    assert.strictEqual(report.unlinkedRequirements[0], 'REQ-MISSING');
    assert.strictEqual(report.statusMismatches.length, 0);
  });
});
