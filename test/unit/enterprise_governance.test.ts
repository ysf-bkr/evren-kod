import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { EnterpriseGovernanceManager } from '@evren-kod/core/core/governance/EnterpriseGovernance';

describe('EnterpriseGovernanceManager: RBAC and license compliance', () => {
  const gov = new EnterpriseGovernanceManager();

  it('enforces RBAC permissions based on enterprise role', () => {
    // Admin her izne sahiptir
    assert.strictEqual(gov.hasPermission('admin', 'can_write_code'), true);
    assert.strictEqual(gov.hasPermission('admin', 'can_approve_release_gate'), true);
    assert.strictEqual(gov.hasPermission('admin', 'can_export_audit_logs'), true);

    // Lead developer yayın kapısını onaylayabilir ama güvenlik politikasını tek başına değiştiremez
    assert.strictEqual(gov.hasPermission('lead_developer', 'can_approve_release_gate'), true);
    assert.strictEqual(gov.hasPermission('lead_developer', 'can_modify_security_policy'), false);

    // Düz developer kod yazabilir ama yayın kapısını onaylayamaz
    assert.strictEqual(gov.hasPermission('developer', 'can_write_code'), true);
    assert.strictEqual(gov.hasPermission('developer', 'can_approve_release_gate'), false);

    // Auditor yalnızca denetim günlüğü dışa aktarabilir
    assert.strictEqual(gov.hasPermission('auditor', 'can_export_audit_logs'), true);
    assert.strictEqual(gov.hasPermission('auditor', 'can_write_code'), false);

    // Guest hiçbir yetkiye sahip değildir
    assert.strictEqual(gov.hasPermission('guest', 'can_write_code'), false);
  });

  it('classifies permissive licenses as safe for enterprise use', () => {
    for (const lic of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC']) {
      const check = gov.checkLicenseCompliance(lic, 'permissive-only');
      assert.strictEqual(check.level, 'safe');
      assert.strictEqual(check.compliant, true);
    }
  });

  it('flags restrictive copyleft licenses (GPL/AGPL) as prohibited or warning', () => {
    const checkGpl = gov.checkLicenseCompliance('GPL-3.0', 'permissive-only');
    assert.strictEqual(checkGpl.level, 'prohibited');
    assert.strictEqual(checkGpl.compliant, false);

    const checkAgpl = gov.checkLicenseCompliance('AGPL-3.0', 'standard');
    assert.strictEqual(checkAgpl.compliant, false);
  });

  it('audits package dependencies against enterprise license policy', () => {
    const deps = {
      react: '^18.0.0',
      'bad-copyleft-lib': '^1.0.0'
    };
    const licenseMap = {
      react: 'MIT',
      'bad-copyleft-lib': 'GPL-3.0'
    };

    const audit = gov.auditPackageDependencies(deps, licenseMap, 'permissive-only');
    assert.strictEqual(audit.totalChecked, 2);
    assert.strictEqual(audit.safeCount, 1);
    assert.strictEqual(audit.prohibitedCount, 1);
    assert.strictEqual(audit.findings[0]?.pkg, 'bad-copyleft-lib');
  });
});
