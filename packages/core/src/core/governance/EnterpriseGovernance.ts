/**
 * Kurumsal Yönetim, Yetkilendirme (RBAC) ve Lisans Uyumluluğu (EnterpriseGovernance).
 *
 * Kurumsal şirketler, bankalar ve regülasyona tabi kurumlar için:
 * - Rol Bazlı Erişim Kontrolü (RBAC): Kim kod yazabilir, kim komut çalıştırabilir, kim yayın kapısını onaylayabilir?
 * - Lisans ve Bağımlılık Uyumluluğu: GPL / AGPL gibi virütik lisansların kurumsal koda sızmasını engeller.
 * - Veri Saklama ve Denetim Politikası: snapshot ve denetim kayıtlarının yaşam döngüsünü yönetir.
 */

export type EnterpriseRole = 'admin' | 'lead_developer' | 'developer' | 'auditor' | 'guest';

export type EnterprisePermission =
  | 'can_write_code'
  | 'can_execute_commands'
  | 'can_approve_release_gate'
  | 'can_modify_security_policy'
  | 'can_export_audit_logs'
  | 'can_bypass_safe_commands';

const ROLE_PERMISSIONS: Record<EnterpriseRole, Set<EnterprisePermission>> = {
  admin: new Set([
    'can_write_code',
    'can_execute_commands',
    'can_approve_release_gate',
    'can_modify_security_policy',
    'can_export_audit_logs',
    'can_bypass_safe_commands'
  ]),
  lead_developer: new Set([
    'can_write_code',
    'can_execute_commands',
    'can_approve_release_gate',
    'can_export_audit_logs'
  ]),
  developer: new Set(['can_write_code', 'can_execute_commands']),
  auditor: new Set(['can_export_audit_logs']),
  guest: new Set()
};

export type LicenseComplianceLevel = 'safe' | 'warning' | 'prohibited';

const PERMISSIVE_LICENSES = new Set([
  'MIT',
  'APACHE-2.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'ISC',
  '0BSD',
  'UNLICENSE',
  'CC0-1.0'
]);

const COPYLEFT_LICENSES = new Set(['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'SSPL-1.0']);

export class EnterpriseGovernanceManager {
  /**
   * Belirli bir rolün istenen izne sahip olup olmadığını denetler.
   */
  public hasPermission(role: EnterpriseRole, permission: EnterprisePermission): boolean {
    const perms = ROLE_PERMISSIONS[role];
    return perms ? perms.has(permission) : false;
  }

  /**
   * Açık kaynak kütüphane lisansının kurumsal politikaya uyumunu denetler.
   */
  public checkLicenseCompliance(
    licenseId: string,
    policy: 'permissive-only' | 'standard' = 'permissive-only'
  ): {
    compliant: boolean;
    level: LicenseComplianceLevel;
    license: string;
    reason: string;
  } {
    const normalized = licenseId.trim().toUpperCase();

    if (PERMISSIVE_LICENSES.has(normalized)) {
      return {
        compliant: true,
        level: 'safe',
        license: licenseId,
        reason: 'Kurumsal kullanım için güvenli, izin veren (permissive) lisans.'
      };
    }

    if (COPYLEFT_LICENSES.has(normalized)) {
      const isCompliant = policy === 'standard' && !normalized.includes('AGPL');
      return {
        compliant: isCompliant,
        level: policy === 'permissive-only' ? 'prohibited' : 'warning',
        license: licenseId,
        reason:
          'Güçlü copyleft / telif hakkı devri riski (GPL/AGPL). Kurumsal tescilli kodlar için risklidir.'
      };
    }

    return {
      compliant: false,
      level: 'warning',
      license: licenseId,
      reason: `Bilinmeyen veya özel lisans: ${licenseId}. Hukuk departmanı incelemesi gereklidir.`
    };
  }

  /**
   * Paket manifestindeki (package.json) bağımlılıkların lisanslarını toplu denetler.
   */
  public auditPackageDependencies(
    dependencies: Record<string, string>,
    licenseMap: Record<string, string>,
    policy: 'permissive-only' | 'standard' = 'permissive-only'
  ): {
    totalChecked: number;
    prohibitedCount: number;
    safeCount: number;
    findings: Array<{ pkg: string; license: string; reason: string }>;
  } {
    const findings: Array<{ pkg: string; license: string; reason: string }> = [];
    let prohibitedCount = 0;
    let safeCount = 0;

    for (const pkg of Object.keys(dependencies)) {
      const license = licenseMap[pkg] || 'UNKNOWN';
      const check = this.checkLicenseCompliance(license, policy);
      if (check.level === 'prohibited') {
        prohibitedCount++;
        findings.push({ pkg, license, reason: check.reason });
      } else if (check.level === 'safe') {
        safeCount++;
      } else {
        findings.push({ pkg, license, reason: check.reason });
      }
    }

    return {
      totalChecked: Object.keys(dependencies).length,
      prohibitedCount,
      safeCount,
      findings
    };
  }
}
