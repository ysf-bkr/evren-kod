import { createSubagentManager, runSubagentFromUi } from './agentSubagentFactory';
import { buildEditorContext, openDiffPreview, openFileInEditor } from './agentEditorBridge';
import { recordProjectMemory, ensureSessionPersistence } from './agentMemoryOps';
import { buildEmbeddingIndex, normalizeRestoredState, restoreInitialState } from './agentStateUtils';
import { runAgentTurn } from './agentTurnCoordinator';
import { createSharedServices, SharedServices } from './sharedServices';
export { createSharedServices, SharedServices };
import {
  auditTool,
  canAutoRunVerificationCommand,
  closeRemainingToolCalls,
  confirmWorkspaceHooks,
  getSandboxConfig,
  markInterruptedToolCalls
} from './agentSecurityHooks';
import * as vscode from 'vscode';
import { AgentMode, TaskState, ToolCall, UserSettings } from '@evren-kod/core/shared/types';
import { createModelProvider } from '@evren-kod/core/providers';
import { ModelProvider } from '@evren-kod/core/providers/base';
import { PermissionManager } from '@evren-kod/core/core/permission/PermissionManager';
import { HistoryManager } from '../memory/HistoryManager';
import { McpHub } from '../mcp/McpHub';
import { SubagentManager } from '@evren-kod/core/core/multiagent/SubagentManager';
import { SkillManager } from '@evren-kod/core/core/skills/SkillManager';
import { LspClient } from '../lsp/LspClient';
import { SnapshotManager } from '@evren-kod/core/core/snapshot/SnapshotManager';
import { HookManager } from '@evren-kod/core/core/hooks/HookManager';
import { CheckpointManager } from '@evren-kod/core/core/checkpoint/CheckpointManager';
import { ContextManager } from '@evren-kod/core/core/context/ContextManager';
import { TokenOptimizationEngine, FileLockManager } from '@evren-kod/core';
import { MODEL_TOOLS } from '@evren-kod/core/tools';
import { ReadDeduper } from '@evren-kod/core/core/agent/readDeduper';
import { ProjectMemoryManager, ProjectMemoryStatus } from '@evren-kod/core/core/memory/ProjectMemoryManager';
import { VectorMemory } from '@evren-kod/core/core/memory/VectorMemory';
import { runInIntegratedTerminal } from './terminalExecution';
import { SessionPersistence } from '@evren-kod/core/core/agent/sessionPersistence';
import { CallGraphManager } from '@evren-kod/core/core/callgraph/CallGraphManager';
import type { WorkflowStage } from '@evren-kod/core/core/workflow/TaskWorkflow';
import { WorkflowController } from './workflowController';
import { SessionController } from './sessionController';
import { ToolPipelineController } from './toolPipelineController';
import { VerificationController } from './verificationController';
import { AgentLoop } from './agentLoop';
import type { AgentHost, SessionPort, ToolPipelinePort, VerificationPort } from './agentHost';
import { createLspLanguageService } from '@evren-kod/core/core/callgraph/languageService';
import { KnowledgeCurator } from '@evren-kod/core/core/agent/KnowledgeCurator';
import { SubagentTaskParams } from '@evren-kod/core/core/multiagent/SubagentManager';
import { TaskPlanner } from '@evren-kod/core/core/plan/TaskPlanner';
import { ModulePlanner } from '@evren-kod/core/core/plan/ModulePlanner';
import { CommandCheckpoint, GitManager } from '@evren-kod/core/core/git/GitManager';
import { WorkspaceRuleManager } from '@evren-kod/core/core/rules/WorkspaceRuleManager';
import { logWarning } from '@evren-kod/core/shared/logging';
import { VerificationManager } from '@evren-kod/core/core/verification/VerificationManager';
import { SandboxConfig } from '@evren-kod/core/core/verification/CommandRunner';
import { ModelRouter } from '@evren-kod/core/core/routing/ModelRouter';
import { WorktreeManager } from '@evren-kod/core/core/worktree/WorktreeManager';
import { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { EmbeddingIndex } from '@evren-kod/core/core/knowledge/EmbeddingIndex';
import { SpecStore } from '@evren-kod/core/core/spec/SpecStore';
import { createWorkflowState, normalizeStageForMode } from '@evren-kod/core/core/workflow/TaskWorkflow';

/** Programatik (kullanıcı kaynaklı olmayan) turlar için ek kontrol bayrakları. */
export interface SendMessageOptions {
  /**
   * İç devam turu (örneğin spec/plan onayından sonra). Kullanıcı balonu veya
   * editör içeriği eklenmez; talimat sistem mesajı olarak kaydedilir ki
   * model karar hafızasını korusun.
   */
  internal?: boolean;
}

/** Testlerin sahte nesnelerle değiştirdiği isteğe bağlı iş birlikçiler. */
export interface AgentCoreDependencies {
  /** Ayarlardan kurulan sağlayıcıyı geçersiz kılar (testler betikleşmiş model kullanır). */
  provider?: ModelProvider;
  /**
   * Geri yüklenecek oturum kimliği. Verilmezse `workspaceState` içindeki son
   * etkin oturum açılır (tek oturumlu kullanım). `null` verilirse boş bir
   * oturumla başlanır — yeni sohbet açarken bu kullanılır.
   */
  initialSessionId?: string | null;
  /**
   * Oturumlar arasında paylaşılan ağır servisler. Birden çok oturum aynı anda
   * çalıştığında MCP sunucuları, dil sunucusu, çağrı haritası ve bilgi tabanı
   * ikinci kez kurulmaz.
   */
  shared?: SharedServices;
}

export class AgentCore implements AgentHost {
  public state: TaskState;
  public provider: ModelProvider;
  public permissionManager: PermissionManager;
  public historyManager: HistoryManager;
  public mcpHub: McpHub;
  public subagentManager: SubagentManager;
  public skillManager: SkillManager;
  public lspClient: LspClient;
  public hookManager: HookManager;
  public contextManager: ContextManager;
  public optimizationEngine: TokenOptimizationEngine;
  public fileLockManager = new FileLockManager();
  /** "Aynı dosyayı tekrar okuma" döngüsünü engelleyen bekçi (araç hattında çalışır). */
  public readDeduper = new ReadDeduper();
  private knowledgeWarmedRoot?: string;

  /**
   * Görev başlangıcında bilgi tabanını arka planda ısıtır: "bir şeyler
   * oluşturuluyor ama bakılmıyor" hâlinin kökü, indeksin hiçbir zaman
   * kendiliğinden kurulmamasıydı — sistem istemine giren özet o yüzden hep
   * boştu. Isıtma hiç model çağrısı yapmaz (yalnızca yerel tarama) ve görevi
   * bekleterek başlamaz; ilk tur eksikse get_project_knowledge zaten kendi
   * tazelemesini yapar, sonraki turlar özetle açılır.
   */
  public warmKnowledgeBase(workspaceRoot: string): void {
    if (!workspaceRoot || this.knowledgeWarmedRoot === workspaceRoot) return;
    this.knowledgeWarmedRoot = workspaceRoot;
    void this.knowledgeStore
      .ensureFresh(workspaceRoot)
      .then(() => {
        // Bilgi tabanı ekranı ve rozetleri taze durumu hemen görsün.
        this.emitState();
      })
      .catch((err) => {
        this.knowledgeWarmedRoot = undefined; // sonraki görevde yeniden dene
        logWarning('Knowledge base auto-indexing failed', err);
      });
  }
  public projectMemory = new ProjectMemoryManager();
  public planner = new TaskPlanner();
  public modulePlanner = new ModulePlanner();
  public verificationManager = new VerificationManager();
  public modelRouter = new ModelRouter();
  public worktreeManager = new WorktreeManager();
  public gitManager = new GitManager();
  public workspaceRules = new WorkspaceRuleManager();
  public knowledgeStore = new KnowledgeStore();
  public specStore = new SpecStore();
  public settings: UserSettings;
  public repairAttempts = 0;
  public baselineCaptured = false;
  /** Oturum/kök başına geri alma kayıtları. */
  public persistence = new SessionPersistence();
  /** Salt-okunur çağrı haritası (fonksiyon çağrı ilişkileri). */
  public callGraphManager: CallGraphManager;
  /** Yönlendirilmiş iş akışı denetleyicisi. */
  public workflow!: WorkflowController;
  public sessionController!: SessionController;
  public toolPipeline!: ToolPipelineController;
  public verificationController!: VerificationController;
  public loop!: AgentLoop;
  public session!: SessionPort;
  public tools!: ToolPipelinePort;
  public verification!: VerificationPort;
  /** Her komuttan önce alınan checkpoint; yan etkiler geri alınabilsin diye. */
  public commandCheckpoints = new Map<string, CommandCheckpoint>();
  public lastVerificationSkip = '';
  /** Son turda dosyaların değişip değişmediği (yalnızca yazma değil, her araç). */
  public changedFilesInLastTurn = false;

  /**
   * Aynı araç + aynı argüman kümesi art arda kaç kez hata aldı? Model aynı
   * başarısız çağrıyı sonsuza dek tekrarlayabilir; üçüncüde tur duraklatılır
   * (denetim bulgusu: tek başına ReadDeduper döngü koruması değildi).
   */
  public lastToolFailure: { key: string; count: number } | undefined;
  /** Güncel build turunun üstlendiği plan adımı; dürüst ilerleme göstergesi için. */
  public activePlanStepId: string | undefined;
  /** Otonom modda yapılan otomatik devam sayısı (döngü koruması). */
  public autoContinuations = 0;

  public isCancelled: boolean = false;
  public runGeneration = 0;
  public messageSeq = 0;
  public activeAbortController?: AbortController;
  public currentTurnId?: string;
  public pendingResolver?: (approved: boolean, reason?: string) => void;
  public pendingQuestionResolver?: (answer: string) => void;
  private messageLock = false;
  /** Bilgi tabanı üzerinde yerel anlamsal arama (isteğe bağlı). */
  public embeddingIndex?: EmbeddingIndex;
  /** Vektör bellek (geçmiş görevler + proje bilgi tabanı). */
  public vectorMemory: VectorMemory;
  /** Tembel özetleme, LSP zenginleştirme ve bilgi tabanı prompt dürtmeleri. */
  public knowledgeCurator: KnowledgeCurator;
  /** Görev sonu bilgi kaydı talimatının görev başına yalnızca bir kez çalışmasını sağlar. */
  public memoryRecordedForTask = false;

  private customProviderInjected = false;
  /** Paylaşılan servislerin ömrünü bu çekirdek yönetiyor mu (tek oturumlu kullanım)? */
  private readonly ownsShared: boolean;

  constructor(
    public context: vscode.ExtensionContext,
    settings: UserSettings,
    public onStateUpdate: (state: TaskState) => void,
    public notify: (notification: { level: 'info' | 'warning' | 'error'; message: string }) => void,
    public onStreamChunk?: (messageId: string, chunk: string) => void,
    dependencies: AgentCoreDependencies = {}
  ) {
    this.settings = settings;
    this.customProviderInjected = Boolean(dependencies.provider);
    this.ownsShared = !dependencies.shared;
    this.provider = dependencies.provider ?? createModelProvider(settings);
    this.permissionManager = new PermissionManager(settings);
    this.refreshEmbeddingIndex();
    // Paylaşılan servisler verilmişse ikinci bir MCP/LSP/indeks kurulmaz.
    const shared = dependencies.shared;
    this.historyManager = shared?.historyManager ?? new HistoryManager(context);
    this.mcpHub = shared?.mcpHub ?? new McpHub(context.workspaceState);
    this.skillManager = shared?.skillManager ?? new SkillManager();
    this.lspClient = shared?.lspClient ?? new LspClient();
    this.projectMemory = shared?.projectMemory ?? new ProjectMemoryManager();
    this.knowledgeStore = shared?.knowledgeStore ?? new KnowledgeStore();
    this.specStore = shared?.specStore ?? new SpecStore();
    this.workspaceRules = shared?.workspaceRules ?? new WorkspaceRuleManager();
    this.worktreeManager = shared?.worktreeManager ?? new WorktreeManager();
    this.gitManager = shared?.gitManager ?? new GitManager();
    this.hookManager = new HookManager(
      () => vscode.workspace.isTrusted,
      (fingerprint, commands) => this.confirmWorkspaceHooks(fingerprint, commands)
    );
    this.contextManager = new ContextManager({
      contextWindowTokens: this.settings.contextWindowTokens,
      tools: MODEL_TOOLS,
      digestFor: (relativePath) => this.knowledgeStore.digestFor(relativePath)
    });
    this.optimizationEngine = new TokenOptimizationEngine({
      contextWindowTokens: this.settings.contextWindowTokens,
      providerType: this.settings.selectedProvider
    });
    this.callGraphManager =
      shared?.callGraphManager ??
      new CallGraphManager({
        enabled: () => this.settings.callGraph?.enabled !== false,
        language: (workspaceRoot) => createLspLanguageService(this.lspClient, workspaceRoot)
      });
    this.knowledgeCurator = new KnowledgeCurator(this.knowledgeStore, this.provider, this.lspClient);
    this.vectorMemory = new VectorMemory(this.projectMemory, this.knowledgeStore, () => this.embeddingIndex);
    this.verificationManager.setCommandFilter((command) => this.canAutoRunVerificationCommand(command));

    this.subagentManager = this.createSubagentManager();
    this.workflow = new WorkflowController(this);
    this.sessionController = new SessionController(this);
    this.toolPipeline = new ToolPipelineController(this);
    this.verificationController = new VerificationController(this);
    this.loop = new AgentLoop(this);
    this.session = this.sessionController;
    this.tools = this.toolPipeline;
    this.verification = this.verificationController;

    // Hangi oturumun açılacağı çağıran tarafından belirlenir: çok oturumlu
    // kullanımda her çekirdek aynı "son oturum"u yüklememeli.
    this.state = this.restoreInitialState(dependencies.initialSessionId);
    this.planner.hydrate(this.state.plan);
    this.modulePlanner.hydrate(this.state.modules);
  }

  /** Başlangıç durumu: verilen oturum, son etkin oturum ya da boş oturum. */
  private restoreInitialState(initialSessionId?: string | null): TaskState {
    return restoreInitialState(initialSessionId, this.context, this.historyManager, (m) =>
      this.getInitialState(m)
    );
  }

  private createSubagentManager(): SubagentManager {
    return createSubagentManager(this);
  }

  /**
   * Etkin snapshot/checkpoint yöneticileri değişince bağımlı yardımcı
   * yöneticileri yeniden kurar.
   */
  public rebuildPersistenceDependents(): void {
    this.subagentManager = this.createSubagentManager();
  }

  /**
   * Eklenti yeniden yüklendiğinde yarıda kalan "running/waiting" durumlarını
   * güvenli "paused" durumuna döndürür ve görevin kaldığı yerden sürdürülebilmesini sağlar.
   */
  public normalizeRestoredState(saved: TaskState): TaskState {
    return normalizeRestoredState(saved, (m) => this.getInitialState(m));
  }

  public updateSettings(newSettings: UserSettings) {
    this.settings = newSettings;
    this.provider = createModelProvider(newSettings);
    this.permissionManager.updateSettings(newSettings);
    // Durumsuz olduğu için güvenle yeniden kurulur; yeni pencere hemen etkili olur.
    this.contextManager = new ContextManager({
      contextWindowTokens: newSettings.contextWindowTokens,
      tools: MODEL_TOOLS,
      digestFor: (relativePath) => this.knowledgeStore.digestFor(relativePath)
    });
    this.optimizationEngine.updateProvider(newSettings.selectedProvider);
    this.refreshEmbeddingIndex();
    // Küratör sağlayıcı referansını tutar; yenisiyle yeniden kurulur.
    this.knowledgeCurator = new KnowledgeCurator(this.knowledgeStore, this.provider, this.lspClient);
    this.rebuildPersistenceDependents();
  }

  /**
   * Ayarlara göre yerel/anlamsal arama indeksini kurar ya da düşürür.
   */
  private refreshEmbeddingIndex(): void {
    this.embeddingIndex = buildEmbeddingIndex(this.settings);
  }

  /**
   * Eklenti kapanırken alt süreçleri ve bekleyen işlemleri temizler.
   */
  public dispose(): void {
    this.isCancelled = true;
    this.runGeneration++;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }
    this.pendingResolver?.(false, 'Eklenti kapatıldı.');
    this.pendingResolver = undefined;
    this.pendingQuestionResolver?.('Extension closed.');
    this.pendingQuestionResolver = undefined;
    // MCP sunucuları paylaşılıyorsa yalnızca bu oturum kapatıldığında
    // diğer sohbetlerin bağlantıları kesilmemeli. Son oturum kapanınca
    // kayıt defteri `stopAll()` çağırır.
    if (this.ownsSharedServices) this.mcpHub.stopAll();
  }

  /** Paylaşılan MCP/LSP servislerinin ömrünü bu çekirdek yönetiyor mu? */
  public get ownsSharedServices(): boolean {
    return this.ownsShared;
  }

  public setMode(mode: AgentMode) {
    if (this.isBusy()) {
      this.notify({
        level: 'warning',
        message: 'Ajan çalışırken mod değiştirilemez. Önce görevi tamamlayın veya durdurun.'
      });
      this.emitState();
      return;
    }
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    // Salt-kod aşamaları (build/verify) planlama modunda yoktur; aşamayı
    // geçerli tut ki ilerleme şeridi erişilemez bir adım göstermesin.
    const workflow = this.workflow.getWorkflow();
    const normalized = normalizeStageForMode(workflow.stage, mode);
    if (normalized !== workflow.stage) {
      workflow.stage = normalized;
      workflow.updatedAt = Date.now();
      this.workflow.syncProgressToState();
    }
    this.emitState();
    this.notify({
      level: 'info',
      message:
        mode === 'plan'
          ? 'Planlama modu etkin: yalnızca analiz ve plan; dosya değişikliği ve komut çalıştırma devre dışı.'
          : mode === 'education'
            ? 'Eğitim modu etkin: rehber anlatır, örnekleri sohbette gösterir; dosya değişikliği ve komut çalıştırma devre dışı.'
            : mode === 'fast'
              ? 'Hızlı mod etkin: bürokratik soru ve modül planı olmadan doğrudan düzeltme ve doğrulama.'
              : 'Kodlama modu etkin: ajan dosya ve komut araçlarını kullanabilir.'
    });
  }

  /** Yürürlükteki anlık görüntü yöneticisi (oturum/kök değişince yenilenir). */
  public get snapshotManager(): SnapshotManager {
    return this.persistence.snapshotManager;
  }

  /** Yürürlükteki checkpoint yöneticisi (oturum/kök değişince yenilenir). */
  public get checkpointManager(): CheckpointManager {
    return this.persistence.checkpointManager;
  }

  /** Salt-okunur çağrı haritası yöneticisi (arayüz ve testler için). */
  public getCallGraphManager(): CallGraphManager {
    return this.callGraphManager;
  }
  public getHistoryManager(): HistoryManager {
    return this.historyManager;
  }
  public getProjectMemory(): ProjectMemoryManager {
    return this.projectMemory;
  }
  public getMcpHub(): McpHub {
    return this.mcpHub;
  }
  public getSkillManager(): SkillManager {
    return this.skillManager;
  }
  public getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }
  public getLspClient(): LspClient {
    return this.lspClient;
  }
  public getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }
  public getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }
  public getTaskPlanner(): TaskPlanner {
    return this.planner;
  }
  public getVerificationManager(): VerificationManager {
    return this.verificationManager;
  }
  public getKnowledgeStore(): KnowledgeStore {
    return this.knowledgeStore;
  }
  public getSpecStore(): SpecStore {
    return this.specStore;
  }
  public getGitManager(): GitManager {
    return this.gitManager;
  }

  /**
   * Alt ajanı doğrudan arayüzden (Ajanlar & Yetenekler ekranı) çalıştırır.
   *
   * Görevi açıkça isteyen ve tanımlayan kullanıcıdır; bu isteğin kendisi
   * onaydır — modelin başlattığı aynı işlem normal araç onay akışından geçer.
   * Sonuç sohbete kaydedilir ki oturum geçmişinde görünür kalsın.
   */
  public async runSubagentFromUi(params: SubagentTaskParams): Promise<string> {
    return runSubagentFromUi(this, params);
  }

  // --- Eski genel API: denetleyicilere delege ---
  public createNewSession(mode?: AgentMode): Promise<void> {
    return this.sessionController.createNewSession(mode);
  }
  public clearTask(): Promise<void> {
    return this.sessionController.clearTask();
  }
  public loadSession(sessionId: string): Promise<void> {
    return this.sessionController.loadSession(sessionId);
  }
  public cancelTask(): Promise<void> {
    return this.sessionController.cancelTask();
  }
  public rewindToCheckpoint(checkpointId: string): Promise<void> {
    return this.sessionController.rewindToCheckpoint(checkpointId);
  }
  public revertLastSnapshot(): Promise<void> {
    return this.sessionController.revertLastSnapshot();
  }
  public revertToolSnapshot(toolCallId: string): Promise<void> {
    return this.sessionController.revertToolSnapshot(toolCallId);
  }
  public revertCommandEffects(toolCallId: string): Promise<void> {
    return this.sessionController.revertCommandEffects(toolCallId);
  }
  public canRevertCommand(toolCallId: string): boolean {
    return this.sessionController.canRevertCommand(toolCallId);
  }
  public provideUserReply(answer: string): Promise<void> {
    return this.sessionController.provideUserReply(answer);
  }
  public retryLastTurn(): Promise<void> {
    return this.sessionController.retryLastTurn();
  }
  /** Gönderilmiş bir kullanıcı mesajını düzenler ve istemi yeniden çalıştırır. */
  public editMessage(messageId: string, text: string): Promise<void> {
    return this.sessionController.editMessage(messageId, text);
  }

  /**
   * Duraklatılmış veya VS Code yeniden açıldığında geri yüklenmiş görevi kaldığı yerden sürdürür.
   */
  public async resumeTask(): Promise<void> {
    if (this.isBusy()) {
      this.notify({ level: 'warning', message: 'Ajan şu anda meşgul.' });
      return;
    }
    if (this.state.pendingApproval) {
      this.notify({ level: 'info', message: 'Lütfen bekleyen spec veya plan onayını yanıtlayın.' });
      return;
    }

    const currentStep = this.state.plan?.steps?.find(
      (s) => s.status === 'in_progress' || s.status === 'pending'
    );
    const instruction = currentStep
      ? `Görevin "${currentStep.title}" adımı üzerinde çalışmaya devam et. Gerekli araçları çalıştırarak hedefe ilerle.`
      : this.state.plan?.goal
        ? `"${this.state.plan.goal}" hedefine ulaşmak için görev planına göre çalışmaya devam et.`
        : 'Görevin tamamlanması için kaldığın yerden devam et.';

    this.state.status = 'running';
    this.isCancelled = false;
    this.emitState();
    await this.saveCurrentState();

    await this.handleSendMessage(instruction, this.state.mode, { internal: true });
  }

  public approveSpec(): Promise<boolean> {
    return this.workflow.approveSpec();
  }
  public approvePlan(): Promise<boolean> {
    return this.workflow.approvePlan();
  }
  public rejectApproval(reason?: string): Promise<void> {
    return this.workflow.rejectApproval(reason);
  }
  public approveTool(toolCallId: string): Promise<void> {
    return this.toolPipeline.approveTool(toolCallId);
  }
  public rejectTool(toolCallId: string, reason?: string): Promise<void> {
    return this.toolPipeline.rejectTool(toolCallId, reason);
  }
  public setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }> {
    return this.workflow.setWorkflowStage(stage);
  }
  /** İş akışı denetleyicisine delege (host sözleşmesi). */
  public getWorkflow() {
    return this.workflow.getWorkflow();
  }
  public getState(): TaskState {
    return this.state;
  }

  /**
   * Tamamlanan/başarısız görevleri proje belleğine yazar.
   */
  public async recordProjectMemory(
    turnId: string,
    prompt: string,
    status: ProjectMemoryStatus,
    summary: string | undefined,
    workspaceRoot: string | undefined
  ) {
    return recordProjectMemory(this, turnId, prompt, status, summary, workspaceRoot);
  }

  /**
   * Oturumun anlık görüntü ve checkpoint kayıtlarını diskten yükler.
   * Oturum/kök çifti başına yalnızca bir kez çalışır.
   */
  public async ensureSessionPersistence(workspaceRoot: string): Promise<void> {
    return ensureSessionPersistence(this, workspaceRoot);
  }

  /**
   * Onay için duran turda çalışmayacak araç çağrılarını kapatır.
   *
   * "pending" bırakmak arayüzde sonsuz spinner'a ve sonraki istekte çağrının
   * sessizce düşmesine yol açıyordu.
   */
  public closeRemainingToolCalls(calls: ToolCall[], exceptId: string, reason: string): void {
    closeRemainingToolCalls(calls, exceptId, reason);
  }

  /**
   * Prompt'u @file referansları ve etkin editör/seçim içeriğiyle zenginleştirir
   */
  public async buildEditorContext(userText: string, workspaceRoot?: string): Promise<string> {
    return buildEditorContext(userText, workspaceRoot, { permissionManager: this.permissionManager });
  }

  /** Önerilen içeriği mevcut dosyayla karşılaştıran sanal diff görünümü açar. */
  public async openDiffPreview(filePath: string, proposedContent: string): Promise<void> {
    return openDiffPreview(filePath, proposedContent);
  }

  /** Değiştirilen veya yazılan dosyayı doğrudan VS Code editöründe açar ve odaklar. */
  public async openFileInEditor(filePath: string, workspaceRoot?: string): Promise<void> {
    return openFileInEditor(filePath, workspaceRoot);
  }

  /**
   * Çekirdek mesajlaşma yöntemi: mevcut sürekli sohbet oturumuna ekler
   */
  public async handleSendMessage(text: string, mode?: AgentMode, options: SendMessageOptions = {}) {
    if (this.state.status === 'waiting_user_input' && this.pendingQuestionResolver) {
      const resolver = this.pendingQuestionResolver;
      this.pendingQuestionResolver = undefined;
      resolver(text);
      return;
    }
    if (this.messageLock) {
      this.notify({ level: 'warning', message: 'Önceki mesaj hâlâ işleniyor. Tamamlanmasını bekleyin.' });
      return;
    }
    this.messageLock = true;
    try {
      await runAgentTurn(this, text, mode, options);
    } finally {
      this.messageLock = false;
    }
  }

  public async markInterruptedToolCalls(reason: string): Promise<void> {
    return markInterruptedToolCalls(this, reason);
  }

  public async auditTool(tc: ToolCall, workspaceRoot: string | undefined, decision: string) {
    return auditTool(tc, workspaceRoot, decision);
  }

  public getSandboxConfig(workspaceRoot?: string): SandboxConfig | undefined {
    return getSandboxConfig(this, workspaceRoot);
  }

  private async confirmWorkspaceHooks(fingerprint: string, commands: string[]): Promise<boolean> {
    return confirmWorkspaceHooks(this, fingerprint, commands);
  }

  private canAutoRunVerificationCommand(command: string): boolean {
    return canAutoRunVerificationCommand(this, command);
  }

  /**
   * Sağlayıcı test/CLI tarafından enjekte edildi mi? Ayarlar kapısı bu
   * durumda atlanır. Bracket erişimi (`core['alan']`) yerine açık yüzey.
   */
  public get hasInjectedProvider(): boolean {
    return this.customProviderInjected;
  }

  /** Durumu bir metot üzerinden okur ki TypeScript eski bir daraltmayı (narrowing) tutmasın. */
  public isTaskCompleted(): boolean {
    return this.state.status === 'completed';
  }

  /**
   * Komutu VS Code tümleşik terminalinde çalıştırır.
   *
   * Uygulama `terminalExecution` içindedir ki ajan döngüsü orkestrasyona
   * odaklanabilsin; bu sarmalayıcı, ayarlara bağlı terminal adını tek yerde tutar.
   */
  public runInIntegratedTerminal(
    command: string,
    workspaceRoot: string,
    signal?: AbortSignal
  ): Promise<string> {
    return runInIntegratedTerminal(command, workspaceRoot, { signal, terminalName: 'Evren Kod' });
  }

  public isBusy(): boolean {
    return (
      this.state.status === 'running' ||
      this.state.status === 'waiting_approval' ||
      this.state.status === 'waiting_user_input'
    );
  }

  public async saveCurrentState() {
    try {
      await this.historyManager.saveTask(this.state);
    } catch (err) {
      // Geçmiş yazımı başarısız olsa bile ajan döngüsünü sürdür.
      logWarning('Could not save session record', err);
    }
  }

  public emitState() {
    this.onStateUpdate({ ...this.state });
  }

  public nextMessageId(): string {
    this.messageSeq = (this.messageSeq + 1) % Number.MAX_SAFE_INTEGER;
    return `msg_${Date.now()}_${this.messageSeq}`;
  }

  public getInitialState(mode: AgentMode = 'code'): TaskState {
    return {
      id: '',
      prompt: '',
      mode,
      status: 'idle',
      messages: [],
      workflow: createWorkflowState(),
      stats: {
        totalTokens: 0,
        stepsCount: 0,
        filesModified: [],
        verification: {
          status: 'not_run',
          attempts: 0
        }
      }
    };
  }
}
