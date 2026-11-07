/**
 * Ajan çekirdeğinin modüller arası sözleşmesi.
 *
 * `AgentCore` eskiden tüm sorumluluğu tek sınıfta taşıyordu. İş akışı, oturum,
 * doğrulama, araç hattı ve döngü ayrı denetleyicilere taşındı; bu arayüz
 * onların ihtiyaç duyduğu ortak durumu ve yardımcıları tanımlar.
 *
 * `AgentCore` bu arayüzü uygular; denetleyiciler `vscode` modülüne değil,
 * yalnızca bu sözleşmeye bağlıdır. Böylece her modül tek başına test edilebilir.
 */
import type * as vscode from 'vscode';
import type { AgentMode, TaskState, ToolCall, UserSettings } from '@evren-kod/core/shared/types';
import type { ModelProvider } from '@evren-kod/core/providers/base';
import type { PermissionManager } from '@evren-kod/core/core/permission/PermissionManager';
import type { HistoryManager } from '../memory/HistoryManager';
import type { McpHub } from '../mcp/McpHub';
import type { SubagentManager } from '@evren-kod/core/core/multiagent/SubagentManager';
import type { SkillManager } from '@evren-kod/core/core/skills/SkillManager';
import type { LspClient } from '../lsp/LspClient';
import type { SnapshotManager } from '@evren-kod/core/core/snapshot/SnapshotManager';
import type { HookManager } from '@evren-kod/core/core/hooks/HookManager';
import type { CheckpointManager } from '@evren-kod/core/core/checkpoint/CheckpointManager';
import type { ContextManager } from '@evren-kod/core/core/context/ContextManager';
import type { ReadDeduper } from '@evren-kod/core/core/agent/readDeduper';
import type {
  ProjectMemoryManager,
  ProjectMemoryStatus
} from '@evren-kod/core/core/memory/ProjectMemoryManager';
import type { TaskPlanner } from '@evren-kod/core/core/plan/TaskPlanner';
import type { ModulePlanner } from '@evren-kod/core/core/plan/ModulePlanner';
import type { VerificationManager } from '@evren-kod/core/core/verification/VerificationManager';
import type { ModelRouter } from '@evren-kod/core/core/routing/ModelRouter';
import type { WorktreeManager } from '@evren-kod/core/core/worktree/WorktreeManager';
import type { GitManager, CommandCheckpoint } from '@evren-kod/core/core/git/GitManager';
import type { WorkspaceRuleManager } from '@evren-kod/core/core/rules/WorkspaceRuleManager';
import type { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import type { EmbeddingIndex } from '@evren-kod/core/core/knowledge/EmbeddingIndex';
import type { VectorMemory } from '@evren-kod/core/core/memory/VectorMemory';
import type { SpecStore } from '@evren-kod/core/core/spec/SpecStore';
import type { CallGraphManager } from '@evren-kod/core/core/callgraph/CallGraphManager';
import type { SessionPersistence } from '@evren-kod/core/core/agent/sessionPersistence';
import type { SandboxConfig } from '@evren-kod/core/core/verification/CommandRunner';
import type { WorkflowState, WorkflowStage } from '@evren-kod/core/core/workflow/TaskWorkflow';

export interface AgentNotification {
  level: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Tüm denetleyicilerin paylaştığı asgari yüzey.
 *
 * Denetleyiciler tek bir dev `AgentHost` yerine yalnızca kendi ihtiyaçlarını
 * taşıyan bir portla bağlanır. Böylece "bu denetleyici neye bağımlı?"
 * sorusunun cevabı imzada okunur; yeni bir bağımlılık sessizce eklenemez.
 */
export interface AgentHostBase {
  /** VS Code eklenti bağlamı (depolama, sırlar). */
  context: vscode.ExtensionContext;
  state: TaskState;
  settings: UserSettings;
  isCancelled: boolean;
  runGeneration: number;
  activeAbortController?: AbortController;
  notify: (notification: AgentNotification) => void;
  emitState(): void;
  saveCurrentState(): Promise<void>;
  isBusy(): boolean;
  nextMessageId(): string;
}

/** İş akışı denetleyicisinin gördüğü yüzey (şartname, plan, kapı). */
export interface WorkflowHost extends AgentHostBase {
  planner: TaskPlanner;
  modulePlanner: ModulePlanner;
  specStore: SpecStore;
  knowledgeStore: KnowledgeStore;
  verificationManager: VerificationManager;
  callGraphManager: CallGraphManager;
  persistence: SessionPersistence;
  /** Doğrulama istatistiklerine yazılan onarım denemesi sayısı. */
  repairAttempts: number;
  closeRemainingToolCalls(calls: ToolCall[], exceptId: string, reason: string): void;
  handleSendMessage(text: string, mode?: AgentMode, options?: { internal?: boolean }): Promise<void>;
}

/** Oturum yaşam döngüsünün gördüğü yüzey (kayıt, geri alma, geçmiş). */
export interface SessionHost extends AgentHostBase {
  historyManager: HistoryManager;
  hookManager: HookManager;
  snapshotManager: SnapshotManager;
  checkpointManager: CheckpointManager;
  persistence: SessionPersistence;
  planner: TaskPlanner;
  modulePlanner: ModulePlanner;
  readDeduper: ReadDeduper;
  gitManager: GitManager;
  verificationManager: VerificationManager;
  commandCheckpoints: Map<string, CommandCheckpoint>;
  lastVerificationSkip: string;
  baselineCaptured: boolean;
  repairAttempts: number;
  autoContinuations: number;
  currentTurnId?: string;
  pendingResolver?: (approved: boolean, reason?: string) => void;
  pendingQuestionResolver?: (answer: string) => void;
  getInitialState(mode?: AgentMode): TaskState;
  normalizeRestoredState(saved: TaskState): TaskState;
  rebuildPersistenceDependents(): void;
  markInterruptedToolCalls(reason: string): Promise<void>;
  recordProjectMemory(
    turnId: string,
    prompt: string,
    status: ProjectMemoryStatus,
    summary: string | undefined,
    workspaceRoot: string | undefined
  ): Promise<void>;
  handleSendMessage(text: string, mode?: AgentMode, options?: { internal?: boolean }): Promise<void>;
}

/** Araç hattının gördüğü yüzey (izin, snapshot, alt ajan, bilgi tabanı). */
export interface ToolPipelineHost extends AgentHostBase {
  permissionManager: PermissionManager;
  hookManager: HookManager;
  contextManager: ContextManager;
  snapshotManager: SnapshotManager;
  checkpointManager: CheckpointManager;
  subagentManager: SubagentManager;
  readDeduper: ReadDeduper;
  gitManager: GitManager;
  lspClient: LspClient;
  projectMemory: ProjectMemoryManager;
  knowledgeStore: KnowledgeStore;
  knowledgeCurator: {
    maybeSummarizeFile(path: string, workspaceRoot?: string): void;
    enrichWithLsp(workspaceRoot: string): void;
    needsOnboardingDraft(): boolean;
    onboardingNudge(): string;
    taskEndInstruction(): string;
  };
  vectorMemory: VectorMemory;
  embeddingIndex?: EmbeddingIndex;
  planner: TaskPlanner;
  modulePlanner: ModulePlanner;
  specStore: SpecStore;
  callGraphManager: CallGraphManager;
  verificationManager: VerificationManager;
  worktreeManager: WorktreeManager;
  workflow: WorkflowPort;
  commandCheckpoints: Map<string, CommandCheckpoint>;
  activePlanStepId: string | undefined;
  pendingResolver?: (approved: boolean, reason?: string) => void;
  pendingQuestionResolver?: (answer: string) => void;
  auditTool(tc: ToolCall, workspaceRoot: string | undefined, decision: string): Promise<void>;
  getSandboxConfig(workspaceRoot?: string): SandboxConfig | undefined;
  openDiffPreview(filePath: string, proposedContent: string): Promise<void>;
  openFileInEditor(filePath: string, workspaceRoot?: string): Promise<void>;
  runInIntegratedTerminal(command: string, workspaceRoot: string, signal?: AbortSignal): Promise<string>;
}

/** ReAct döngüsünün gördüğü yüzey (sağlayıcı, bağlam, denetleyiciler). */
export interface AgentLoopHost extends AgentHostBase {
  provider: ModelProvider;
  permissionManager: PermissionManager;
  hookManager: HookManager;
  contextManager: ContextManager;
  readDeduper: ReadDeduper;
  mcpHub: McpHub;
  skillManager: SkillManager;
  workspaceRules: WorkspaceRuleManager;
  projectMemory: ProjectMemoryManager;
  knowledgeStore: KnowledgeStore;
  knowledgeCurator: ToolPipelineHost['knowledgeCurator'];
  vectorMemory: VectorMemory;
  planner: TaskPlanner;
  modulePlanner: ModulePlanner;
  specStore: SpecStore;
  callGraphManager: CallGraphManager;
  verificationManager: VerificationManager;
  modelRouter: ModelRouter;
  workflow: WorkflowPort;
  toolPipeline: ToolPipelinePort;
  verificationController: VerificationPort;
  changedFilesInLastTurn: boolean;
  lastToolFailure: { key: string; count: number } | undefined;
  baselineCaptured: boolean;
  memoryRecordedForTask: boolean;
  onStreamChunk?: (messageId: string, chunk: string) => void;
  auditTool(tc: ToolCall, workspaceRoot: string | undefined, decision: string): Promise<void>;
  getSandboxConfig(workspaceRoot?: string): SandboxConfig | undefined;
  warmKnowledgeBase(workspaceRoot: string): void;
  ensureSessionPersistence(workspaceRoot: string): Promise<void>;
  recordProjectMemory(
    turnId: string,
    prompt: string,
    status: ProjectMemoryStatus,
    summary: string | undefined,
    workspaceRoot: string | undefined
  ): Promise<void>;
}

/** Doğrulama denetleyicisinin gördüğü yüzey. */
export interface VerificationHost extends AgentHostBase {
  verificationManager: VerificationManager;
  projectMemory: ProjectMemoryManager;
  vectorMemory: VectorMemory;
  repairAttempts: number;
  lastVerificationSkip: string;
}

/** Ajan çekirdeğinin denetleyicilere açtığı tam yüzey (portların birleşimi). */
export interface AgentHost
  extends AgentHostBase,
    WorkflowHost,
    SessionHost,
    ToolPipelineHost,
    AgentLoopHost,
    VerificationHost {
  historyManager: HistoryManager;
  mcpHub: McpHub;
  subagentManager: SubagentManager;
  skillManager: SkillManager;
  lspClient: LspClient;
  modelRouter: ModelRouter;
  worktreeManager: WorktreeManager;
  gitManager: GitManager;
  workspaceRules: WorkspaceRuleManager;
  embeddingIndex?: EmbeddingIndex;
  messageSeq: number;
  currentTurnId?: string;
  onStateUpdate: (state: TaskState) => void;
  session: SessionPort;
  tools: ToolPipelinePort;
  verification: VerificationPort;
  getWorkflow(): WorkflowState;
  isTaskCompleted(): boolean;
  createNewSession(mode?: AgentMode): Promise<void>;
}

export interface WorkflowPort {
  getWorkflow(): WorkflowState;
  syncProgressToState(): void;
  setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }>;
  currentSpecCriteriaMet(): boolean;
  verificationPassed(): boolean;
  /** `record_release_gate` aracının konağa bağladığı kapı servisi. */
  releaseGatePort: import('@evren-kod/core/tools/contracts').ReleaseGatePort;
  /** Denetim defteri: yazma olayları ve tamamlanan bağımsız reviewer turları. */
  recordLedgerWrites(role: string, files: readonly string[]): void;
  recordLedgerReview(reviewer: string, seenFiles: readonly string[]): void;
  recordLedgerRead(role: string, file: string): void;
  completeReviewerRun(reviewer: string): string[];
  unreviewedChanges(): string[];
  advanceWorkflowAfterTurn(context: { changedFiles: boolean }): Promise<void>;
  runReviewStage(): Promise<void>;
  runVerifyStage(reachedVerify: boolean): Promise<void>;
  resumeAfterApproval(instruction: string): void;
  approveSpec(): Promise<boolean>;
  approvePlan(): Promise<boolean>;
  rejectApproval(reason?: string): Promise<void>;
  pauseForSpecApproval(
    drafted: { id: string; goal: string },
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean>;
  pauseForPlanApproval(
    plan: { steps: unknown[] },
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean>;
  workspaceRootForApproval(): string;
}

export interface SessionPort {
  ensureSessionPersistence(workspaceRoot: string): Promise<void>;
  createNewSession(mode?: AgentMode): Promise<void>;
  clearTask(): Promise<void>;
  loadSession(sessionId: string): Promise<void>;
  cancelTask(): Promise<void>;
  rewindToCheckpoint(checkpointId: string): Promise<void>;
  revertLastSnapshot(): Promise<void>;
  revertToolSnapshot(toolCallId: string): Promise<void>;
  revertCommandEffects(toolCallId: string): Promise<void>;
  canRevertCommand(toolCallId: string): boolean;
  provideUserReply(answer: string): Promise<void>;
  retryLastTurn(): Promise<void>;
  /** Gönderilmiş bir kullanıcı mesajını düzenler: o mesajdan sonrası atılıp istem yeniden çalıştırılır. */
  editMessage(messageId: string, text: string): Promise<void>;
}

export interface ToolPipelinePort {
  prepareToolCall(
    tc: ToolCall,
    context: {
      allowedToolNames: Set<string>;
      tools: Array<{ name: string }>;
      workspaceRoot: string | undefined;
      generation: number;
    }
  ): Promise<'abort-turn' | 'skip' | 'execute'>;
  executeToolCall(
    tc: ToolCall,
    context: {
      modelToolCalls: ToolCall[];
      tools: Array<{ name: string }>;
      workspaceRoot: string | undefined;
    }
  ): Promise<{ paused: boolean; filesChanged: boolean }>;
  claimNextPlanStep(): void;
}

export interface VerificationPort {
  runEndOfTaskVerification(workspaceRoot: string, generation: number): Promise<'retry' | 'abort' | 'done'>;
  runQuickVerification(workspaceRoot: string, generation: number): Promise<'retry' | 'abort' | 'proceed'>;
}
