import { ChatMessage, TaskState, ToolCall } from '../../shared/types';
import { isRecord } from '../../shared/errors';

/**
 * Dışa ve içe aktarmanın paylaştığı oturum arşivi biçimi.
 *
 * `vscode` import'larından bağımsız tutulur; test edilebilir ve CLI'de kullanılabilir.
 */

export const SESSION_ARCHIVE_SCHEMA = 'evren-kod/session';
export const SESSION_ARCHIVE_VERSION = 1;

export interface SessionArchive {
  schema: typeof SESSION_ARCHIVE_SCHEMA;
  version: number;
  exportedAt: string;
  task: TaskState;
}

const INTERRUPTED = 'The operation was interrupted before the session was exported.';

/** Kalıcılık kopyasında tam gövdesi korunacak en yeni araç sonucu sayısı. */
const PERSISTENCE_FULL_RESULTS = 30;
/** Pencere dışında kalan eski araç sonucu gövdelerinin indirgeneceği uzunluk. */
const PERSISTENCE_RESULT_STUB_CHARS = 400;

/**
 * Kalıcı depolamaya yazılacak küçültülmüş kopyayı üretir.
 *
 * Uzun bir görev yüzlerce araç sonucu biriktirir; hepsinin tam gövdesi her
 * kayıtta yeniden serileştirilirse workspaceState şişer ve yazım yavaşlar.
 * Canlı oturum hiç dokunulmadan tam hâlini taşımaya devam eder; yalnızca
 * disine giden kopyada en yeni ~30 sonucun gövdesi tam kalır, eskiler
 * kimliği ve başı korunarak kısaltılır. Bu bir sayısal Limit değil boyut
 * kontrolüdür: görev durmaz, kullanıcı tam gövdeyi istersen dosyayı yeniden
 * okutur.
 */
export function slimTaskForPersistence(task: TaskState): TaskState {
  const bodies: string[][] = [];
  for (const message of task.messages) {
    for (const toolCall of message.toolCalls ?? []) {
      bodies.push([toolCall.result ?? '']);
    }
  }
  const total = bodies.length;
  if (total <= PERSISTENCE_FULL_RESULTS) return task;

  let index = 0;
  const messages = task.messages.map((message) => {
    if (!message.toolCalls || message.toolCalls.length === 0) return message;
    let changed = false;
    const toolCalls = message.toolCalls.map((toolCall) => {
      const position = index++;
      const result = toolCall.result;
      if (
        position >= total - PERSISTENCE_FULL_RESULTS ||
        typeof result !== 'string' ||
        result.length <= PERSISTENCE_RESULT_STUB_CHARS
      ) {
        return toolCall;
      }
      changed = true;
      return {
        ...toolCall,
        result:
          `${result.slice(0, PERSISTENCE_RESULT_STUB_CHARS)}\n` +
          `[eski araç sonucu yer tasarrufu için kısaltıldı — ${result.length} karakterdi; gereken dosyayı yeniden oku]`
      };
    });
    return changed ? { ...message, toolCalls } : message;
  });
  return { ...task, messages };
}

function normalizeToolCall(value: unknown): ToolCall | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name : '';
  if (!id || !name) return undefined;

  const rawStatus = typeof value.status === 'string' ? value.status : 'completed';
  const status: ToolCall['status'] =
    rawStatus === 'completed' || rawStatus === 'error' || rawStatus === 'rejected' ? rawStatus : 'error';

  return {
    id,
    name: name as ToolCall['name'],
    args: isRecord(value.args) ? value.args : {},
    explanation: typeof value.explanation === 'string' ? value.explanation : undefined,
    requiresApproval: value.requiresApproval === true,
    status,
    result: typeof value.result === 'string' ? value.result : undefined,
    error: typeof value.error === 'string' ? value.error : status === 'error' ? INTERRUPTED : undefined
  };
}

