/**
 * Alt ajan görev parametreleri.
 *
 * Ayrıştırıcı `shared` altında tutulur çünkü hem araç katmanı hem de
 * `SubagentManager` aynı doğrulamayı kullanır. `tools` altında tutmak,
 * yönetici delege ettiğinde `core -> tools -> core` döngüsü yaratıyordu.
 */

import { isRecord } from '../errors';

export interface SubagentTaskParams {
  role: string;
  task: string;
  context?: string;
  /** Doğruysa alt ajan ana çalışma alanı yerine yalıtılmış bir Git worktree'de çalışır. */
  isolate?: boolean;
  /**
   * Doğruysa alt ajan yalnızca salt-okunur araçlarla çalışır. Ana ajan okuma
   * aşamasındayken (spec/plan onayı öncesi) devredilen işlerde kullanılır.
   */
  readOnly?: boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * `invoke_subagent` argümanlarını doğrular; rol ve görev zorunludur.
 * Geçersiz bir çağrı sessizce boş rolle çalışmaz, açık hata verir.
 */
export function parseSubagentTaskParams(args: Record<string, unknown>): SubagentTaskParams {
  const role = asString(args.role).trim();
  const task = asString(args.task).trim();
  if (!role) throw new Error('Subagent role is required.');
  if (!task) throw new Error('Subagent task is required.');

  return {
    role,
    task,
    context: typeof args.context === 'string' ? args.context : undefined,
    isolate: args.isolate === true || args.isolate === 'true'
  };
}

/** Paralel görev düğümünün planlayıcıya girmeden önceki doğrulanmış hâli. */
export interface SubagentTaskNodeInput {
  id: string;
  role: string;
  payload: SubagentTaskParams;
  dependsOn: string[];
}

/**
 * `tasks` ham listesini görev düğümlerine çevirir: kimlik, rol, görev metni
 * ve bağımlılıklar burada doğrulanır; boş görevler düşürülür. Yalıtım ve
 * okuma modu kararı (`resolveIsolation`) çağırandadır çünkü paralel yazan
 * ajanlarla okuma aşamasındaki ajanlar farklı varsayılanlar kullanır.
 */
export function parseSubagentTaskNodes(
  list: unknown[],
  resolveIsolation: (item: Record<string, unknown>) => { isolate: boolean; readOnly?: boolean }
): SubagentTaskNodeInput[] {
  return list
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => {
      const isolation = resolveIsolation(item);
      const role = typeof item.role === 'string' ? item.role : 'backend';
      return {
        id: asString(item.id).trim() || `task-${index + 1}`,
        role,
        payload: {
          role,
          task: asString(item.task),
          context: typeof item.context === 'string' ? item.context : undefined,
          isolate: isolation.isolate,
          readOnly: isolation.readOnly
        },
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter((dep): dep is string => typeof dep === 'string')
          : []
      };
    })
    .filter((node) => node.payload.task.trim().length > 0);
}
