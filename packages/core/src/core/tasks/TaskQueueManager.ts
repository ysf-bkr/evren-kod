import * as path from 'path';
import * as fs from 'fs/promises';
import { EVREN_KOD_DIR } from '../../shared/constants';

/**
 * Merkezi Görev ve Bağımlılık Yönetimi (TaskQueueManager).
 *
 * Projedeki tüm işleri:
 * - Öncelik sırasına göre (P0, P1, P2, P3)
 * - Bağımlılık zincirine göre (Task DAG: Görev B ancak Görev A tamamlanınca başlar)
 * - Durum yaşam döngüsüne göre (backlog -> todo -> in_progress -> in_review -> verified -> done)
 * yönetir ve hiçbir işin önkoşulsuz atlanmamasını garanti eder.
 */

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type TaskItemStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'verified'
  | 'done'
  | 'blocked';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskItemStatus;
  dependsOn: string[];
  assignedTo?: string;
  linkedRequirementId?: string;
  estimatedMinutes?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

export class TaskQueueManager {
  private tasks = new Map<string, TaskItem>();

  public addTask(params: {
    id: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskItemStatus;
    dependsOn?: string[];
    assignedTo?: string;
    linkedRequirementId?: string;
    estimatedMinutes?: number;
  }): TaskItem {
    const id = params.id.trim();
    if (!id) throw new Error('Task ID cannot be empty.');

    const now = Date.now();
    const existing = this.tasks.get(id);

    const task: TaskItem = {
      id,
      title: params.title.trim(),
      description: params.description?.trim() ?? '',
      priority: params.priority ?? existing?.priority ?? 'P1',
      status: params.status ?? existing?.status ?? 'todo',
      dependsOn: params.dependsOn ? [...params.dependsOn] : (existing?.dependsOn ?? []),
      assignedTo: params.assignedTo ?? existing?.assignedTo,
      linkedRequirementId: params.linkedRequirementId ?? existing?.linkedRequirementId,
      estimatedMinutes: params.estimatedMinutes ?? existing?.estimatedMinutes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: existing?.completedAt
    };

    this.tasks.set(id, task);

    // Döngüsel bağımlılık kontrolü
    const cycle = this.detectCycle();
    if (cycle.hasCycle) {
      if (!existing) this.tasks.delete(id);
      else this.tasks.set(id, existing);
      throw new Error(`Görev bağımlılıklarında döngü tespit edildi: ${cycle.cyclePath?.join(' -> ')}`);
    }

    return task;
  }

  public getTask(id: string): TaskItem | undefined {
    return this.tasks.get(id);
  }

  public getAllTasks(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  public updateTaskStatus(taskId: string, status: TaskItemStatus): TaskItem {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = status;
    task.updatedAt = Date.now();
    if (status === 'done' || status === 'verified') {
      task.completedAt = task.completedAt ?? Date.now();
    } else {
      task.completedAt = undefined;
    }

    return task;
  }

  /**
   * Bir görevin başlatılabilir olup olmadığını (tüm bağımlılıklarının verified veya done olup olmadığını) denetler.
   */
  public canStartTask(taskId: string): { canStart: boolean; blockingTasks: string[] } {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const blockingTasks: string[] = [];
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (!dep || (dep.status !== 'verified' && dep.status !== 'done')) {
        blockingTasks.push(depId);
      }
    }

    return {
      canStart: blockingTasks.length === 0,
      blockingTasks
    };
  }

  /**
   * Şu an yürütülebilir durumda olan sıradaki görevleri öncelik (P0 -> P1 -> P2 -> P3)
   * sırasına göre döndürür.
   */
  public getNextExecutableTasks(): TaskItem[] {
    const executable: TaskItem[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'todo' || task.status === 'backlog') {
        const check = this.canStartTask(task.id);
        if (check.canStart) {
          executable.push(task);
        }
      }
    }

    return executable.sort((a, b) => {
      const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Bağımlılık grafiğinde döngü (circular dependency) olup olmadığını tarar (DFS).
   */
  public detectCycle(): { hasCycle: boolean; cyclePath?: string[] } {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (nodeId: string): string[] | null => {
      visited.add(nodeId);
      recStack.add(nodeId);
      pathStack.push(nodeId);

      const task = this.tasks.get(nodeId);
      if (task) {
        for (const depId of task.dependsOn) {
          if (!visited.has(depId)) {
            const cycle = dfs(depId);
            if (cycle) return cycle;
          } else if (recStack.has(depId)) {
            return [...pathStack, depId];
          }
        }
      }

      recStack.delete(nodeId);
      pathStack.pop();
      return null;
    };

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        const cycle = dfs(taskId);
        if (cycle) {
          return { hasCycle: true, cyclePath: cycle };
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * İnsan tarafından okunabilir Markdown Kanban panosu üretir.
   */
  public generateKanbanMarkdown(): string {
    const tasks = this.getAllTasks();
    const byStatus: Record<TaskItemStatus, TaskItem[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      verified: [],
      done: [],
      blocked: []
    };

    for (const task of tasks) {
      byStatus[task.status]?.push(task);
    }

    const lines: string[] = [
      '# Evren Kod Merkezi Görev Panosu (Kanban)',
      '',
      `Toplam ${tasks.length} Görev | ${byStatus.done.length + byStatus.verified.length} Tamamlandı / Doğrulandı`,
      '',
      '| Durum | Görev Sayısı | Görevler |',
      '| :--- | :---: | :--- |'
    ];

    const statusLabels: Record<TaskItemStatus, string> = {
      todo: '📌 Yapılacak (Todo)',
      in_progress: '⚡ Yürütülüyor (In Progress)',
      in_review: '🔍 İncelemede (Review)',
      verified: '✅ Kanıtlandı (Verified)',
      done: '🏁 Bitti (Done)',
      blocked: '🛑 Engellendi (Blocked)',
      backlog: '📦 Beklemede (Backlog)'
    };

    for (const [st, list] of Object.entries(byStatus) as Array<[TaskItemStatus, TaskItem[]]>) {
      if (list.length === 0) continue;
      const taskPills = list.map((t) => `**[${t.priority}]** \`${t.id}\`: ${t.title}`).join('<br>');
      lines.push(`| ${statusLabels[st]} | ${list.length} | ${taskPills} |`);
    }

    return lines.join('\n');
  }

  /**
   * Durumu `.evren-kod/tasks/queue.json` ve `KANBAN.md` altına kaydeder.
   */
  public async saveToDisk(workspaceRoot: string): Promise<void> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR, 'tasks');
    await fs.mkdir(dir, { recursive: true });

    const jsonPath = path.join(dir, 'queue.json');
    const mdPath = path.join(dir, 'KANBAN.md');

    const data = this.getAllTasks();
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.writeFile(mdPath, this.generateKanbanMarkdown(), 'utf-8');
  }

  /**
   * `.evren-kod/tasks/queue.json` dosyasından görevleri geri yükler.
   */
  public async loadFromDisk(workspaceRoot: string): Promise<void> {
    const jsonPath = path.join(workspaceRoot, EVREN_KOD_DIR, 'tasks', 'queue.json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as TaskItem[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.title) {
            this.tasks.set(item.id, item);
          }
        }
      }
    } catch {
      // Dosya henüz yoksa sessizce devam
    }
  }

  public clear(): void {
    this.tasks.clear();
  }
}
