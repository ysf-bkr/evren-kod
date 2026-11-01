import * as vscode from 'vscode';
import { ToolCall } from '@evren-kod/core/shared/types';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { requestFingerprintApproval } from '@evren-kod/core/core/permission/fingerprintApproval';
import { redactForAudit } from '@evren-kod/core/shared/redaction';
import { AuditLog } from '@evren-kod/core/core/audit/AuditLog';
import { SandboxConfig } from '@evren-kod/core/core/verification/CommandRunner';
import type { AgentCore } from './AgentCore';

const DEFAULT_SANDBOX_IMAGE = 'node:20-bookworm';

/**
 * Onay için duran turda çalışmayacak araç çağrılarını kapatır.
 */
export function closeRemainingToolCalls(calls: ToolCall[], exceptId: string, reason: string): void {
  for (const call of calls) {
    if (call.id === exceptId) continue;
    if (call.status !== 'pending' && call.status !== 'approved') continue;
    call.status = 'rejected';
    call.error = reason;
  }
}

/**
 * İptal/oturum değişikliği nedeniyle yarıda kalan araç çağrılarını işaretler.
 */
export async function markInterruptedToolCalls(core: AgentCore, reason: string): Promise<void> {
  for (const message of core.state.messages) {
    if (!message.toolCalls) continue;
    for (const tc of message.toolCalls) {
      if (tc.status === 'pending' || tc.status === 'approved' || tc.status === 'executing') {
        tc.status = 'rejected';
        tc.error = tc.error || reason;
      }
    }
  }
  if (core.state.pendingToolCall) {
    core.state.pendingToolCall.status = 'rejected';
    core.state.pendingToolCall.error = core.state.pendingToolCall.error || reason;
  }
}

/**
 * Araç kararlarını `.evren-kod/audit.log` dosyasına yazar (P1-07).
 */
export async function auditTool(
  tc: ToolCall,
  workspaceRoot: string | undefined,
  decision: string
): Promise<void> {
  if (!workspaceRoot) return;
  try {
    const args = JSON.stringify(tc.args || {}, redactForAudit).slice(0, 1000);
    await AuditLog.append(workspaceRoot, { decision, tool: tc.name, args });
  } catch {
    // Denetim logu yazılamadı; ana akışı engelleme.
  }
}

/**
 * Docker sandbox yapılandırmasını çözer.
 */
export function getSandboxConfig(core: AgentCore, workspaceRoot?: string): SandboxConfig | undefined {
  const sandbox = core.settings.sandbox;
  if (!sandbox || sandbox.mode !== 'docker' || !workspaceRoot) {
    return undefined;
  }
  return {
    image: sandbox.image || DEFAULT_SANDBOX_IMAGE,
    workspaceRoot,
    network: sandbox.network
  };
}

/**
 * Depoda tanımlı hook'lar için ilk kullanım onayını sorar.
 */
export async function confirmWorkspaceHooks(
  core: AgentCore,
  fingerprint: string,
  commands: string[]
): Promise<boolean> {
  const root = getActiveWorkspaceRoot();
  if (!root) return false;

  const preview = commands
    .slice(0, 5)
    .map((command) => `• ${command}`)
    .join('\n');

  return requestFingerprintApproval({
    scope: 'hooks',
    workspaceRoot: root,
    fingerprint,
    store: core.context.workspaceState,
    ask: async () => {
      const choice = await vscode.window.showWarningMessage(
        'Bu proje, .evren-kod/hooks.json içindeki hook komutlarını çalıştırmak istiyor.',
        {
          modal: true,
          detail:
            `Hook komutları bilgisayarınızda çalışır ve her araç çağrısında tetiklenebilir. ` +
            `Yalnızca güvendiğiniz projelerde onaylayın.\n\n${preview}` +
            (commands.length > 5 ? `\n… ve ${commands.length - 5} komut daha` : '')
        },
        'Çalıştır',
        'Atla'
      );
      return choice === 'Çalıştır';
    }
  });
}

/**
 * Bir doğrulama komutunun otomatik çalıştırılabilirliğini denetler.
 */
export function canAutoRunVerificationCommand(core: AgentCore, command: string): boolean {
  if (!vscode.workspace.isTrusted) return false;
  const blocked = core.permissionManager.isToolBlocked('execute_command', { command });
  if (blocked.blocked) return false;
  return !core.permissionManager.requiresApproval('execute_command', { command });
}
