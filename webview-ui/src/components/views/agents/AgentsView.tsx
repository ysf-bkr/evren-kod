import React, { useMemo, useState } from 'react';
import {
  RefreshCw,
  FileCode,
  CheckCircle2,
  ExternalLink,
  Bot,
  Sparkles,
  Layers,
  BookOpen,
  PlusCircle,
  FolderGit2,
  Loader2,
  Compass,
  Wrench,
  ShieldCheck,
  TestTube2,
  Search,
  Brain,
  Trash2,
  Play,
  RotateCcw,
  Crown,
  Target,
  Server,
  Palette,
  Smartphone,
  Cpu,
  Database,
  Terminal
} from 'lucide-react';
import { NavigationDestination, TaskState } from '@shared/types';
import { BUILT_IN_SUBAGENT_ROLES } from '@shared/agents/index';
import { ScreenHeader } from '../../common/ScreenHeader';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  ListButton,
  Section,
  SectionTitle,
  Textarea
} from '../../ui';
import { KnowledgeCard } from '../../workflow/KnowledgeCard';
import { vscode } from '../../../utils/vscode';
import { useAgentsView } from './useAgentsView';

interface AgentsViewProps {
  state?: TaskState;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  manager: <Crown className="evren-kod-icon-sm evren-kod-text-warning" />,
  analyst: <Target className="evren-kod-icon-sm evren-kod-text-brand" />,
  architect: <Compass className="evren-kod-icon-sm evren-kod-text-brand" />,
  backend: <Server className="evren-kod-icon-sm evren-kod-text-info" />,
  frontend: <Palette className="evren-kod-icon-sm evren-kod-text-brand" />,
  mobile: <Smartphone className="evren-kod-icon-sm evren-kod-text-info" />,
  native: <Cpu className="evren-kod-icon-sm evren-kod-text-warning" />,
  database: <Database className="evren-kod-icon-sm evren-kod-text-info" />,
  devops: <Terminal className="evren-kod-icon-sm evren-kod-text-warning" />,
  explorer: <Search className="evren-kod-icon-sm evren-kod-text-info" />,
  git: <FolderGit2 className="evren-kod-icon-sm evren-kod-text-error" />,
  quality: <CheckCircle2 className="evren-kod-icon-sm evren-kod-text-success" />,
  security: <ShieldCheck className="evren-kod-icon-sm evren-kod-text-error" />,
  coder: <Wrench className="evren-kod-icon-sm evren-kod-text-success" />,
  tester: <TestTube2 className="evren-kod-icon-sm evren-kod-text-warning" />,
  reviewer: <ShieldCheck className="evren-kod-icon-sm evren-kod-text-success" />
};

const CodePreview: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <pre className="text-2xs mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border evren-kod-border-surface evren-kod-bg-input p-2 font-mono leading-relaxed evren-kod-text-muted">
    {children}
  </pre>
);

/** Katalog kategori sırası ve Türkçe grup başlıkları (A–L). */
const CATEGORY_ORDER = [
  'management',
  'architecture',
  'frontend',
  'backend',
  'database',
  'mobile',
  'desktop',
  'quality',
  'security',
  'devops',
  'ai',
  'operations',
  'recon'
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  management: 'Yönetim ve Analiz',
  architecture: 'Mimari ve Tasarım',
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Veritabanı',
  mobile: 'Mobil',
  desktop: 'Masaüstü',
  quality: 'Test ve Kalite',
  security: 'Güvenlik',
  devops: 'DevOps ve Altyapı',
  ai: 'Yapay Zekâ',
  operations: 'Ürün ve Operasyon',
  recon: 'Keşif'
};

