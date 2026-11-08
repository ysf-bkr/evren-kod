import { AgentMode, ModelProviderType, ToolName, WorkflowStage } from '../../shared/types';
import { ToolDefinition } from '../../tools/base';
import { ProviderMessage } from '../../providers/base';
import { ToolSchemaOptimizer, SchemaOptimizationStats } from './ToolSchemaOptimizer';
import { TokenBudgetManager, PhaseBudgetStatus } from './TokenBudgetManager';
import { OutputOptimizer } from './OutputOptimizer';
import { ToolDeduplicator } from './ToolDeduplicator';
import { ContextOptimizer } from './ContextOptimizer';
import { StructuredWorkingMemory } from './StructuredWorkingMemory';
import { ProviderCacheManager, CacheOptimizationResult } from './ProviderCacheManager';
import { TokenObservability, CallTokenMetrics, TaskObservabilitySummary } from './TokenObservability';

export interface OptimizationEngineOptions {
  contextWindowTokens?: number;
  providerType?: ModelProviderType | string;
  initialGoal?: string;
}

export class TokenOptimizationEngine {
  public readonly schemaOptimizer: ToolSchemaOptimizer;
  public readonly budgetManager: TokenBudgetManager;
  public readonly outputOptimizer: OutputOptimizer;
  public readonly deduplicator: ToolDeduplicator;
  public readonly contextOptimizer: ContextOptimizer;
  public readonly workingMemory: StructuredWorkingMemory;
  public readonly cacheManager: ProviderCacheManager;
  public readonly observability: TokenObservability;

  private providerType: ModelProviderType | string;

  constructor(options: OptimizationEngineOptions = {}) {
    this.schemaOptimizer = new ToolSchemaOptimizer();
    this.budgetManager = new TokenBudgetManager();
    this.outputOptimizer = new OutputOptimizer();
    this.deduplicator = new ToolDeduplicator();
    this.contextOptimizer = new ContextOptimizer();
    this.workingMemory = new StructuredWorkingMemory(options.initialGoal);
    this.cacheManager = new ProviderCacheManager();
    this.observability = new TokenObservability();

    this.providerType = options.providerType ?? 'evren';
    if (options.contextWindowTokens) {
      this.budgetManager.scaleForContextWindow(options.contextWindowTokens);
    }
  }

  /**
   * 1. AŞAMA: Araç şemalarını aşamaya göre maskeler ve tasarruf oranını hesaplar.
   */
  public optimizeToolsForStage(
    allTools: ToolDefinition[],
    stage: WorkflowStage,
    mode: AgentMode = 'code'
  ): { tools: ToolDefinition[]; stats: SchemaOptimizationStats } {
    const filtered = this.schemaOptimizer.filterTools(allTools, stage, mode);
    const stableTools = this.cacheManager.getStableToolSchemas(filtered);
    const stats = this.schemaOptimizer.calculateSavings(allTools, stableTools);
    return { tools: stableTools, stats };
  }

  /**
   * 2. AŞAMA: Araç çıktısını türüne göre optimize eder (AST iskeleti, test/diff temizleme).
   */
  public optimizeToolOutput(
    toolName: ToolName | string,
    rawOutput: string,
    args?: Record<string, unknown>
  ): string {
    if (toolName === 'read_file') {
      const filePath =
        typeof args?.filePath === 'string' ? args.filePath : typeof args?.path === 'string' ? args.path : '';
      const offset = typeof args?.offset === 'number' ? args.offset : undefined;
      const limit = typeof args?.limit === 'number' ? args.limit : undefined;
      return this.outputOptimizer.optimizeReadFile(filePath, rawOutput, { offset, limit });
    }

    if (toolName === 'run_tests' || toolName === 'run_linter') {
      return this.outputOptimizer.optimizeTestOutput(rawOutput);
    }

    if (toolName === 'execute_command') {
      return this.outputOptimizer.optimizeTerminalOutput(rawOutput);
    }

    if (toolName === 'git_diff') {
      return this.outputOptimizer.optimizeDiffOutput(rawOutput);
    }

    return rawOutput;
  }