function normalizeMessage(value: unknown): ChatMessage | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return undefined;

  const content = typeof value.content === 'string' ? value.content : '';
  const toolCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls.map(normalizeToolCall).filter((tc): tc is ToolCall => Boolean(tc))
    : undefined;

  return {
    id:
      typeof value.id === 'string' && value.id
        ? value.id
        : `imported_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    isStreaming: false
  };
}

export function serializeSessionArchive(task: TaskState): string {
  const archive: SessionArchive = {
    schema: SESSION_ARCHIVE_SCHEMA,
    version: SESSION_ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    task
  };
  return JSON.stringify(archive, null, 2);
}

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
  user: 'Kullanıcı',
  assistant: 'Evren Kod',
  system: 'Sistem'
};

/** Token satırı: toplam + varsa giden/gelen/önbellek kırılımı. */
function formatTokenStats(task: TaskState): string {
  const parts = [`${task.stats.totalTokens}`];
  if (typeof task.stats.promptTokens === 'number' || typeof task.stats.completionTokens === 'number') {
    parts.push(`giden ${task.stats.promptTokens ?? 0}`, `gelen ${task.stats.completionTokens ?? 0}`);
  }
  if (typeof task.stats.cachedTokens === 'number' && task.stats.cachedTokens > 0) {
    parts.push(`önbellekten ${task.stats.cachedTokens}`);
  }
  if (typeof task.stats.estimatedTokens === 'number' && task.stats.estimatedTokens > 0) {
    parts.push(`≈${task.stats.estimatedTokens} tahmini`);
  }
  return parts.join(' · ');
}

function formatToolCall(toolCall: ToolCall): string {
  const status = toolCall.status === 'completed' ? 'tamamlandı' : toolCall.status;
  const lines = [`- **${toolCall.name}** (${status})`];
  if (toolCall.explanation) lines.push(`  - ${toolCall.explanation}`);
  const path = typeof toolCall.args.path === 'string' ? toolCall.args.path : undefined;
  if (path) lines.push(`  - Yol: \`${path}\``);
  if (toolCall.error) lines.push(`  - Hata: ${toolCall.error}`);
  return lines.join('\n');
}

