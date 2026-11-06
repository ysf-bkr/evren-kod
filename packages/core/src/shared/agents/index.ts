import { AgentDefinition, SubagentRoleInfo } from './types';
import { ALL_SPECIALIST_DEFINITIONS } from './catalog';
import { analyst } from './registry/analyst';
import { architect } from './registry/architect';
import { backend } from './registry/backend';
import { database } from './registry/database';
import { devops } from './registry/devops';
import { explorer } from './registry/explorer';
import { frontend } from './registry/frontend';
import { git } from './registry/git';
import { manager } from './registry/manager';
import { mobile } from './registry/mobile';
import { native } from './registry/native';
import { quality } from './registry/quality';
import { security } from './registry/security';

export * from './types';
export {
  analyst,
  architect,
  backend,
  database,
  devops,
  explorer,
  frontend,
  git,
  manager,
  mobile,
  native,
  quality,
  security
};

/** Şemsiye roller: yönlendirme kurallarının ve plan sahipliğinin temeli. */
export const UMBRELLA_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  manager,
  analyst,
  architect,
  backend,
  frontend,
  mobile,
  native,
  database,
  devops,
  explorer,
  git,
  quality,
  security
];

/**
 * Tam kayıt: 13 şemsiye rol + 89 katalog uzmanı. `invoke_subagent` bu
 * kayıttan rol çözer; yönlendirme kuralları şemsiye rollerde kalır,
 * uzmanlar ekip seçimiyle görünür olur.
 */
export const ALL_AGENT_DEFINITIONS: readonly AgentDefinition[] = Object.freeze([
  ...UMBRELLA_AGENT_DEFINITIONS,
  ...ALL_SPECIALIST_DEFINITIONS
]);

export const AGENT_DEFINITIONS_MAP: Readonly<Record<string, AgentDefinition>> = Object.freeze(
  ALL_AGENT_DEFINITIONS.reduce<Record<string, AgentDefinition>>((acc, agent) => {
    acc[agent.name] = agent;
    return acc;
  }, {})
);

export function getAgentDefinition(name: string): AgentDefinition | undefined {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  // Alias'lar tek merkezde çözülür: invoke_subagent, plan sahibi ve UI
  // aynı eşlemeyi görür; iki yerde ayrı alias tablosu bakım hatası üretir.
  const resolved = ROLE_ALIASES[key] ?? key;
  return AGENT_DEFINITIONS_MAP[resolved];
}

/** Geriye dönük uyumluluk ve katalog eşlemeleri için rol takma adları. */
export const ROLE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  coder: 'backend',
  tester: 'quality',
  reviewer: 'quality',
  // Kullanıcının ekip dilindeki "lead" adları şemsiye rollere bağlanır.
  'master-orchestrator': 'manager',
  'requirements-analyst': 'analyst',
  'software-architect': 'architect',
  'frontend-lead': 'frontend',
  'backend-lead': 'backend',
  'mobile-lead': 'mobile',
  'desktop-lead': 'native',
  'database-engineer': 'database',
  'qa-lead': 'quality',
  'security-lead': 'security',
  'devops-lead': 'devops'
});

export const BUILT_IN_SUBAGENT_ROLES: readonly SubagentRoleInfo[] = Object.freeze(
  // Tek doğruluk kaynağı kayıt defteridir (registry/* + catalog/*): UI rolleri
  // türetilir, böylece ad, tier, yetenek ve etiketler iki yerde ayrı bakım görmez.
  ALL_AGENT_DEFINITIONS.map((agent) => ({
    role: agent.name,
    name: agent.displayName,
    description: agent.uiDescription,
    tier: agent.tier,
    capability: agent.capability,
    tags: agent.tags,
    category: agent.category,
    stacks: agent.stacks
  }))
);

export const BUILT_IN_SUBAGENT_ROLE_IDS: readonly string[] = [
  ...BUILT_IN_SUBAGENT_ROLES.map((agent) => agent.role),
  ...Object.keys(ROLE_ALIASES)
];
