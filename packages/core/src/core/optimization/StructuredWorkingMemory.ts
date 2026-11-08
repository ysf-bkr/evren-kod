export interface ModifiedFileInfo {
  path: string;
  additions: number;
  deletions: number;
  status: 'staged' | 'modified' | 'verified';
}

export interface WorkingMemoryState {
  goal: string;
  completedSteps: string[];
  openDecisions: string[];
  modifiedFiles: ModifiedFileInfo[];
  knownIssues: string[];
  nextImmediateStep: string;
  updatedAt: number;
}

export class StructuredWorkingMemory {
  private state: WorkingMemoryState;

  constructor(initialGoal = '') {
    this.state = {
      goal: initialGoal,
      completedSteps: [],
      openDecisions: [],
      modifiedFiles: [],
      knownIssues: [],
      nextImmediateStep: '',
      updatedAt: Date.now()
    };
  }

  public setGoal(goal: string): void {
    this.state.goal = goal.trim();
    this.state.updatedAt = Date.now();
  }

  public addCompletedStep(step: string): void {
    const trimmed = step.trim();
    if (trimmed && !this.state.completedSteps.includes(trimmed)) {
      this.state.completedSteps.push(trimmed);
      this.state.updatedAt = Date.now();
    }
  }

  public addOpenDecision(decision: string): void {
    const trimmed = decision.trim();
    if (trimmed && !this.state.openDecisions.includes(trimmed)) {
      this.state.openDecisions.push(trimmed);
      this.state.updatedAt = Date.now();
    }
  }

  public resolveDecision(decision: string): void {
    this.state.openDecisions = this.state.openDecisions.filter((d) => !d.includes(decision));
    this.state.updatedAt = Date.now();
  }

  public recordModifiedFile(
    filePath: string,
    additions = 0,
    deletions = 0,
    status: 'staged' | 'modified' | 'verified' = 'modified'
  ): void {
    const norm = filePath.replace(/\\/g, '/');
    const existing = this.state.modifiedFiles.find((f) => f.path === norm);
    if (existing) {
      existing.additions += additions;
      existing.deletions += deletions;
      existing.status = status;
    } else {
      this.state.modifiedFiles.push({ path: norm, additions, deletions, status });
    }
    this.state.updatedAt = Date.now();
  }

  public addKnownIssue(issue: string): void {
    const trimmed = issue.trim();
    if (trimmed && !this.state.knownIssues.includes(trimmed)) {
      this.state.knownIssues.push(trimmed);
      this.state.updatedAt = Date.now();
    }
  }

  public resolveIssue(issue: string): void {
    this.state.knownIssues = this.state.knownIssues.filter((i) => !i.includes(issue));
    this.state.updatedAt = Date.now();
  }

  public setNextImmediateStep(step: string): void {
    this.state.nextImmediateStep = step.trim();
    this.state.updatedAt = Date.now();
  }

  public getState(): Readonly<WorkingMemoryState> {
    return this.state;
  }

  /**
   * İstem kuyruğuna `<working_memory>` bloğu olarak formatlar.
   */
  public formatForPrompt(): string {
    const parts: string[] = ['=== YAPILANDIRILMIŞ ÇALIŞMA HAFIZASI (WORKING MEMORY) ==='];

    if (this.state.goal) {
      parts.push(`- Görev Amacı: ${this.state.goal}`);
    }

    if (this.state.completedSteps.length > 0) {
      parts.push('- Tamamlanan İşler:');
      this.state.completedSteps.forEach((s, idx) => parts.push(`  ${idx + 1}. ${s}`));
    }

    if (this.state.modifiedFiles.length > 0) {
      parts.push('- Değişen Dosyalar:');
      this.state.modifiedFiles.forEach((f) => {
        parts.push(`  • ${f.path} (+${f.additions}/-${f.deletions}, durum: ${f.status})`);
      });
    }

    if (this.state.openDecisions.length > 0) {
      parts.push('- Açık Kararlar / Sözleşmeler:');
      this.state.openDecisions.forEach((d) => parts.push(`  ? ${d}`));
    }

    if (this.state.knownIssues.length > 0) {
      parts.push('- Bilinen Sorunlar / Hatalar:');
      this.state.knownIssues.forEach((i) => parts.push(`  ! ${i}`));
    }

    if (this.state.nextImmediateStep) {
      parts.push(`- Doğrudan Sonraki Adım: ${this.state.nextImmediateStep}`);
    }

    return `<working_memory>\n${parts.join('\n')}\n</working_memory>`;
  }

  public reset(newGoal = ''): void {
    this.state = {
      goal: newGoal,
      completedSteps: [],
      openDecisions: [],
      modifiedFiles: [],
      knownIssues: [],
      nextImmediateStep: '',
      updatedAt: Date.now()
    };
  }
}
