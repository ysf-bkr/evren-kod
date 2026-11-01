import React, { useState } from 'react';
import {
  Ban,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderGit2,
  ListChecks,
  Loader2,
  Play,
  PlayCircle,
  Wrench
} from 'lucide-react';
import { PlanStep, TaskState } from '@shared/types';
import { ApprovalCard } from '../workflow/ApprovalCard';
import { ModuleStrip } from '../workflow/ModuleStrip';
import { PendingQuestionCard } from '../workflow/PendingQuestionCard';
import { Button } from '../ui';
import { vscode } from '../../utils/vscode';
import { describePlanStep, STEP_STATUS_COLOR, STEP_STATUS_LABEL } from '../../utils/planProgress';

interface ComposerDockProps {
  state: TaskState;
}

const stepIcon = (step: PlanStep) => {
  switch (step.status) {
    case 'completed':
      return <Check className="evren-kod-icon-xs shrink-0 evren-kod-text-success" />;
    case 'in_progress':
      return <Loader2 className="evren-kod-icon-xs shrink-0 animate-spin evren-kod-text-info" />;
    case 'blocked':
      return <Ban className="evren-kod-icon-xs shrink-0 evren-kod-text-error" />;
    default:
      return <Circle className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />;
  }
};

/**
 * Kullanıcının bir sonraki eylemini engelleyen veya yönlendiren her şey,
 * bestecinin hemen üstüne sabitlenir:
 *
 * - sıralı adım listesine açılan kompakt, tıklanabilir plan çubuğu,
 * - ajanın bekleyen sorusu,
 * - spec/plan onay kartı.
 *
 * Bunlar eskiden kaydırılabilir mesaj akışının içindeydi; tam kullanıcıya
 * gerekli oldukları anda görünümün dışına kayıyorlardı.
 */
