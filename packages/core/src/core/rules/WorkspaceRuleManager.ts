import * as path from 'path';
import * as fs from 'fs/promises';

export interface WorkspaceRulesSnapshot {
  agentsMd?: string;
  evrenKodRules?: string;
}

const AGENTS_FILES = ['AGENTS.md', 'agent.md', '.agents.md'];
const RULE_FILES = ['.evren-kod-rules', 'evren-kod_rules.md'];

async function readFirst(root: string, candidates: string[]): Promise<string | undefined> {
  for (const file of candidates) {
    try {
      const content = (await fs.readFile(path.join(root, file), 'utf-8')).trim();
      if (content) return content;
    } catch {
      // Sıradaki adayı dene.
    }
  }
  return undefined;
}

/**
 * AGENTS.md ve .evren-kod-rules gibi çalışma alanı kurallarını tek noktadan yükler.
 * Öncelik: açık .evren-kod-rules kuralları > AGENTS.md.
 */
export class WorkspaceRuleManager {
  private snapshot: WorkspaceRulesSnapshot = {};

  public async load(workspaceRoot?: string): Promise<void> {
    this.snapshot = {};
    if (!workspaceRoot) return;
    const [agentsMd, rulesContent] = await Promise.all([
      readFirst(workspaceRoot, AGENTS_FILES),
      readFirst(workspaceRoot, RULE_FILES)
    ]);
    this.snapshot = { agentsMd, evrenKodRules: rulesContent };
  }

  public getAgentsMd(): string | undefined {
    return this.snapshot.agentsMd;
  }

  public getEvrenRules(): string | undefined {
    return this.snapshot.evrenKodRules;
  }

  public formatForPrompt(): string {
    const parts: string[] = [];
    if (this.snapshot.agentsMd) {
      const content =
        this.snapshot.agentsMd.length > 20_000
          ? `${this.snapshot.agentsMd.slice(0, 20_000)}\n... [AGENTS.md truncated]`
          : this.snapshot.agentsMd;
      parts.push(`=== AGENTS.MD INSTRUCTIONS ===\n${content}`);
    }
    const rules = this.getEvrenRules();
    if (rules) {
      const content =
        rules.length > 8_000 ? `${rules.slice(0, 8_000)}\n... [.evren-kod-rules truncated]` : rules;
      parts.push(
        `=== PROJECT-SPECIFIC RULES (.evren-kod-rules) ===\n` +
          `These rules take precedence if they conflict with AGENTS.md.\n${content}`
      );
    }
    return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
  }
}
