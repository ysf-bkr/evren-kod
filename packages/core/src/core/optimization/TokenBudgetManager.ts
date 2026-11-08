import { WorkflowStage } from '../../shared/types';

export interface PhaseBudgetConfig {
  onboard: number;
  intake: number;
  spec: number;
  plan: number;
  build: number;
  review: number;
  verify: number;
  done: number;
  totalTaskCap: number;
}

export interface PhaseSpend {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PhaseBudgetStatus {
  stage: WorkflowStage;
  budgetTokens: number;
  spentTokens: number;
  remainingTokens: number;
  percentUsed: number;
  isExceeded: boolean;
  shouldTransition: boolean;
  advisory?: string;
}

const DEFAULT_PHASE_BUDGETS: PhaseBudgetConfig = {
  onboard: 2_500,
  intake: 3_000,
  spec: 4_000,
  plan: 4_000,
  build: 14_000,
  review: 5_000,
  verify: 6_000,
  done: 2_000,
  totalTaskCap: 45_000
};

export class TokenBudgetManager {
  private config: PhaseBudgetConfig;
  private stageSpend: Map<WorkflowStage, PhaseSpend> = new Map();

  constructor(customConfig?: Partial<PhaseBudgetConfig>) {
    this.config = { ...DEFAULT_PHASE_BUDGETS, ...customConfig };
  }

  /**
   * Modelin bağlam penceresine ve görev karmaşıklığına göre bütçeleri dinamik olarak ölçekler.
   */
  public scaleForContextWindow(contextWindowTokens: number): void {
    if (contextWindowTokens <= 0) return;
    const factor = Math.min(2.5, Math.max(0.5, contextWindowTokens / 96_000));
    this.config = {
      onboard: Math.round(DEFAULT_PHASE_BUDGETS.onboard * factor),
      intake: Math.round(DEFAULT_PHASE_BUDGETS.intake * factor),
      spec: Math.round(DEFAULT_PHASE_BUDGETS.spec * factor),
      plan: Math.round(DEFAULT_PHASE_BUDGETS.plan * factor),
      build: Math.round(DEFAULT_PHASE_BUDGETS.build * factor),
      review: Math.round(DEFAULT_PHASE_BUDGETS.review * factor),
      verify: Math.round(DEFAULT_PHASE_BUDGETS.verify * factor),
      done: Math.round(DEFAULT_PHASE_BUDGETS.done * factor),
      totalTaskCap: Math.round(DEFAULT_PHASE_BUDGETS.totalTaskCap * factor)
    };
  }

  /**
   * Belirtilen aşama için harcanan tokenları kaydeder.
   */
  public recordSpend(stage: WorkflowStage, promptTokens: number, completionTokens: number): void {
    const current = this.stageSpend.get(stage) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    current.promptTokens += promptTokens;
    current.completionTokens += completionTokens;
    current.totalTokens += promptTokens + completionTokens;
    this.stageSpend.set(stage, current);
  }

  /**
   * Belirtilen aşamanın bütçe durumunu ve geçiş tavsiyesini döner.
   */
  public getPhaseStatus(stage: WorkflowStage): PhaseBudgetStatus {
    const budgetTokens = this.config[stage] ?? 4_000;
    const spend = this.stageSpend.get(stage) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const spentTokens = spend.totalTokens;
    const remainingTokens = Math.max(0, budgetTokens - spentTokens);
    const percentUsed = budgetTokens > 0 ? Math.round((spentTokens / budgetTokens) * 100) : 0;
    const isExceeded = spentTokens > budgetTokens;

    // Keşif ve planlama aşamalarında bütçenin %80'i aşıldıysa döngüden çıkış tavsiyesi verilir.
    const isReconOrPlanning =
      stage === 'onboard' || stage === 'intake' || stage === 'spec' || stage === 'plan';
    const shouldTransition = isReconOrPlanning && percentUsed >= 80;

    let advisory: string | undefined;
    if (shouldTransition) {
      advisory = `${stage.toUpperCase()} aşaması bütçesinin %${percentUsed}'i harcandı. Daha fazla keşif yerine kodlama aşamasına geçiş önerilir.`;
    } else if (isExceeded) {
      advisory = `${stage.toUpperCase()} bütçesi (${budgetTokens} token) aşıldı (Harcandı: ${spentTokens} token).`;
    }

    return {
      stage,
      budgetTokens,
      spentTokens,
      remainingTokens,
      percentUsed,
      isExceeded,
      shouldTransition,
      advisory
    };
  }

  /**
   * Tüm aşamaların toplam harcamasını döner.
   */
  public getTotalSpend(): { promptTokens: number; completionTokens: number; totalTokens: number } {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const spend of this.stageSpend.values()) {
      promptTokens += spend.promptTokens;
      completionTokens += spend.completionTokens;
      totalTokens += spend.totalTokens;
    }

    return { promptTokens, completionTokens, totalTokens };
  }

  /**
   * Görevin toplam bütçesinin aşılıp aşılmadığını denetler.
   */
  public isTaskCapExceeded(): boolean {
    return this.getTotalSpend().totalTokens >= this.config.totalTaskCap;
  }

  /**
   * Oturum sıfırlandığında harcamaları temizler.
   */
  public reset(): void {
    this.stageSpend.clear();
  }
}