export function serializeSessionMarkdown(task: TaskState): string {
  const lines: string[] = [
    '# Evren — Oturum',
    '',
    `- **Oturum:** \`${task.id}\``,
    `- **Mod:** ${task.mode === 'plan' ? 'Planlama' : task.mode === 'education' ? 'Eğitim' : task.mode === 'fast' ? 'Hızlı' : 'Kodlama'}`,
    `- **Durum:** ${task.status}`,
    `- **Adım:** ${task.stats.stepsCount}`,
    `- **Token:** ${formatTokenStats(task)}`,
    `- **Dışa aktarıldı:** ${new Date().toISOString()}`,
    '',
    `## Görev`,
    '',
    task.prompt || '(boş)',
    ''
  ];

  if (task.stats.filesModified.length > 0) {
    lines.push('## Değiştirilen dosyalar', '');
    for (const file of task.stats.filesModified) lines.push(`- \`${file}\``);
    lines.push('');
  }

  if (task.plan && task.plan.steps.length > 0) {
    lines.push('## Plan', '');
    if (task.plan.goal) lines.push(`**Hedef:** ${task.plan.goal}`, '');
    for (const step of task.plan.steps) {
      lines.push(`- [${step.status === 'completed' ? 'x' : ' '}] ${step.title}`);
    }
    lines.push('');
  }

  lines.push('## Konuşma', '');
  for (const message of task.messages) {
    lines.push(`### ${ROLE_LABEL[message.role]}`, '');
    if (message.content.trim()) lines.push(message.content.trim(), '');
    if (message.toolCalls && message.toolCalls.length > 0) {
      lines.push('**Araç çağrıları**', '');
      for (const toolCall of message.toolCalls) lines.push(formatToolCall(toolCall), '');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export class SessionArchiveError extends Error {}

/**
 * Arşivi ayrıştırır ve sağlamlaştırır. İçe aktarılan oturumlar her zaman
 * `idle` durumuna çekilir ve yarıda kalan araç çağrıları kesildi olarak
 * işaretlenir; böylece bir dosyayı içe aktarmak onay istemini sürdüremez
 */
export function parseSessionArchive(raw: string): TaskState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionArchiveError('The selected file is not valid JSON.');
  }

  if (!isRecord(parsed)) {
    throw new SessionArchiveError('The selected file is not a session archive.');
  }

  // Kolaylık olsun diye hem sarmalanmış arşivi hem düz TaskState'i kabul et.
  const taskSource = parsed.schema === SESSION_ARCHIVE_SCHEMA ? parsed.task : parsed;
  if (!isRecord(taskSource)) {
    throw new SessionArchiveError('The archive does not contain a task.');
  }
  if (parsed.schema === SESSION_ARCHIVE_SCHEMA) {
    if (typeof parsed.version === 'number' && parsed.version > SESSION_ARCHIVE_VERSION) {
      throw new SessionArchiveError(
        `Bu arşiv daha yeni bir sürüm (v${parsed.version}) tarafından oluşturuldu. İçe aktarmak için Evren'u güncelleyin.`
      );
    }
  }

  const messages = Array.isArray(taskSource.messages)
    ? taskSource.messages.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message))
    : [];

  if (messages.length === 0) {
    throw new SessionArchiveError('The archive contains no messages to import.');
  }

  const stats = isRecord(taskSource.stats) ? taskSource.stats : {};
  const mode =
    taskSource.mode === 'plan' || taskSource.mode === 'education' || taskSource.mode === 'fast'
      ? taskSource.mode
      : 'code';
  const filesModified = Array.isArray(stats.filesModified)
    ? stats.filesModified.filter((item): item is string => typeof item === 'string')
    : [];

  // Planı bağlam için koru, ama yalnızca planlayıcının anladığı alanlarla.
  let plan: TaskState['plan'];
  if (isRecord(taskSource.plan) && Array.isArray(taskSource.plan.steps)) {
    const steps = taskSource.plan.steps
      .filter(
        (step): step is Record<string, unknown> =>
          isRecord(step) && typeof step.id === 'string' && typeof step.title === 'string'
      )
      .map((step) => ({
        id: step.id as string,
        title: step.title as string,
        description: typeof step.description === 'string' ? step.description : undefined,
        status: (step.status === 'completed' || step.status === 'in_progress' || step.status === 'blocked'
          ? step.status
          : 'pending') as NonNullable<TaskState['plan']>['steps'][number]['status'],
        dependsOn: Array.isArray(step.dependsOn)
          ? step.dependsOn.filter((item): item is string => typeof item === 'string')
          : [],
        completionCriteria: typeof step.completionCriteria === 'string' ? step.completionCriteria : undefined,
        files: Array.isArray(step.files)
          ? step.files.filter((item): item is string => typeof item === 'string')
          : undefined
      }));
    if (steps.length > 0) {
      plan = {
        goal: typeof taskSource.plan.goal === 'string' ? taskSource.plan.goal : '',
        steps,
        updatedAt: typeof taskSource.plan.updatedAt === 'number' ? taskSource.plan.updatedAt : Date.now()
      };
    }
  }

  return {
    id: typeof taskSource.id === 'string' ? taskSource.id : '',
    prompt: typeof taskSource.prompt === 'string' ? taskSource.prompt : '',
    mode,
    status: 'idle',
    messages,
    pendingToolCall: undefined,
    pendingQuestion: undefined,
    checkpoints: undefined,
    plan,
    stats: {
      totalTokens: typeof stats.totalTokens === 'number' ? stats.totalTokens : 0,
      promptTokens: typeof stats.promptTokens === 'number' ? stats.promptTokens : undefined,
      completionTokens: typeof stats.completionTokens === 'number' ? stats.completionTokens : undefined,
      cachedTokens: typeof stats.cachedTokens === 'number' ? stats.cachedTokens : undefined,
      estimatedTokens: typeof stats.estimatedTokens === 'number' ? stats.estimatedTokens : undefined,
      stepsCount: typeof stats.stepsCount === 'number' ? stats.stepsCount : 0,
      filesModified,
      lastModel: typeof stats.lastModel === 'string' ? stats.lastModel : undefined
    }
  };
}
