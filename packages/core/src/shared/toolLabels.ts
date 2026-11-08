/**
 * Araç adımlarının kullanıcıya Türkçe anlatımı ve tek bakışlık detayları.
 *
 * Hem VS Code webview hem de CLI aynı sunum metinlerini kullanır.
 * Kod içi kimlikler İngilizce kalır; sunum ise kullanıcıya ne yapıldığını
 * açık ve doğal bir dille bildirir.
 */
import { ToolCall, ToolName } from './types';
import { getAgentDefinition, BUILT_IN_SUBAGENT_ROLES } from './agents';

/** Her aracın şimdiki zaman Türkçe başlığı; ToolName birleşiminin tamamı kapsanır. */
export const TOOL_TITLES: Record<ToolName, string> = {
  read_file: 'Dosya okunuyor',
  write_file: 'Dosya oluşturuluyor',
  edit_file: 'Dosya düzenleniyor',
  search_files: 'Kod aranıyor',
  list_directory: 'Klasör taranıyor',
  execute_command: 'Terminal komutu',
  run_tests: 'Testler çalıştırılıyor',
  run_linter: 'Kod denetleyicisi çalıştırılıyor',
  git_diff: 'Git farkı alınıyor',
  git_status: 'Git durumu okunuyor',
  invoke_subagent: 'Alt ajan görevlendiriliyor',
  ask_followup_question: 'Kullanıcıya soru soruluyor',
  read_skill: 'Beceri okunuyor',
  get_diagnostics: 'Tanılar inceleniyor',
  get_definition: 'Tanıma gidiliyor',
  get_hover: 'İmza bilgisi okunuyor',
  undo_change: 'Değişiklik geri alınıyor',
  update_plan: 'Plan güncelleniyor',
  update_module_plan: 'Modül haritası güncelleniyor',
  run_verification: 'Doğrulama çalıştırılıyor',
  record_release_gate: 'Yayın kapısı kararı kaydediliyor',
  get_references: 'Kullanımlar aranıyor',
  get_workspace_symbols: 'Çalışma alanı sembolleri listeleniyor',
  index_workspace: 'Çalışma alanı indeksleniyor',
  find_symbol: 'Sembol aranıyor',
  analyze_impact: 'Etki analizi yapılıyor',
  git_create_branch: 'Git dalı oluşturuluyor',
  git_commit: 'Git değişikliği kaydediliyor',
  prepare_pr: 'PR hazırlanıyor',
  web_fetch: 'Web sayfası getiriliyor',
  web_search: "Web'de aranıyor",
  search_memory: 'Bellekte aranıyor',
  read_notebook: 'Defter okunuyor',
  run_parallel_tasks: 'Paralel görevler çalıştırılıyor',
  merge_worktree: 'Worktree birleştiriliyor',
  write_spec: 'Şartname yazılıyor',
  update_acceptance_criteria: 'Kabul kriterleri güncelleniyor',
  write_knowledge_file: 'Bilgi dosyası yazılıyor',
  get_project_knowledge: 'Proje bilgisi sorgulanıyor',
  add_knowledge_note: 'Bilgi notu ekleniyor',
  knowledge_graph: 'Bilgi grafiği sorgulanıyor',
  graph_callers: 'Çağıranlar grafi okunuyor',
  graph_callees: 'Çağrılanlar grafi okunuyor',
  graph_impact: 'Etki alanı grafiyle çıkarılıyor',
  graph_search: 'Bilgi grafiğinde aranıyor',
  graph_status: 'Bilgi grafiği durumu okunuyor',
  get_callers: 'Çağıran fonksiyonlar bulunuyor',
  get_callees: 'Çağrılan fonksiyonlar bulunuyor',
  call_graph_impact: 'Çağrı grafiği etkisi çıkarılıyor',
  find_related_code: 'İlgili kod bulunuyor',
  call_graph_status: 'Çağrı grafiği durumu okunuyor'
};

/** Alt ajan rolünün Türkçe Görünen Adı; tanımadığı rolde ham kimlik döner. */
export function subagentRoleName(role: unknown): string {
  const raw = typeof role === 'string' ? role.trim() : '';
  if (!raw) return 'uzman';
  const normalized = raw.replace(/^@/, '');
  const definition = getAgentDefinition(normalized);
  if (definition?.displayName) return definition.displayName;
  const info = BUILT_IN_SUBAGENT_ROLES.find((entry) => entry.role.toLowerCase() === normalized.toLowerCase());
  return info?.name ?? normalized;
}

const SHORT_KEYS = [
  'path',
  'file',
  'url',
  'query',
  'focus',
  'symbol',
  'note',
  'goal',
  'task',
  'question',
  'skill_name',
  'name',
  'title',
  'message'
] as const;

/** Ayrıntı satırı: tek satıra indirgenmiş, uzunluğu kesilmiş tek bakışlık bilgi. */
export function shortenDetail(value: string, maxLen = 160): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > maxLen ? `${single.slice(0, maxLen - 3)}…` : single;
}

/** Adım kartının ikinci satırı: araç bazlı özel alan, yoksa genel anahtar sırası. */
export function toolStepDetail(
  toolCall: ToolCall | { name: ToolName; args?: Record<string, unknown> }
): string {
  const args = toolCall.args ?? {};
  const str = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');

  switch (toolCall.name) {
    case 'execute_command':
    case 'run_tests':
    case 'run_linter':
      return shortenDetail(str('command') || 'Komut otomatik seçildi');
    case 'list_directory':
      return shortenDetail(str('path') || '.');
    case 'get_diagnostics':
      return shortenDetail(str('path') || 'Tüm proje');
    case 'invoke_subagent':
      return shortenDetail(str('task'));
    case 'graph_impact':
    case 'call_graph_impact': {
      const symbols = args.symbols;
      if (Array.isArray(symbols)) {
        return shortenDetail(symbols.filter((s): s is string => typeof s === 'string').join(', '));
      }
      break;
    }
    default:
      break;
  }

  for (const key of SHORT_KEYS) {
    const value = str(key);
    if (value) return shortenDetail(value);
  }
  return '';
}