export const ComposerDock: React.FC<ComposerDockProps> = ({ state }) => {
  const [expanded, setExpanded] = useState(false);

  const steps = state.plan?.steps ?? [];
  const hasPlan = steps.length > 0;
  const done = steps.filter((step) => step.status === 'completed').length;
  const next = steps.find((step) => step.status !== 'completed');
  const percent = hasPlan ? Math.round((done / steps.length) * 100) : 0;

  const hasModules = Boolean(state.modules && state.modules.modules.length > 0);
  const building = state.workflow?.stage === 'build' || Boolean(state.workflow?.planApproved);

  // Görev temiz bittiğinde şerit kalkar: bitmiş plan bestecinin üstünde ölü
  // bir kalas olarak durmaz; özeti sohbete sistem mesajı olarak işlenmiştir.
  const finishedQuietly =
    state.status === 'completed' && !state.pendingApproval && !state.pendingQuestion && !state.activeSubagent;

  const hasContent =
    !finishedQuietly &&
    (hasModules ||
      hasPlan ||
      Boolean(state.pendingQuestion) ||
      Boolean(state.pendingApproval) ||
      Boolean(state.activeSubagent) ||
      state.status === 'paused');
  if (!hasContent) return null;

  return (
    <div className="w-full shrink-0 space-y-1.5 px-[var(--evren-kod-pad-inline)] pt-2 pb-1">
      <ModuleStrip modules={state.modules} plan={state.plan} building={building} />

      {hasPlan && (
        <div className="overflow-hidden rounded-md border evren-kod-border-surface evren-kod-bg-surface">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="composer-dock-plan"
            title={expanded ? 'Plan adımlarını gizle' : 'Plan adımlarını göster'}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:bg-[var(--evren-kod-hover-bg)]"
          >
            {expanded ? (
              <ChevronDown className="evren-kod-icon-xs shrink-0" />
            ) : (
              <ChevronRight className="evren-kod-icon-xs shrink-0" />
            )}
            <ListChecks className="evren-kod-icon-sm shrink-0 evren-kod-text-brand" />
            <span className="text-sm min-w-0 flex-1 truncate font-medium evren-kod-text-fg">
              {state.plan?.goal || 'Görev planı'}
            </span>
            <span className="shrink-0 font-mono text-xs evren-kod-text-muted">
              {done}/{steps.length} adım · %{percent}
            </span>
            {next && (
              <span
                className={`shrink-0 text-xs ${STEP_STATUS_COLOR[next.status]}`}
                title={describePlanStep(steps.indexOf(next) + 1, next.status, next.title)}
              >
                {STEP_STATUS_LABEL[next.status]}
              </span>
            )}
          </button>

          {/* İlerleme çubuğu */}
          <div className="h-1 w-full evren-kod-bg-track overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--evren-kod-accent-bg)] to-[var(--status-success-fg)] transition-all duration-300"
              style={{ width: `${percent}%` }}
              role="progressbar"
              aria-label="Plan ilerlemesi"
              aria-valuenow={percent}
              aria-valuetext={`Planın %${percent}'i tamamlandı`}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          {/* Aktif adım ve işlem göstergesi */}
          {next && (
            <div className="flex items-center justify-between gap-1.5 px-2.5 py-1 evren-kod-bg-input border-t evren-kod-border-surface text-xs">
              <div className="flex items-center gap-1.5 min-w-0 evren-kod-text-muted">
                {next.status === 'in_progress' ? (
                  <Loader2 className="evren-kod-icon-xs shrink-0 animate-spin evren-kod-text-info" />
                ) : (
                  <Circle className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />
                )}
                <span className="truncate">
                  <span className="font-medium evren-kod-text-fg">
                    Adım {steps.indexOf(next) + 1}/{steps.length}:
                  </span>{' '}
                  {next.title}
                </span>
              </div>
              <span className="shrink-0 font-mono evren-kod-text-brand">%{percent}</span>
            </div>
          )}

          {expanded && (
            <ol
              id="composer-dock-plan"
              className="max-h-44 space-y-0.5 overflow-y-auto border-t evren-kod-border-surface px-2 py-1.5"
            >
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  aria-current={step.status === 'in_progress' ? 'step' : undefined}
                  aria-label={describePlanStep(index + 1, step.status, step.title)}
                  className={`flex items-start justify-between gap-1.5 rounded px-1 py-0.5 ${
                    step.status === 'in_progress' ? 'evren-kod-bg-hover' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">{stepIcon(step)}</span>
                    <span
                      className={`block text-sm leading-snug ${
                        step.status === 'completed'
                          ? 'evren-kod-text-muted line-through'
                          : 'evren-kod-text-fg'
                      }`}
                    >
                      {index + 1}. {step.title}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs ${STEP_STATUS_COLOR[step.status]}`}>
                    {STEP_STATUS_LABEL[step.status]}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {state.pendingQuestion && (
        <PendingQuestionCard
          key={`question-${state.pendingQuestion.toolCallId}`}
          question={state.pendingQuestion.question}
          toolCallId={state.pendingQuestion.toolCallId}
        />
      )}

      {state.pendingApproval && (
        <ApprovalCard
          key={`approval-${state.pendingApproval.kind}-${state.pendingApproval.title}`}
          approval={state.pendingApproval}
        />
      )}

      {state.activeSubagent && (
        <div
          data-testid="active-subagent-card"
          className="rounded-md border evren-kod-border-brand evren-kod-bg-surface p-2"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Bot className="evren-kod-icon-sm shrink-0 evren-kod-text-brand animate-pulse" />
              <span className="evren-kod-title truncate">
                {state.activeSubagent.displayName || state.activeSubagent.role}
              </span>
              <span className="text-2xs rounded evren-kod-bg-brand-soft px-1 py-0.5 font-mono evren-kod-text-brand shrink-0">
                alt ajan
              </span>
            </div>
            {state.activeSubagent.isolate ? (
              <span
                className="flex items-center gap-1 text-2xs evren-kod-text-warning font-mono shrink-0 evren-kod-bg-warning px-1.5 py-0.5 rounded border evren-kod-border-warning"
                title="İzole Git worktree üzerinde çalışıyor; ana çalışma alanı etkilenmez."
              >
                <FolderGit2 className="evren-kod-icon-xs" />
                İzole Worktree
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-2xs evren-kod-text-muted font-mono shrink-0"
                title="Ana çalışma alanında doğrudan çalışıyor."
              >
                Çalışma Alanı
              </span>
            )}
          </div>

          <div className="mt-1 text-2xs evren-kod-text-muted truncate">{state.activeSubagent.task}</div>

          <div className="mt-1.5 flex items-center justify-between border-t evren-kod-border-surface pt-1 text-2xs">
            <div className="flex items-center gap-1 evren-kod-text-brand">
              {state.activeSubagent.currentTool ? (
                <>
                  <Wrench className="evren-kod-icon-xs animate-spin" />
                  <span className="font-mono">
                    {state.activeSubagent.currentTool}
                    {state.activeSubagent.step
                      ? state.activeSubagent.maxSteps
                        ? ` (${state.activeSubagent.step}/${state.activeSubagent.maxSteps})`
                        : ` (adım ${state.activeSubagent.step})`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <Loader2 className="evren-kod-icon-xs animate-spin" />
                  <span>Düşünüyor ve planlıyor…</span>
                </>
              )}
            </div>
            {state.activeSubagent.worktreePath && (
              <span
                className="font-mono text-2xs evren-kod-text-muted truncate max-w-[140px]"
                title={state.activeSubagent.worktreePath}
              >
                {state.activeSubagent.worktreePath.split('/').pop()}
              </span>
            )}
          </div>
        </div>
      )}

      {state.status === 'paused' && (
        <div
          data-testid="paused-resume-card"
          className="flex items-center justify-between gap-2 rounded-md border evren-kod-border-info evren-kod-bg-info p-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <PlayCircle className="evren-kod-icon-md shrink-0 evren-kod-text-info" />
            <div className="min-w-0">
              <span className="block evren-kod-title">Görev Duraklatıldı</span>
              <span className="block truncate text-2xs evren-kod-text-muted">
                Oturum korundu; kaldığı yerden devam edebilirsiniz.
              </span>
            </div>
          </div>
          <Button
            size="xs"
            variant="primary"
            onClick={() => vscode.postMessage({ type: 'RESUME_TASK' })}
            icon={<Play className="evren-kod-icon-xs" />}
          >
            Devam Et
          </Button>
        </div>
      )}
    </div>
  );
};
