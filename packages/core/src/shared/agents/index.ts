import { AgentDefinition, SubagentRoleInfo } from './types';
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

export const ALL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
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

export const AGENT_DEFINITIONS_MAP: Readonly<Record<string, AgentDefinition>> = Object.freeze(
  ALL_AGENT_DEFINITIONS.reduce<Record<string, AgentDefinition>>((acc, agent) => {
    acc[agent.name] = agent;
    return acc;
  }, {})
);

export function getAgentDefinition(name: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS_MAP[name.toLowerCase()];
}

/** Geriye dönük uyumluluk için eski rol takma adları. */
export const ROLE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  coder: 'backend',
  tester: 'quality',
  reviewer: 'quality'
});

export const BUILT_IN_SUBAGENT_ROLES: readonly SubagentRoleInfo[] = Object.freeze(
  // Tek doğruluk kaynağı kayıt defteridir (registry/*): UI rolleri türetilir,
  // böylece ad, tier, yetenek ve etiketler iki yerde ayrı ayrı bakım görmez.
  ALL_AGENT_DEFINITIONS.map((agent) => ({
    role: agent.name,
    name: agent.displayName,
    description: agent.uiDescription,
    tier: agent.tier,
    capability: agent.capability,
    tags: agent.tags
  }))
);

export const BUILT_IN_SUBAGENT_ROLE_IDS: readonly string[] = [
  ...BUILT_IN_SUBAGENT_ROLES.map((agent) => agent.role),
  ...Object.keys(ROLE_ALIASES)
];
