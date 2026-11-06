/** Test sabitleri: stack kimlikleri proje tipiyle karıştırılmasın diye ayrılır. */
import type { ProjectKind, StackId } from '@evren-kod/core/shared/types';

/** Derlemede StackId birliğine karşı doğrulanmış kimlik listesi. */
export const STACK_IDS: readonly StackId[] = [
  'typescript',
  'javascript',
  'react',
  'nextjs',
  'vue',
  'nuxt',
  'angular',
  'svelte',
  'nodejs',
  'nestjs',
  'express',
  'python',
  'django',
  'fastapi',
  'flask',
  'java',
  'spring',
  'kotlin',
  'dotnet',
  'aspnet',
  'php',
  'laravel',
  'go',
  'rust',
  'cpp',
  'qt',
  'csharp',
  'flutter',
  'dart',
  'android',
  'ios',
  'swift',
  'react-native',
  'electron',
  'tauri',
  'sql',
  'postgres',
  'mysql',
  'sqlite',
  'mongodb',
  'prisma',
  'redis',
  'graphql',
  'grpc',
  'docker',
  'kubernetes',
  'terraform',
  'ansible',
  'ci-github',
  'ml-python',
  'mcp'
];

const KIND_SET = new Set<ProjectKind>([
  'web-frontend',
  'web-backend',
  'fullstack',
  'mobile',
  'desktop',
  'library',
  'cli',
  'unknown'
]);

export function isProjectKind(value: string): boolean {
  return KIND_SET.has(value as ProjectKind);
}
