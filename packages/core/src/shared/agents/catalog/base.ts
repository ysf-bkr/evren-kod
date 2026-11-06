/**
 * Uzman katalog fabrikası.
 *
 * Katalog uzmanları araç yetkilerini şemsiye rolden (umbrella) devralır;
 * yalnızca uzmanlık kimliği, görev ve disiplin kuralları yazılır. Böylece
 * 89 uzmanın araç yüzeyi tek noktadan, şemsiye rolün kanıtlanmış izinleriyle
 * yönetilir — yeni uzman eklemek tek dosyalık iştir.
 */
import { AgentDefinition, AgentTag } from '../types';
import type { AgentCategory, StackId, ToolName } from '../../types';

/** Tüm uzmanların ortak kuralı: kod sembolleri daima İngilizce. */
export const ENGLISH_CODE_RULE =
  'STRICT ENGLISH CODE: All identifiers, functions, classes, interfaces, types, variables and filenames MUST be in English. Never write Turkish names in code.';

export interface SpecialistSpec {
  /** Kebab-case makine kimliği; invoke_subagent hedefi. */
  name: string;
  /** Türkçe görünen ad (UI kartı). */
  displayName: string;
  /** İngilizce meslek unvanı (modele kişilik olarak sunulur). */
  role: string;
  /** İngilizce, modele yöneltilen kısa açıklama. */
  description: string;
  /** Türkçe, arayüzde gösterilen tek satır. */
  uiDescription: string;
  /** Uzmanlaşılan teknolojiler; aktif ekip seçimi profil stack'leriyle eşleştirir. */
  stacks?: StackId[];
  tags?: AgentTag[];
  /** Şemsiye rolden farklıysa ver; çoğu uzman devralır. */
  tools?: ToolName[];
  /** Kategori şemsiyeden farklı olabilir (ör. operations). */
  category?: AgentCategory;
  mission: string;
  /** 2–4 zorunlu disiplin kuralı. */
  rules: string[];
  knowledgeFiles?: string[];
}

export function defineSpecialist(parent: AgentDefinition, spec: SpecialistSpec): AgentDefinition {
  // Orkestrasyon yetkisi yalnızca manager şemsiye rolünde kalır: katalog
  // uzmanları asla alt ajan açamaz (SubagentManager bunu zaten reddeder,
  // araç yüzeyi de aynı gerçeği yansıtır).
  const ORCHESTRATION_TOOLS: readonly string[] = ['invoke_subagent', 'run_parallel_tasks'];
  const allowedTools = (spec.tools ?? parent.tools).filter((tool) => !ORCHESTRATION_TOOLS.includes(tool));
  return {
    name: spec.name,
    displayName: spec.displayName,
    role: spec.role,
    description: spec.description,
    uiDescription: spec.uiDescription,
    capability: 8,
    tier: 'core',
    tags: spec.tags ?? parent.tags,
    category: spec.category ?? parent.category,
    stacks: spec.stacks,
    tools: allowedTools,
    instructions: {
      identity: spec.role,
      mission: spec.mission,
      chainOfThought: parent.instructions.chainOfThought,
      rules: [ENGLISH_CODE_RULE, ...spec.rules],
      knowledgeFiles: spec.knowledgeFiles
    },
    specialties: { [spec.name]: 10 }
  };
}
