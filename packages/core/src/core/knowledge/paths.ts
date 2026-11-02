/**
 * Bilgi tabanının dosya ve klasör adları.
 *
 * Yollar tek yerde tutulur; hem bilgi tabanı hem çağrı haritası bu sabitleri
 * kullanır, böylece `.evren-kod` düzeni değişirse tek yerden güncellenir.
 */
import * as path from 'path';
import { EVREN_KOD_DIR, EVREN_KOD_SUBDIRS } from '../../shared/constants';

export const KNOWLEDGE_DIR = path.join(EVREN_KOD_DIR, EVREN_KOD_SUBDIRS.knowledge);
/** Sınıf metotları eklendiği için 3: eski indeksler okunurken atılıp yeniden kurulur. */
export const KNOWLEDGE_VERSION = 3;

export const MAP_FILE = 'map.jsonl';
export const SYMBOLS_FILE = 'symbols.jsonl';
export const STATE_FILE = 'index-state.json';

export const HUMAN_FILES = {
  project: 'project.md',
  conventions: 'conventions.md',
  decisions: 'decisions.md',
  notes: 'notes.md'
} as const;

export type HumanKnowledgeFile = keyof typeof HUMAN_FILES;

export const MODULES_DIR = 'modules';

export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.rb',
  '.php',
  '.kt',
  '.swift',
  '.dart',
  '.c',
  '.cpp',
  '.cc',
  '.h',
  '.hpp',
  '.vue',
  '.svelte'
]);

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  EVREN_KOD_DIR,
  '.next',
  '.nuxt',
  '.dart_tool',
  '.gradle',
  '.vscode-test',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'Pods',
  '.gradle',
  '.idea'
]);

/** Kullanıcı kurallarından bağımsız olarak asla bilgi tabanına girmemesi gereken dosyalar. */
export const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)secrets?(\/|\.|$)/i,
  /(^|\/)credentials?(\/|\.|$)/i
];

export const DEFAULT_MAX_FILES = 5_000;
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
/** Not/proje dosyaları prompt'lara en fazla bu boyutta dahil edilir. */
export const MAX_HUMAN_CONTEXT_CHARS = 8_000;
