/**
 * Uzman katalog kaydı: 12 kategorinin tüm uzmanları tek listede.
 *
 * Katalog, şemsiye rollerin (registry/*) yanına gelir; kimlik çakışması
 * kayıt anında değil modül yüklenirken patlar, sessizlik yoktur.
 */
import { AgentDefinition } from '../types';
import { managementSpecialists } from './management';
import { architectureSpecialists } from './architecture';
import { frontendSpecialists } from './frontend';
import { backendSpecialists } from './backend';
import { databaseSpecialists } from './database';
import { mobileSpecialists } from './mobile';
import { desktopSpecialists } from './desktop';
import { qualitySpecialists } from './quality';
import { securitySpecialists } from './security';
import { devopsSpecialists } from './devops';
import { aiSpecialists } from './ai';
import { operationsSpecialists } from './operations';

export * from './base';

/** Kategori sırası UI gruplamasında ve deterministik listede kullanılır. */
export const SPECIALISTS_BY_CATEGORY: Readonly<Record<string, readonly AgentDefinition[]>> = Object.freeze({
  management: managementSpecialists,
  architecture: architectureSpecialists,
  frontend: frontendSpecialists,
  backend: backendSpecialists,
  database: databaseSpecialists,
  mobile: mobileSpecialists,
  desktop: desktopSpecialists,
  quality: qualitySpecialists,
  security: securitySpecialists,
  devops: devopsSpecialists,
  ai: aiSpecialists,
  operations: operationsSpecialists
});

/** Ada göre sıralı, benzersiz uzman listesi. */
export const ALL_SPECIALIST_DEFINITIONS: readonly AgentDefinition[] = Object.freeze(
  Object.values(SPECIALISTS_BY_CATEGORY)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name))
);
