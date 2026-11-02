import * as vscode from 'vscode';
import { AgentMode, ChatMessage } from '@evren-kod/core/shared/types';
import { isChatConfigured } from '@evren-kod/core/shared/constants';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { logWarning } from '@evren-kod/core/shared/logging';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { autonomyLevel, decideContinuation } from '@evren-kod/core/core/agent/autonomy';
import type { AgentCore, SendMessageOptions } from './AgentCore';

/**
 * Tek bir kullanıcı istemi veya iç devam turunun akışını yönetir.
 */
export async function runAgentTurn(
  core: AgentCore,
  text: string,
  mode?: AgentMode,
  options: SendMessageOptions = {}
): Promise<void> {
  // Model ayarı henüz yapılmadıysa veya sağlayıcı gereksinimleri eksikse mesajı reddet.
  if (!options.internal && !core['hasCustomProvider'] && !isChatConfigured(core.settings)) {
    core.notify({
      level: 'warning',
      message: 'Sohbeti başlatmak için lütfen önce Ayarlar bölümünden bir model sağlayıcısı yapılandırın.'
    });
    return;
  }

  // Ajan soru sorduysa ana girişten gelen metni yanıt olarak ele al.
  if (core.state.status === 'waiting_user_input' && core.pendingQuestionResolver) {
    const resolver = core.pendingQuestionResolver;
    core.pendingQuestionResolver = undefined;
    resolver(text);
    return;
  }

  // Bir spec veya plan onay bekliyor. Burada yeni bir döngü başlatmak kapıyı
  // atlatırdı; kart yanıtlanana kadar mesaj reddedilir.
  if (core.state.pendingApproval && !options.internal) {
    core.notify({
      level: 'warning',
      message: 'Onay bekleyen bir spec veya plan var. Lütfen onay kartını kullanın.'
    });
    core.emitState();
    return;
  }

  // Aynı anda ikinci bir ajan döngüsünün başlatılmasını engelle (yinelenen istek/yazma olmaz).
  if (!options.internal && (core.state.status === 'running' || core.state.status === 'waiting_approval')) {
    core.notify({
      level: 'warning',
      message: 'Ajan şu anda çalışıyor. Yeni görev göndermeden önce işlemin tamamlanmasını bekleyin.'
    });
    return;
  }

  // İptal bayrağını yalnızca kullanıcının yeni gönderimi temizler. İç turlar
  // (otonom devam, onay sonrası sürdürme) bayrağı temizlememeli: zamanlayıcı
  // ile iptal arasında yarış varsa geç bir iç tur, kullanıcının "dur"unu
  // sessizce silebilirdi.
  if (!options.internal) core.isCancelled = false;
  // Kullanıcı yeni bir görev verdiyse otonom devam bütçesi sıfırlanır;
  // iç turlar bütçeyi paylaşır.
  if (!options.internal) core.autoContinuations = 0;
  const generation = core.runGeneration;

  if (mode) {
    core.state.mode = mode;
  }

  const workspaceRoot = getActiveWorkspaceRoot();

  // Etkin oturum yoksa oluştur
  if (!core.state.id || core.state.messages.length === 0) {
    core.state.id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    core.state.prompt = text;
    core.state.messages = [];
    await core['context'].workspaceState.update('evren_kod_active_session_id', core.state.id);
  }

  if (workspaceRoot) {
    await core.ensureSessionPersistence(workspaceRoot);
  }
  core.repairAttempts = 0;

  // @file bahsini okumadan önce izin kurallarını yükle.
  try {
    await core.permissionManager.loadProjectPermissions(workspaceRoot, vscode.workspace.isTrusted);
  } catch (err) {
    // Varsayılanlarla devam et ama nedenini output kanalında tut:
    // sessizce yok sayılan bir izin dosyası güvenlik açısından kötü bir sürprizdir.
    logWarning('Could not load project permissions; using global defaults', err);
  }

  const editorContext = options.internal ? '' : await core.buildEditorContext(text, workspaceRoot);
  if (generation !== core.runGeneration || core.isCancelled) {
    return;
  }
  const fullUserPrompt = editorContext ? `${text}${editorContext}` : text;

  // İç devam turları (onay sonrası sürdürme) kullanıcı yazısı değildir;
  // sahte bir kullanıcı balonu yerine sistem mesajı olarak kaydedilir.
  const userMsg: ChatMessage = {
    id: core.nextMessageId(),
    role: options.internal ? 'system' : 'user',
    content: fullUserPrompt,
    timestamp: Date.now()
  };
  // Tur kimliği: kullanıcı istemi ve ona ait tüm asistan adımları aynı
  // kimliği taşır, arayüz bunları tek yanıt bloğunda toplar.
  userMsg.turnId = userMsg.id;
  core.currentTurnId = userMsg.id;
  core.state.messages.push(userMsg);
  core.state.status = 'running';
  core.emitState();
  await core.saveCurrentState();
  if (generation !== core.runGeneration || core.isCancelled) {
    return;
  }

  // Tur başında checkpoint al
  core.repairAttempts = 0;
  core.knowledgeCurator.resetTurnBudget();
  core.memoryRecordedForTask = false;
  // Token bütçesi görev kapsamlıdır: yeni kullanıcı istemi sayacı sıfırlar,
  // iç devam turları aynı görevin harcamasını sürdürür. Kırılımlar da toplamla
  // birlikte sıfırlanmalı: rozet "görev tüketimi" der, ipucu ise giden/gelen
  // kırılımını gösterir; yarısı sıfırlansa ikisi farklı dönemleri sayardı.
  if (!options.internal) {
    core.state.stats.totalTokens = 0;
    core.state.stats.promptTokens = 0;
    core.state.stats.completionTokens = 0;
    core.state.stats.cachedTokens = 0;
  }
  core.checkpointManager.createCheckpoint(core.state, core.state.stats.stepsCount);
  core.state.checkpoints = core.checkpointManager.getSummaries();

  const filesModifiedBefore = core.state.stats.filesModified.length;
  core.toolPipeline.claimNextPlanStep();

  try {
    await core.loop.run(userMsg.id, text);
    if (generation !== core.runGeneration) {
      return;
    }

    // Görev duraklatıldıysa (örn. günlük token limiti veya bütçe aşımı), iptal
    // edildiyse veya başarısız olduysa iş akışını ilerletme ve otomatik devam turu başlatma.
    const currentStatus = core.getState().status;
    if (
      core.isCancelled ||
      currentStatus === 'paused' ||
      currentStatus === 'cancelled' ||
      currentStatus === 'failed'
    ) {
      return;
    }

    const changedFiles =
      core.state.stats.filesModified.length > filesModifiedBefore || core.changedFilesInLastTurn;

    // Model üzerinde çalıştığı adımı kapatmayı unuttuysa burada kapat ki
    // gerçek iş yapılırken plan "0/N" üzerinde kalmasın. İnceleme/araştırma
    // görevlerinde dosya değişmese bile araçlar çalıştırılıp tur bittiğinde
    // adım tamamlanır.
    const lastMsg = core.state.messages[core.state.messages.length - 1];
    const hasToolActivity = (lastMsg?.toolCalls?.length ?? 0) > 0;
    if (core.activePlanStepId && (changedFiles || core.isTaskCompleted() || hasToolActivity)) {
      const step = core.planner.getPlan()?.steps.find((item) => item.id === core.activePlanStepId);
      if (step && step.status === 'in_progress') {
        core.state.plan = core.planner.setStepStatus(step.id, 'completed');
      }
    }
    core.activePlanStepId = undefined;

    // Yönlendirilmiş iş akışını ilerlet ki ilerleme şeridi plan onaylandıktan
    // sonra "Uygulama" aşamasında takılı kalmasın.
    await core.workflow.advanceWorkflowAfterTurn({ changedFiles });

    // Otonom mod: görev bitene kadar turlar kendiliğinden sürer. Sayaç ve
    // karar saf `autonomy` modülünden gelir; sonsuz döngü olmaz.
    const workflowNow = core.workflow.getWorkflow();
    const decision = decideContinuation({
      level: autonomyLevel(core.settings),
      continuations: core.autoContinuations,
      maxContinuations: core.settings.maxContinuations,
      cancelled: core.isCancelled,
      finished: workflowNow.stage === 'done',
      pendingApproval: Boolean(core.state.pendingApproval)
    });
    if (decision.action === 'continue') {
      core.autoContinuations++;
      await core.saveCurrentState();
      core.emitState();
      setTimeout(() => {
        if (core.isCancelled || generation !== core.runGeneration) return;
        void core
          .handleSendMessage(
            'Görev henüz bitmedi. Kaldığın yerden devam et: plan adımlarını tamamla, ' +
              'kabul kriterlerini işaretle ve doğrulamayı geçir. Bitirmeden "tamamlandı" deme.',
            undefined,
            { internal: true }
          )
          .catch((err: unknown) => {
            core.notify({
              level: 'error',
              message: errorMessage(err, 'Otonom devam turu başlatılamadı.')
            });
          });
      }, 0);
    } else if (decision.reason === 'budget') {
      core.notify({
        level: 'warning',
        message: `Otonom devam sınırına ulaşıldı (${core.autoContinuations}). Görev elle sürdürülmeli.`
      });
    }
  } catch (err) {
    // Eski döngünün hataları yeni oturumu etkilememeli.
    if (generation !== core.runGeneration) {
      return;
    }
    // Beklenmeyen bir hata ajanı "running" durumunda sıkıştırmamalı.
    if (core.state.status === 'running') {
      core.state.status = 'failed';
    }
    core.notify({
      level: 'error',
      message: errorMessage(err, 'An unexpected error occurred in the agent loop.')
    });
    await core.saveCurrentState();
    core.emitState();
  }
}
