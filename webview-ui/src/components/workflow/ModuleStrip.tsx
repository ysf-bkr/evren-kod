import React, { useMemo, useState } from 'react';
import { Boxes, ChevronDown, ChevronRight } from 'lucide-react';
import { ModuleLayer, ModulePlan, TaskPlan } from '@shared/types';

export interface ModuleStripProps {
  modules?: ModulePlan;
  plan?: TaskPlan;
  /** Kod yazma aşamasına geçildi mi? Modül sırası o zaman anlam kazanır. */
  building: boolean;
}

const LAYER_LABEL: Record<ModuleLayer, string> = {
  shared: 'Ortak',
  domain: 'Alan',
  infrastructure: 'Altyapı',
  application: 'Uygulama',
  interface: 'Arayüz',
  test: 'Test',
  docs: 'Belge'
};

const LAYER_TONE: Record<ModuleLayer, string> = {
  shared: 'evren-kod-text-muted',
  domain: 'evren-kod-text-success',
  infrastructure: 'evren-kod-text-warning',
  application: 'evren-kod-text-info',
  interface: 'evren-kod-text-brand',
  test: 'evren-kod-text-muted',
  docs: 'evren-kod-text-muted'
};

const LAYER_ORDER: Record<ModuleLayer, number> = {
  shared: 0,
  domain: 1,
  infrastructure: 2,
  application: 3,
  interface: 4,
  test: 5,
  docs: 6
};

/**
 * Modül haritası şeridi.
 *
 * Endüstriyel akışta kod, katmanlı modüller hâlinde ve alt katmandan üst
 * katmana doğru yazılır. Şerit bu sırayı ve her modülün hangi adıma bağlı
 * olduğunu gösterir; kullanıcı "şimdi ne yazılıyor" sorusunu tek bakışta görür.
 */
export const ModuleStrip: React.FC<ModuleStripProps> = ({ modules, plan, building }) => {
  const [open, setOpen] = useState(false);

  const ordered = useMemo(() => {
    if (!modules) return [];
    return [...modules.modules].sort(
      (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.id.localeCompare(b.id)
    );
  }, [modules]);

  if (!modules || ordered.length === 0) return null;

  const stepByModule = new Map<string, string>();
  for (const step of plan?.steps ?? []) {
    if (step.moduleId && !stepByModule.has(step.moduleId)) {
      stepByModule.set(step.moduleId, step.status);
    }
  }
  const completed = ordered.filter((module) => stepByModule.get(module.id) === 'completed').length;

  return (
    <div className="overflow-hidden rounded-md border evren-kod-border-surface evren-kod-bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="composer-dock-modules"
        title={open ? 'Modül haritasını gizle' : 'Modül haritasını göster'}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:bg-[var(--evren-kod-hover-bg)]"
      >
        {open ? (
          <ChevronDown className="evren-kod-icon-xs shrink-0" />
        ) : (
          <ChevronRight className="evren-kod-icon-xs shrink-0" />
        )}
        <Boxes className="evren-kod-icon-sm shrink-0 evren-kod-text-info" />
        <span className="text-sm min-w-0 flex-1 truncate font-medium evren-kod-text-fg">
          {modules.goal || 'Modül haritası'}
        </span>
        <span className="shrink-0 font-mono text-xs evren-kod-text-muted">
          {ordered.length} modül{completed > 0 ? ` · ${completed} bitti` : ''}
        </span>
        {!building && <span className="shrink-0 text-xs evren-kod-text-warning">kod öncesi</span>}
      </button>

      {open && (
        <ol
          id="composer-dock-modules"
          className="max-h-52 space-y-0.5 overflow-y-auto border-t evren-kod-border-surface px-2 py-1.5"
        >
          {ordered.map((module, index) => {
            const status = stepByModule.get(module.id);
            return (
              <li
                key={module.id}
                className="flex items-start gap-2 rounded px-1 py-0.5 text-xs"
                title={module.responsibility}
              >
                <span className="shrink-0 font-mono text-2xs evren-kod-text-muted">{index + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`shrink-0 text-2xs font-semibold ${LAYER_TONE[module.layer]}`}>
                      {LAYER_LABEL[module.layer]}
                    </span>
                    <span className="truncate evren-kod-text-fg">{module.name}</span>
                    <span className="shrink-0 font-mono text-2xs evren-kod-text-muted">
                      @{module.ownerRole}
                    </span>
                    {status && (
                      <span
                        className={`shrink-0 text-2xs ${
                          status === 'completed'
                            ? 'evren-kod-text-success'
                            : status === 'in_progress'
                              ? 'evren-kod-text-info'
                              : status === 'blocked'
                                ? 'evren-kod-text-error'
                                : 'evren-kod-text-muted'
                        }`}
                      >
                        {status === 'completed'
                          ? 'bitti'
                          : status === 'in_progress'
                            ? 'yazılıyor'
                            : status === 'blocked'
                              ? 'engelli'
                              : 'bekliyor'}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-2xs evren-kod-text-muted">
                    {module.paths.join(', ')}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
