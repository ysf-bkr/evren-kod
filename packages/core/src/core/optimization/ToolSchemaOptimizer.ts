import { AgentMode, ToolName, WorkflowStage } from '../../shared/types';
import { ToolDefinition } from '../../tools/base';
import { PLAN_MODE_TOOLS } from '../agent/modeTools';

/**
 * Aşamaya göre izin verilen asgari araç kümeleri.
 *
 * Her aşamada yalnızca o aşamanın işini yapması için gereken araçlar
 * modelin şemasına verilir; gereksiz şemalar elenerek %60-75 token
 * tasarrufu sağlanır ve modelin aşama dışı araç çağırması önlenir.
 */
const ONBOARD_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'get_project_knowledge',
  'read_file',
  'list_directory',
  'search_files',
  'find_symbol',
  'read_skill'
]);

const INTAKE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'ask_followup_question',
  'get_project_knowledge',
  'add_knowledge_note',
  'write_knowledge_file',
  'read_file',
  'list_directory',
  'search_files',
  'find_symbol',
  'get_diagnostics',
  'get_definition',
  'get_references',
  'invoke_subagent',
  'write_spec',
  'update_module_plan',
  'update_plan',
  'git_status',
  'git_diff',
  'read_skill'
]);

const SPEC_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'write_spec',
  'update_module_plan',
  'update_plan',
  'read_file',
  'list_directory',
  'search_files',
  'find_symbol',
  'get_diagnostics',
  'get_definition',
  'get_references',
  'get_hover',
  'graph_impact',
  'invoke_subagent',
  'git_status',
  'git_diff',
  'ask_followup_question',
  'get_project_knowledge',
  'read_skill'
]);

const PLAN_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'update_plan',
  'update_module_plan',
  'write_spec',
  'read_file',
  'list_directory',
  'search_files',
  'find_symbol',
  'graph_callers',
  'graph_callees',
  'graph_impact',
  'get_definition',
  'get_references',
  'get_hover',
  'get_diagnostics',
  'invoke_subagent',
  'git_status',
  'git_diff',
  'ask_followup_question',
  'get_project_knowledge',
  'read_skill'
]);

const BUILD_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'read_file',
  'edit_file',
  'write_file',
  'undo_change',
  'list_directory',
  'search_files',
  'find_symbol',
  'execute_command',
  'run_tests',
  'run_linter',
  'get_diagnostics',
  'get_definition',
  'get_references',
  'get_hover',
  'invoke_subagent',
  'run_parallel_tasks',
  'merge_worktree',
  'update_plan',
  'update_module_plan',
  'update_acceptance_criteria',
  'git_status',
  'git_diff',
  'read_skill'
]);

const REVIEW_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'read_file',
  'list_directory',
  'search_files',
  'find_symbol',
  'git_diff',
  'git_status',
  'get_diagnostics',
  'get_references',
  'invoke_subagent',
  'record_release_gate',
  'update_acceptance_criteria',
  'update_plan',
  'update_module_plan',
  'execute_command',
  'run_tests',
  'run_linter',
  'run_verification',
  'read_skill'
]);

const VERIFY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'run_verification',
  'run_tests',
  'run_linter',
  'update_acceptance_criteria',
  'update_module_plan',
  'record_release_gate',
  'read_file',
  'edit_file',
  'write_file',
  'undo_change',
  'list_directory',
  'search_files',
  'get_diagnostics',
  'git_status',
  'git_diff',
  'execute_command',
  'invoke_subagent',
  'read_skill'
]);

const DONE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'record_release_gate',
  'update_acceptance_criteria',
  'git_status',
  'git_diff',
  'read_file',
  'read_skill'
]);

/** Hızlı modda doğrudan kodlama ve doğrulama araçları verilir. */
const FAST_BUILD_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'read_file',
  'edit_file',
  'write_file',
  'undo_change',
  'search_files',
  'list_directory',
  'find_symbol',
  'execute_command',
  'run_tests',
  'run_linter',
  'run_verification',
  'get_diagnostics',
  'get_definition',
  'get_references',
  'git_status',
  'git_diff',
  'update_plan',
  'update_module_plan',
  'update_acceptance_criteria',
  'record_release_gate',
  'read_skill'
]);

/** Planlama modunda kod değiştirme araçları tamamen kilitlidir. */
const PLAN_MODE_ALLOWED: ReadonlySet<ToolName> = PLAN_MODE_TOOLS;

export interface SchemaOptimizationStats {
  originalCount: number;
  filteredCount: number;
  originalEstimatedTokens: number;
  filteredEstimatedTokens: number;
  savedTokens: number;
  reductionPercentage: number;
}

export class ToolSchemaOptimizer {
  /**
   * Belirtilen aşama ve mod için geçerli araç izin kümesini döner.
   */
  public static getAllowedToolNames(stage: WorkflowStage, mode: AgentMode = 'code'): ReadonlySet<ToolName> {
    if (mode === 'fast') {
      if (stage === 'verify') return VERIFY_TOOLS;
      if (stage === 'done') return DONE_TOOLS;
      return FAST_BUILD_TOOLS;
    }

    if (mode === 'plan' || mode === 'education') {
      return PLAN_MODE_ALLOWED;
    }

    switch (stage) {
      case 'onboard':
        return ONBOARD_TOOLS;
      case 'intake':
        return INTAKE_TOOLS;
      case 'spec':
        return SPEC_TOOLS;
      case 'plan':
        return PLAN_TOOLS;
      case 'build':
        return BUILD_TOOLS;
      case 'review':
        return REVIEW_TOOLS;
      case 'verify':
        return VERIFY_TOOLS;
      case 'done':
        return DONE_TOOLS;
      default:
        return BUILD_TOOLS;
    }
  }

  /**
   * Mevcut araç listesini iş akışı aşamasına göre süzerek maskeler.
   */
  public filterTools(
    allTools: ToolDefinition[],
    stage: WorkflowStage,
    mode: AgentMode = 'code'
  ): ToolDefinition[] {
    const allowed = ToolSchemaOptimizer.getAllowedToolNames(stage, mode);
    return allTools.filter((tool) => allowed.has(tool.name));
  }

  /**
   * Araç şemalarının tahmini token tasarrufunu hesaplar.
   */
  public calculateSavings(
    allTools: ToolDefinition[],
    filteredTools: ToolDefinition[]
  ): SchemaOptimizationStats {
    const originalEstimatedTokens = this.estimateToolsTokenFootprint(allTools);
    const filteredEstimatedTokens = this.estimateToolsTokenFootprint(filteredTools);
    const savedTokens = Math.max(0, originalEstimatedTokens - filteredEstimatedTokens);
    const reductionPercentage =
      originalEstimatedTokens > 0 ? Math.round((savedTokens / originalEstimatedTokens) * 100) : 0;

    return {
      originalCount: allTools.length,
      filteredCount: filteredTools.length,
      originalEstimatedTokens,
      filteredEstimatedTokens,
      savedTokens,
      reductionPercentage
    };
  }

  /**
   * Araç şemalarının JSON ve metin büyüklüğünden token sayısını tahmin eder (~3.8 karakter/token).
   */
  public estimateToolsTokenFootprint(tools: ToolDefinition[]): number {
    let charCount = 0;
    for (const tool of tools) {
      charCount += tool.name.length + 8;
      charCount += tool.description ? tool.description.length : 0;
      if (tool.parameters) {
        charCount += JSON.stringify(tool.parameters).length;
      }
    }
    return Math.ceil(charCount / 3.8);
  }
}
