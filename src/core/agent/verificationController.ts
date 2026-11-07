/**
 * Otomatik doğrulama denetleyicisi.
 *
 * Tur içi hızlı doğrulama (tip/lint) ve görev sonu tam doğrulama burada.
 * Onarım bütçesi kararı saf `repairPolicy` modülünden gelir.
 */
import { decideRepair } from '@evren-kod/core/core/verification/repairPolicy';
import type { AgentHostBase, VerificationHost } from './agentHost';
import type { ProjectMemoryStatus } from '@evren-kod/core/core/memory/ProjectMemoryManager';
import type { VerificationManager } from '@evren-kod/core/core/verification/VerificationManager';

type VerificationResult = Awaited<ReturnType<VerificationManager['verify']>>;

/** "Zaten var olan hatalar" notunun sabit imzası: aynı not yeniden eklenmez, yerinde tazelenir. */
const PREEXISTING_NOTE_MARK = 'These errors existed before the changes';

/** Doğrulama sonuç durumunu state'e yazar ve arayüzü senkronlar (tur sonu + görev sonu ortak). */
export async function publishVerificationStats(
  host: AgentHostBase & { repairAttempts: number },
  verification: VerificationResult
): Promise<void> {
  host.state.stats.verification = {
    status: verification.status,
    attempts: host.repairAttempts,
    summary: verification.summary,
    lastRunAt: verification.ranAt,
    skippedReason: verification.skippedReason
  };
  await host.saveCurrentState();
  host.emitState();
}

export class VerificationController {
  constructor(private host: VerificationHost) {}