export const AgentsView: React.FC<AgentsViewProps> = ({ state, onSelectMenu, changedFileCount }) => {
  const {
    customizations,
    loading,
    confirmMemoryClear,
    launchRole,
    setLaunchRole,
    launchTask,
    setLaunchTask,
    launchIsolate,
    setLaunchIsolate,
    launching,
    handleResetMemory,
    refresh,
    scaffold
  } = useAgentsView();

  const openFile = (path: string) => vscode.postMessage({ type: 'OPEN_AGENTS_FILE', payload: { path } });
  const memoryCount = customizations.memoryEntryCount || 0;

  // Katalog 100+ uzman içerir; düz liste yerine arama + kategori grupları.
  const [agentQuery, setAgentQuery] = useState('');
  const visibleGroups = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    const byCategory = new Map<string, (typeof BUILT_IN_SUBAGENT_ROLES)[number][]>();
    for (const role of BUILT_IN_SUBAGENT_ROLES) {
      if (query) {
        const haystack =
          `${role.name} ${role.role} ${role.description} ${(role.stacks ?? []).join(' ')}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      const category = role.category ?? 'recon';
      const list = byCategory.get(category) ?? [];
      list.push(role);
      byCategory.set(category, list);
    }
    return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      agents: byCategory.get(category) ?? []
    }));
  }, [agentQuery]);

  const selectRole = (role: string) => {
    setLaunchRole((current) => (current === role ? null : role));
    setLaunchTask('');
  };

  const startSubagent = () => {
    const task = launchTask.trim();
    if (!launchRole || !task || launching) return;
    vscode.postMessage({
      type: 'START_SUBAGENT',
      payload: { role: launchRole, task, isolate: launchIsolate }
    });
    setLaunchRole(null);
    setLaunchTask('');
    setLaunchIsolate(false);
  };

  const activeAgentInfo = launchRole
    ? BUILT_IN_SUBAGENT_ROLES.find((a) => a.role === launchRole) ||
      customizations.agents.find(
        (a) =>
          a.name.toLowerCase() === launchRole.toLowerCase() ||
          a.role.toLowerCase() === launchRole.toLowerCase()
      )
    : undefined;

  const launchForm = launchRole ? (
    <Card className="flex flex-col gap-2 evren-kod-border-brand evren-kod-bg-surface">
      <div className="flex items-center justify-between">
        <div className="evren-kod-title flex items-center gap-1.5">
          <Bot className="evren-kod-icon-sm evren-kod-text-brand" />
          Ajan görevi: <span className="evren-kod-text-brand">{activeAgentInfo?.name || launchRole}</span>
        </div>
        <span className="text-2xs font-mono evren-kod-text-muted">@{launchRole}</span>
      </div>
      <Textarea
        className="w-full resize-none font-mono text-xs"
        rows={3}
        placeholder={`${activeAgentInfo?.name || launchRole} ne yapsın? Görevi kısaca ve net tanımlayın.`}
        value={launchTask}
        onChange={(event) => setLaunchTask(event.target.value)}
        aria-label="Alt ajan görevi"
      />
      <Checkbox
        label="Ayrı Git worktree içinde çalıştır (ana çalışma alanını değiştirmez)"
        checked={launchIsolate}
        onChange={(event) => setLaunchIsolate(event.target.checked)}
      />
      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          size="xs"
          onClick={startSubagent}
          disabled={!launchTask.trim() || launching || Boolean(state?.activeSubagent)}
          title={
            state?.activeSubagent
              ? 'Şu anda başka bir alt ajan çalışırken yeni bir ajan başlatılamaz.'
              : undefined
          }
          icon={
            launching ? (
              <Loader2 className="evren-kod-icon-xs animate-spin" />
            ) : (
              <Play className="evren-kod-icon-xs" />
            )
          }
        >
          {launching ? 'Başlatılıyor…' : 'Başlat'}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setLaunchRole(null)}>
          Vazgeç
        </Button>
      </div>
      <p className="evren-kod-caption">
        Sonuç sohbete ve bildirimlere düşer. Yazma/komut adımları yine normal onay akışından geçer.
      </p>
    </Card>
  ) : null;

  return (
    <div className="evren-kod-screen">
      <ScreenHeader
        title="Ajanlar & Beceriler"
        subtitle="AGENTS.md, .agents/skills ve alt ajanlar"
        onSelectMenu={onSelectMenu}
        activeDestination="agents"
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Yeniden tara" onClick={refresh}>
            <RefreshCw className={`evren-kod-icon-xs ${loading ? 'animate-spin evren-kod-text-info' : ''}`} />
          </IconButton>
        }
      />

      <div className="evren-kod-screen-body">
        {state?.activeSubagent && (
          <Card className="evren-kod-border-brand evren-kod-bg-brand-soft">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full evren-kod-bg-brand opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full evren-kod-bg-brand" />
                </span>
                <span className="evren-kod-title truncate">
                  Aktif Alt Ajan: {state.activeSubagent.displayName || state.activeSubagent.role}
                </span>
              </div>
              <span className="text-2xs font-mono evren-kod-text-brand shrink-0">
                {state.activeSubagent.isolate ? 'İzole Worktree' : 'Çalışma Alanı'}
              </span>
            </div>
            <p className="mt-1 text-2xs evren-kod-text-muted line-clamp-2">{state.activeSubagent.task}</p>
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
                    <span>İşlem yürütülüyor…</span>
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
          </Card>
        )}

        <Card>
          <div className="flex items-start gap-2">
            <span className="evren-kod-toggle-row__icon evren-kod-text-info">
              <Sparkles className="evren-kod-icon-sm" />
            </span>
            <div>
              <div className="evren-kod-title">Projeye özel ajan sistemi</div>
              <p className="evren-kod-caption mt-0.5">
                Codex ve Claude Code ile uyumlu <code className="evren-kod-inline">AGENTS.md</code>, beceriler
                ve özel alt ajanlar otomatik algılanır.
              </p>
            </div>
          </div>
        </Card>

        <Section>
          <SectionTitle icon={<BookOpen className="evren-kod-icon-xs" />} title="Proje yönergeleri" />
          {customizations.hasAgentsMd ? (
            <Card className="evren-kod-border-success">
              <div className="flex items-center justify-between">
                <span className="text-xs flex items-center gap-1.5 font-medium evren-kod-text-fg">
                  <CheckCircle2 className="evren-kod-icon-xs evren-kod-text-success" /> AGENTS.md aktif
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => openFile(customizations.agentsMdPath || 'AGENTS.md')}
                  icon={<FileCode className="evren-kod-icon-xs" />}
                  title="AGENTS.md dosyasını aç"
                >
                  Aç
                </Button>
              </div>
              <CodePreview>{customizations.agentsMdContent?.slice(0, 500) || '(boş)'}</CodePreview>
            </Card>
          ) : (
            <Card className="evren-kod-border-warning evren-kod-bg-warning">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="evren-kod-title">AGENTS.md bulunamadı</div>
                  <div className="text-2xs evren-kod-text-muted mt-0.5">
                    Proje kuralları ve mimari notları her göreve otomatik olarak eklenir.
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={scaffold}
                  icon={<PlusCircle className="evren-kod-icon-xs" />}
                  title="AGENTS.md ve .agents/ şablonunu oluştur"
                >
                  Oluştur
                </Button>
              </div>
            </Card>
          )}
        </Section>

        <KnowledgeCard />

        <Section>
          <SectionTitle
            icon={<Brain className="evren-kod-icon-xs" />}
            title="Proje hafızası"
            count={memoryCount}
          />
          <Card>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs flex items-center gap-1.5 font-medium evren-kod-text-fg">
                <Brain className="evren-kod-icon-xs evren-kod-text-brand" />
                {memoryCount ? `${memoryCount} görev kaydı` : 'Henüz kayıt yok'}
              </div>
              <div className="flex items-center gap-1">
                {customizations.memoryPath && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => openFile(customizations.memoryPath!)}
                    icon={<FileCode className="evren-kod-icon-xs" />}
                  >
                    Aç
                  </Button>
                )}
                {memoryCount > 0 && (
                  <Button
                    variant={confirmMemoryClear ? 'danger' : 'ghost'}
                    size="xs"
                    onClick={handleResetMemory}
                    icon={<Trash2 className="evren-kod-icon-xs" />}
                  >
                    {confirmMemoryClear ? 'Emin misin?' : 'Temizle'}
                  </Button>
                )}
              </div>
            </div>
            <CodePreview>
              {customizations.memoryContent?.trim()
                ? customizations.memoryContent.slice(-1200)
                : 'Tamamlanan görevler otomatik olarak .evren-kod/memory.md dosyasına kaydedilir.'}
            </CodePreview>
          </Card>
        </Section>

        <Section>
          <SectionTitle
            icon={<FolderGit2 className="evren-kod-icon-xs" />}
            title="Beceriler"
            count={customizations.skills.length}
          />
          {customizations.skills.length === 0 ? (
            <EmptyState description="Özel talimatlar tanımlamak için .agents/skills/<ad>.md ekleyin." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {customizations.skills.map((skill) => (
                <ListButton
                  key={skill.name}
                  onClick={() => openFile(skill.path)}
                  icon={<BookOpen className="evren-kod-icon-md evren-kod-text-info" />}
                  title={skill.name}
                  description={skill.description}
                  trailing={<ExternalLink className="evren-kod-icon-xs opacity-50" />}
                />
              ))}
            </div>
          )}
        </Section>

        <Section>
          <SectionTitle
            icon={<Bot className="evren-kod-icon-xs" />}
            title="Özel alt ajanlar"
            count={customizations.agents.length}
          />
          {customizations.agents.length === 0 ? (
            <EmptyState description=".agents/agents/<ad>.md içinde kendi uzman ajanınızı tanımlayın." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {customizations.agents.map((agent) => (
                <div key={agent.name} className="evren-kod-list-item items-start p-2">
                  <button
                    type="button"
                    onClick={() => openFile(agent.path)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    title="Ajan tanımını aç"
                  >
                    <span className="evren-kod-toggle-row__icon evren-kod-text-warning">
                      <Bot className="evren-kod-icon-xs" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs truncate font-medium evren-kod-text-fg">{agent.name}</span>
                        <span className="evren-kod-badge evren-kod-bg-base font-mono evren-kod-text-muted">
                          {agent.role}
                        </span>
                      </span>
                      <span className="evren-kod-caption mt-0.5 line-clamp-2">{agent.description}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(agent.tools && agent.tools.length > 0 ? agent.tools : ['salt-okunur'])
                          .slice(0, 4)
                          .map((tool) => (
                            <span
                              key={tool}
                              className="evren-kod-badge evren-kod-bg-base font-mono evren-kod-text-muted"
                            >
                              {tool}
                            </span>
                          ))}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant={launchRole === agent.name ? 'primary' : 'ghost'}
                    size="xs"
                    onClick={() => selectRole(agent.name)}
                    icon={<Play className="evren-kod-icon-xs" />}
                    title={`${agent.name} ile görev başlat`}
                  >
                    Görev
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {launchForm}

        <Section>
          <SectionTitle icon={<Layers className="evren-kod-icon-xs" />} title="Yerleşik ajanlar" />
          <Input
            value={agentQuery}
            onChange={(event) => setAgentQuery(event.target.value)}
            placeholder="Uzman ara: ad, rol, teknoloji (react, flutter, güvenlik…)"
            aria-label="Yerleşik ajan ara"
          />
          {visibleGroups.length === 0 ? (
            <EmptyState description="Aramayla eşleşen uzman ajan yok." />
          ) : (
            <div className="flex flex-col gap-3">
              {visibleGroups.map((group) => (
                <div key={group.category} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-2xs font-mono uppercase tracking-wide evren-kod-text-muted">
                      {group.label}
                    </span>
                    <span className="text-2xs font-mono evren-kod-text-muted">{group.agents.length}</span>
                  </div>
                  {group.agents.map((agent) => {
                    const isCustomized = customizations.agents.some(
                      (a) =>
                        a.name.toLowerCase() === agent.role.toLowerCase() ||
                        a.role.toLowerCase() === agent.role.toLowerCase()
                    );
                    const customAgentDef = customizations.agents.find(
                      (a) =>
                        a.name.toLowerCase() === agent.role.toLowerCase() ||
                        a.role.toLowerCase() === agent.role.toLowerCase()
                    );

                    return (
                      <div
                        key={agent.role}
                        className={`rounded-md border p-2 transition ${
                          launchRole === agent.role
                            ? 'evren-kod-border-brand evren-kod-bg-info'
                            : 'evren-kod-border-surface evren-kod-bg-surface'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => selectRole(agent.role)}
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                            title={`${agent.name} ile görev başlat`}
                          >
                            <span className="mt-0.5 shrink-0">
                              {ROLE_ICONS[agent.role] ?? <Bot className="evren-kod-icon-sm" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium evren-kod-text-fg truncate">
                                  {agent.name}
                                </span>
                                <span className="text-2xs font-mono evren-kod-text-muted">
                                  ({agent.role})
                                </span>
                                {isCustomized ? (
                                  <span className="text-2xs rounded evren-kod-bg-warning border evren-kod-border-warning px-1 font-mono evren-kod-text-warning shrink-0">
                                    Özelleştirildi
                                  </span>
                                ) : agent.role === 'manager' ? (
                                  <span className="text-2xs rounded evren-kod-bg-error border evren-kod-border-error px-1 font-mono evren-kod-text-error shrink-0 font-medium">
                                    Orkestratör
                                  </span>
                                ) : (
                                  agent.tier && (
                                    <span className="text-2xs uppercase font-mono px-1 rounded evren-kod-bg-input evren-kod-text-muted border evren-kod-border-surface shrink-0">
                                      {agent.tier}
                                    </span>
                                  )
                                )}
                              </div>
                              <div className="evren-kod-caption mt-0.5 line-clamp-2">{agent.description}</div>
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            {isCustomized && customAgentDef ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => openFile(customAgentDef.path)}
                                  title="Özelleştirilmiş ajan dosyasını aç ve kurallarını düzenle"
                                  icon={<FileCode className="evren-kod-icon-xs" />}
                                >
                                  Düzenle
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    vscode.postMessage({
                                      type: 'RESET_BUILTIN_AGENT',
                                      payload: { role: agent.role }
                                    })
                                  }
                                  title="Yerleşik varsayılan ayarlara geri dön"
                                  icon={<RotateCcw className="evren-kod-icon-xs" />}
                                >
                                  Sıfırla
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() =>
                                  vscode.postMessage({
                                    type: 'CUSTOMIZE_BUILTIN_AGENT',
                                    payload: { role: agent.role }
                                  })
                                }
                                title="Bu ajanın prompt, kural ve izinlerini .agents/ altında özelleştir"
                                icon={<Wrench className="evren-kod-icon-xs" />}
                              >
                                Özelleştir
                              </Button>
                            )}
                            <Button
                              variant={launchRole === agent.role ? 'primary' : 'ghost'}
                              size="xs"
                              onClick={() => selectRole(agent.role)}
                              icon={<Play className="evren-kod-icon-xs" />}
                              title={`${agent.name} ile görev başlat`}
                            >
                              Görev
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Button
          variant="secondary"
          block
          onClick={scaffold}
          disabled={loading}
          icon={
            loading ? (
              <Loader2 className="evren-kod-icon-xs animate-spin" />
            ) : (
              <PlusCircle className="evren-kod-icon-xs evren-kod-text-info" />
            )
          }
        >
          AGENTS.md ve .agents/ şablonlarını oluştur
        </Button>

        <div className="text-2xs flex items-center justify-center gap-1 evren-kod-text-muted">
          <Search className="evren-kod-icon-xs" /> Değişiklikler otomatik taranır
        </div>
      </div>
    </div>
  );
};
