/**
 * Aktif ekip seçimi.
 *
 * Kayıt defterinde 100+ uzman yaşar ama hiçbir tur hepsini göremez:
 * proje profili (tür + stack) her görev için küçük, deterministik bir ekip
 * seçer. Seçim saf fonksiyondur — aynı profil her zaman aynı ekibi üretir,
 * böylece önbellekler ve prompt karşılaştırmaları tutarlı kalır.
 *
 * Öncelik sırası: çekirdek gözetmenler → türün şemsiye rolleri →
 * stack eşleşen uzmanlar → kategori uzmanları. Bütçe dolunca uzmanlar
 * düşer; şemsiye roller asla düşmez.
 */
import type { AgentCategory, ProjectKind, StackId } from '../types';
import { AgentDefinition } from './types';
import { ALL_AGENT_DEFINITIONS, UMBRELLA_AGENT_DEFINITIONS } from './index';

const UMBRELLA_NAMES = new Set(UMBRELLA_AGENT_DEFINITIONS.map((agent) => agent.name));

/** Her ekipte bulunan gözetmen/analiz omurgası. */
const CORE_ROLES: readonly string[] = [
  'manager',
  'analyst',
  'architect',
  'explorer',
  'quality',
  'security',
  'git'
];

/** Uygulama türü → zorunlu şemsiye roller. */
const KIND_UMBRELLAS: Readonly<Record<ProjectKind, readonly string[]>> = {
  'web-frontend': ['frontend'],
  'web-backend': ['backend', 'database'],
  fullstack: ['frontend', 'backend', 'database'],
  mobile: ['mobile'],
  desktop: ['native'],
  library: ['backend'],
  cli: ['backend'],
  unknown: []
};

/** Uygulama türü → uzman havuzuna katılan katalog kategorileri. */
const KIND_CATEGORIES: Readonly<Record<ProjectKind, readonly AgentCategory[]>> = {
  'web-frontend': ['frontend'],
  'web-backend': ['backend', 'database'],
  fullstack: ['frontend', 'backend', 'database'],
  mobile: ['mobile'],
  desktop: ['desktop'],
  library: ['backend'],
  cli: ['backend'],
  unknown: []
};

/** Ekip bütçesinin tavanı; istemci büyüdükçe uzman sayısı incelir. */
export const DEFAULT_TEAM_BUDGET = 14;

export interface TeamProfileInput {
  kinds: readonly ProjectKind[];
  stacks: readonly StackId[];
  monorepo?: boolean;
}

export interface TeamSelection {
  /** Bütçe sırasına göre dizilmiş aktif ekip. */
  team: readonly AgentDefinition[];
  /** Rol başına seçim gerekçesi (log ve UI için, Türkçe). */
  reasons: Readonly<Record<string, string>>;
}

/**
 * Profilden deterministik aktif ekip seçer.
 *
 * @param input proje profili (türler ağırlık sıralı)
 * @param budget ekipten en fazla kaç ajan işaretlenir (varsayılan 14)
 */
export function selectActiveTeam(input: TeamProfileInput, budget = DEFAULT_TEAM_BUDGET): TeamSelection {
  const kinds = input.kinds.length > 0 ? input.kinds : (['unknown'] as ProjectKind[]);
  const stacks = new Set<StackId>(input.stacks);
  const reasons = new Map<string, string>();

  // 1) Çekirdek gözetmenler daima içeride.
  const team: AgentDefinition[] = [];
  const taken = new Set<string>();
  const push = (agent: AgentDefinition, reason: string) => {
    if (taken.has(agent.name)) return;
    taken.add(agent.name);
    team.push(agent);
    reasons.set(agent.name, reason);
  };

  for (const role of CORE_ROLES) {
    const agent = ALL_AGENT_DEFINITIONS.find((a) => a.name === role);
    if (agent) push(agent, 'çekirdek gözetmen');
  }

  // 2) Türlerin şemsiye rolleri.
  for (const kind of kinds) {
    for (const role of KIND_UMBRELLAS[kind] ?? []) {
      const agent = ALL_AGENT_DEFINITIONS.find((a) => a.name === role);
      if (agent) push(agent, `${kind} türünün şemsiye rolü`);
    }
  }

  // 3) Uzman havuzu: tür kategorileri + stack eşleşmeleri.
  const categories = new Set<AgentCategory>();
  for (const kind of kinds) for (const category of KIND_CATEGORIES[kind] ?? []) categories.add(category);

  const candidates = ALL_AGENT_DEFINITIONS.filter(
    (agent) => !taken.has(agent.name) && !UMBRELLA_NAMES.has(agent.name)
  );

  type Ranked = { agent: AgentDefinition; priority: number; matches: number; reason: string };
  const ranked: Ranked[] = [];
  for (const agent of candidates) {
    const stackMatch = (agent.stacks ?? []).filter((stack) => stacks.has(stack));
    const inCategory = categories.has(agent.category);
    if (stackMatch.length > 0) {
      ranked.push({
        agent,
        priority: inCategory ? 0 : 1,
        matches: stackMatch.length,
        reason: `stack eşleşmesi: ${stackMatch.join(', ')}`
      });
    } else if (inCategory) {
      ranked.push({
        agent,
        priority: 2,
        matches: 0,
        reason: `${agent.category} kategorisi görevin türüyle ilgili`
      });
    }
    // Ne stack ne kategori: bu turda ekibe girmez.
  }
  // Aynı öncelikte daha çok stack eşleşmesi kazanır; eşitlik ad sırasıyla deterministiktir.
  ranked.sort(
    (a, b) => a.priority - b.priority || b.matches - a.matches || a.agent.name.localeCompare(b.agent.name)
  );

  for (const entry of ranked) {
    if (team.length >= budget) break;
    push(entry.agent, entry.reason);
  }

  return { team, reasons: Object.fromEntries(reasons) };
}

/**
 * Ekibi sistem prompt'una verilecek İngilizce blok haline getirir.
 * Yalnızca seçilen ekip listelenir; katalog gerisi modele gösterilmez.
 */
export function formatTeamContext(selection: TeamSelection, profile?: TeamProfileInput): string {
  if (selection.team.length === 0) return '';
  const profileLine = profile
    ? `Project profile: ${profile.kinds.join(', ')}${profile.stacks.length ? ` | stacks: ${profile.stacks.join(', ')}` : ''}\n`
    : '';
  const lines = selection.team.map((agent) => {
    const stacks = agent.stacks && agent.stacks.length > 0 ? ` [${agent.stacks.join(', ')}]` : '';
    return `  - @${agent.name}${stacks}: ${agent.description}`;
  });
  return `=== ACTIVE SPECIALIST TEAM (selected from the specialist catalog for this project) ===
${profileLine}This is the specialist roster chosen for THIS project. Delegate domain work to these teammates with invoke_subagent first; the wider catalog exists but stays out of the roster on purpose — reach for a non-roster specialist only when the task genuinely demands it and say why in your report.
${lines.join('\n')}
The @manager role orchestrates: it decomposes work, assigns it to the teammates above, reviews every specialist report, and owns cross-module consistency. A change is accepted only after review; unverified specialist work is never reported to the user as done.`;
}