  /** Onarım denemesinin ortak adımı: bütçe, sistem mesajı, bildirim, kalıcılık. */
  private async injectRepairAttempt(
    attempts: number,
    verification: VerificationResult,
    warningMessage: string
  ): Promise<'retry'> {
    this.host.repairAttempts = attempts;
    const state = this.host.state;
    if (state?.stats.verification) {
      state.stats.verification.attempts = this.host.repairAttempts;
    }
    if (state) {
      state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(verification),
        timestamp: Date.now()
      });
    }
    this.host.notify({ level: 'warning', message: warningMessage });
    await this.host.saveCurrentState();
    this.host.emitState();
    return 'retry';
  }

  /**
   * Görev sonu doğrulaması: model yanıtını başka araç çağrısı yapmadan
   * bitirdiğinde tam doğrulama paketini bir kez çalıştırır ve sınırlı
   * kendini onarma döngüsünü yönetir.
   *
   * - 'retry': bir onarım denemesi enjekte edildi; döngü sürer.
   * - 'abort': görev kalıcı olarak başarısız ya da iptal edildi; turu durdur.
   * - 'done': doğrulama geçti ya da yalnızca önceden var olan hatalar kaldı.
   */
  public async runEndOfTaskVerification(
    workspaceRoot: string,
    generation: number
  ): Promise<'retry' | 'abort' | 'done'> {
    this.host.notify({ level: 'info', message: 'Görev sonu doğrulaması çalıştırılıyor...' });
    this.host.state.stats.verification = {
      status: 'running',
      attempts: this.host.repairAttempts,
      summary: 'Görev sonu doğrulaması çalışıyor...'
    };
    await this.host.saveCurrentState();
    this.host.emitState();

    const finalVerification = await this.host.verificationManager.verify(workspaceRoot, {
      signal: this.host.activeAbortController?.signal
    });
    if (this.host.isCancelled || generation !== this.host.runGeneration) return 'abort';

    this.host.state.stats.verification = {
      status: finalVerification.status,
      attempts: this.host.repairAttempts,
      summary: finalVerification.summary,
      lastRunAt: finalVerification.ranAt
    };
    await this.host.saveCurrentState();
    this.host.emitState();

    const maxRepair = this.host.settings.maxRepairAttempts ?? 2;
    const decision = decideRepair({
      status: finalVerification.status,
      newFailures: this.host.verificationManager.getNewFailures(finalVerification),
      hasBaseline: Boolean(this.host.verificationManager.getBaseline()),
      attempts: this.host.repairAttempts,
      maxAttempts: maxRepair
    });

    if (decision.action === 'retry') {
      return this.injectRepairAttempt(
        decision.attempts,
        finalVerification,
        `Görev sonu doğrulaması başarısız. Onarım denemesi ${decision.attempts}/${maxRepair}.`
      );
    }

    if (decision.action === 'abort') {
      this.host.state.status = 'failed';
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(finalVerification),
        timestamp: Date.now()
      });
      this.host.notify({
        level: 'error',
        message: `Görev sonu doğrulaması başarısız; onarım sınırına (${maxRepair}) ulaşıldı.`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'abort';
    }

    if (finalVerification.status === 'passed') {
      this.host.repairAttempts = 0;
      this.host.state.stats.verification.attempts = 0;
    }
    return 'done';
  }

  /**
   * Araç toplulukları arasında hızlı doğrulama: yalnızca statik denetimler
   * (typecheck, lint); uzun testler görev sonunda çalışır.
   *
   * - 'retry': bir onarım denemesi enjekte edildi; döngü sürer.
   * - 'abort': onarım bütçesi tükendi ya da görev iptal edildi.
   * - 'proceed': sıradaki toplulukla devam et.
   */
  public async runQuickVerification(
    workspaceRoot: string,
    generation: number
  ): Promise<'retry' | 'abort' | 'proceed'> {
    const verification = await this.host.verificationManager.verify(workspaceRoot, {
      signal: this.host.activeAbortController?.signal,
      kinds: ['typecheck', 'lint']
    });

    // Doğrulama sırasında kullanıcı iptal etmiş ya da oturum değişmiş olabilir.
    if (this.host.isCancelled || generation !== this.host.runGeneration) {
      return 'abort';
    }

    await publishVerificationStats(this.host, verification);

    const maxRepair = this.host.settings.maxRepairAttempts ?? 2;
    const decision = decideRepair({
      status: verification.status,
      newFailures: this.host.verificationManager.getNewFailures(verification),
      hasBaseline: Boolean(this.host.verificationManager.getBaseline()),
      attempts: this.host.repairAttempts,
      maxAttempts: maxRepair
    });

    if (decision.action === 'proceed' && decision.reason === 'skipped') {
      if (verification.summary !== this.host.lastVerificationSkip) {
        this.host.lastVerificationSkip = verification.summary;
        this.host.notify({ level: 'info', message: verification.summary });
      }
    } else if (decision.action === 'proceed' && decision.reason === 'only-preexisting') {
      // Başlangıç noktasında zaten var olan hatalar için ajanı döngüye sokma.
      // Not sabittir: her doğrulama turunda yenisini eklemek yerine sonuncusu
      // yerinde güncellenir, yoksa on doğrulama turu aynı öğüdü on kez taşıtır.
      const noteContent =
        `${verification.summary}\n\nNote: These errors existed before the changes. ` +
        'Make sure you did not introduce a new regression; you do not need to fix existing errors.';
      const messages = this.host.state.messages;
      const existingIndex = [...messages]
        .map((message) => message.role === 'system' && message.content.includes(PREEXISTING_NOTE_MARK))
        .lastIndexOf(true);
      if (existingIndex >= 0) {
        const previous = messages[existingIndex];
        if (previous && previous.content !== noteContent) {
          messages[existingIndex] = { ...previous, content: noteContent, timestamp: Date.now() };
        }
      } else {
        messages.push({
          id: this.host.nextMessageId(),
          role: 'system',
          content: noteContent,
          timestamp: Date.now()
        });
      }
      this.host.repairAttempts = 0;
    } else if (decision.action === 'retry') {
      return this.injectRepairAttempt(
        decision.attempts,
        verification,
        `Doğrulama başarısız. Otomatik onarım denemesi başlatılıyor: ${decision.attempts}/${maxRepair}.`
      );
    } else if (decision.action === 'abort') {
      this.host.state.status = 'failed';
      this.host.notify({
        level: 'error',
        message: `Otomatik onarım sınırına (${maxRepair}) ulaşıldı. Hatalar düzeltilemedi; rapor hazırlanıyor.`
      });
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(verification),
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'abort';
    } else if (decision.reason === 'passed') {
      this.host.repairAttempts = 0;
      // publishVerificationStats yukarıda her zaman çalıştı; daralma için koruma.
      if (this.host.state.stats.verification) {
        this.host.state.stats.verification.status = 'passed';
        this.host.state.stats.verification.attempts = 0;
      }
      await this.host.saveCurrentState();
      this.host.emitState();
    }
    return 'proceed';
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
    if (!workspaceRoot || !this.host.state.id) return;
    await this.host.projectMemory.append(workspaceRoot, {
      taskId: turnId,
      mode: this.host.state.mode,
      status,
      prompt,
      files: this.host.state.stats.filesModified,
      summary
    });
    void this.host.vectorMemory.sync(workspaceRoot, true);
  }
}
