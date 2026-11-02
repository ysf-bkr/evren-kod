/**
 * Bilgi grafiğinin veri modeli.
 *
 * Bilgi grafiği yeni bir depo değil, iki mevcut kaynağın birleşik görünümüdür:
 * - çağrı haritası (`core/callgraph`): kim kimi çağırıyor, hangi satırda
 * - bilgi tabanı (`core/knowledge`): dosya import'ları, sembol imzaları,
 *   mimari kararlar ve notlar
 *
 * Buradaki yapılar salt-okunur ve belirlenimcidir; model çağrısı yapmaz.
 * Amaç ajanın dosyaların tamamını okumadan düzenleme yapabileceği kadar
 * yeterli bağlamı, önceden hesaplanmış bir token bütçesi içinde vermektir.
 */
import type { CallGraphConfidence, CallGraphDocument } from '../callgraph/types';
import type { KnowledgeNoteMatch } from '../knowledge/extraction';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore';

/** Odak sorgusunun çözüldüğü şey. */
export type GraphFocusKind = 'symbol' | 'file' | 'directory';

/** Bir sembolün grafikteki bilgilere indirgenmiş hâli. */
export interface GraphSymbolFact {
  name: string;
  /** `function` / `method` / `class` ya da bilgi tabanının türü. */
  kind: string;
  /** Çalışma alanına göreli, eğik çizgili yol. */
  file: string;
  line: number;
  endLine?: number;
  /** Tek satırlık bildirim imzası; gövdeyi okumadan imzayı görmeyi sağlar. */
  signature?: string;
  exported?: boolean;
  isTest?: boolean;
  /** Çağrı haritası kenarının güveni; yalnızca komşular için doldurulur. */
  confidence?: CallGraphConfidence;
  /** Kaç adımda ulaşıldığı (çağıran/çağrılan taramasında). */
  depth?: number;
  /** Kenar üzerindeki çağrı satırları. */
  lines?: number[];
}

/** Bir dosyanın grafik görünümü: içeri ve dışarı bağlananlar. */
export interface GraphFileFacts {
  path: string;
  /** Bu dosyayı import eden dosyalar. */
  importers: string[];
  /** Bu dosyanın import ettiği (tabanda çözümlenmiş) dosyalar. */
  imports: string[];
  summary?: string;
  exported?: string[];
  isTest?: boolean;
  /** Harita bu dosyayı tarayamadıysa neden. */
  reason?: string;
}

/** Bir odak için hazırlanmış birleşik kart. */
export interface KnowledgeGraphCard {
  focus: string;
  kind: GraphFocusKind;
  /** Odakta çözülen tanımlar. */
  definitions: GraphSymbolFact[];
  /** Odaktan yukarıya, çağıranlar. */
  callers: GraphSymbolFact[];
  /** Odaktan aşağıya, çağrılanlar. */
  callees: GraphSymbolFact[];
  /** Etki alanındaki testler. */
  tests: GraphSymbolFact[];
  /** Odak dosyalarının dosya düzeyi bağları. */
  files: GraphFileFacts[];
  /** Karar/kural/not maddeleri. */
  notes: KnowledgeNoteMatch[];
  /** Harita veya indeks eksikse ajanın bilmesi gereken sınırlar. */
  warnings: string[];
}

/** Bir dizinin mimari özetteki satırı. */
export interface ArchitectureGroup {
  /** Göreli dizin (ör. `packages/core/src/core`). */
  path: string;
  files: number;
  /** Dışa aktarılan sembol sayısı (dosya kayıtlarından toplanır). */
  exports: number;
  /** Bu dizinden dışarı giden import sayısı. */
  outgoing: number;
  /** Bu dizine gelen import sayısı. */
  incoming: number;
}

/** Dizinler arası bağımlılık kenarı. */
export interface ArchitectureEdge {
  from: string;
  to: string;
  count: number;
}

/** Projenin kuzden görünümü: katmanlar, kavşaklar, kararlar. */
export interface ArchitectureDigest {
  groups: ArchitectureGroup[];
  /** En çok kullanılan dosyalar (gelen import + gelen çağrı toplamı). */
  hubs: Array<{ path: string; incoming: number; outgoing: number; callers: number }>;
  edges: ArchitectureEdge[];
  /** Dizin grafiğinde bulunan döngü yolu; yoksa boş. */
  cycles: string[][];
  /** Karar ve kural dosyalarından maddeler. */
  decisions: KnowledgeNoteMatch[];
  /** İndeks/harita tazelik bilgisi. */
  indexedFiles: number;
  graphFiles: number;
  warnings: string[];
}

/** Araçların bilgi tabanından beklediği dar yüzey. */
export type KnowledgeFacts = Pick<
  KnowledgeStore,
  | 'findSymbols'
  | 'symbolsOf'
  | 'getFile'
  | 'findFiles'
  | 'filesUnder'
  | 'dependentsOf'
  | 'importsOf'
  | 'fileIndex'
  | 'knowledgeNotes'
  | 'knowledgeBullets'
  | 'knowledgeStats'
>;

/** Çağrı haritası belgesinin grafik katmanının kullandığı kısmı. */
export type CallGraphFacts = Pick<CallGraphDocument, 'nodes' | 'edges' | 'files' | 'meta'>;

/** Bir sorgunun iki kaynağı; ikisi de opsiyoneldir, eksik olan uyarıya dönüşür. */
export interface GraphSources {
  graph?: CallGraphFacts;
  knowledge?: KnowledgeFacts;
}