  /**
   * 3. AŞAMA: Yinelenen dosya okumalarını ve komutları deduplicate eder.
   */
  public checkToolDeduplication(
    toolName: ToolName | string,
    args: Record<string, unknown>,
    contentGetter?: () => { content: string; mtimeMs: number }
  ): { isDuplicate: boolean; note?: string } {
    if (toolName === 'read_file' && contentGetter) {
      const filePath =
        typeof args?.filePath === 'string' ? args.filePath : typeof args?.path === 'string' ? args.path : '';
      const { content, mtimeMs } = contentGetter();
      return this.deduplicator.checkFileRead(filePath, mtimeMs, content, args.offset, args.limit);
    }

    return { isDuplicate: false };
  }

  /**
   * Dosya düzenlendiğinde reaktif düşürme ve sürüm kaydı yapar.
   */
  public handleFileMutation(filePath: string, content: string, additions = 0, deletions = 0): void {
    const hash = this.deduplicator.hashContent(content);
    this.contextOptimizer.recordFileInsight(filePath, content, hash);
    this.deduplicator.invalidateFile(filePath);
    this.workingMemory.recordModifiedFile(filePath, additions, deletions, 'modified');
  }

  /**
   * 4. AŞAMA: Mesajları reaktif sıkıştırma ve önbellek dostu düzende kurar.
   */
  public assembleOptimizedConversation(
    systemPrompt: string,
    messages: ProviderMessage[],
    _activeStage?: WorkflowStage,
    editedFiles: string[] = [],
    tailContext?: string
  ): CacheOptimizationResult {
    // 1. Reaktif dosya düşürme (düzenlenen dosyaların eski ham gövdelerini düşür, sembolleri koru)
    let optimizedMessages = messages;
    for (const editedPath of editedFiles) {
      optimizedMessages = this.contextOptimizer.reactiveEvict(optimizedMessages, editedPath);
    }

    // 2. Yapılandırılmış çalışma hafızasını tail'e entegre et
    const memoryPrompt = this.workingMemory.formatForPrompt();
    const mergedTail = tailContext ? `${memoryPrompt}\n\n${tailContext}` : memoryPrompt;

    // 3. Sağlayıcı önbellek mimarisiyle derle
    return this.cacheManager.buildOptimizedConversation(
      systemPrompt,
      optimizedMessages,
      mergedTail,
      this.providerType
    );
  }

  /**
   * 5. AŞAMA: Model çağrısının harcama ve gözlemlenebilirlik metriklerini kaydeder.
   */
  public recordApiCallMetrics(metrics: CallTokenMetrics, currentStage: WorkflowStage): void {
    this.observability.recordCall(metrics);
    this.budgetManager.recordSpend(currentStage, metrics.inputTokens, metrics.outputTokens);
  }

  /**
   * Aktif aşamanın bütçe durumunu döner.
   */
  public getPhaseBudgetStatus(stage: WorkflowStage): PhaseBudgetStatus {
    return this.budgetManager.getPhaseStatus(stage);
  }

  /**
   * Görev genel raporunu üretir.
   */
  public getObservabilitySummary(): TaskObservabilitySummary {
    return this.observability.getSummary();
  }

  /**
   * Sağlayıcı türünü günceller.
   */
  public updateProvider(providerType: ModelProviderType | string): void {
    this.providerType = providerType;
  }

  /**
   * Tüm motor durumunu yeni görev için sıfırlar.
   */
  public reset(newGoal = ''): void {
    this.budgetManager.reset();
    this.deduplicator.reset();
    this.contextOptimizer.reset();
    this.workingMemory.reset(newGoal);
    this.observability.reset();
  }
}
