import * as path from 'path';
import * as fs from 'fs/promises';
import { EVREN_KOD_DIR } from '../../shared/constants';

/**
 * Uzun Dönem Depo ve Şema Göç Yöneticisi (MigrationManager).
 *
 * `.evren-kod/` altındaki veri yapılarının (specs, tasks, knowledge, memory, checkpoints)
 * sürüm güncellemelerinde bozulmadan, veri kaybı yaşanmadan yeni şema formatına
 * yükseltilmesini sağlar.
 */

export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationState {
  schemaVersion: number;
  lastMigrationAt: number;
  migratedVersions: number[];
}

export class MigrationManager {
  private getStatePath(workspaceRoot: string): string {
    return path.join(workspaceRoot, EVREN_KOD_DIR, 'schema.json');
  }

  public async getMigrationState(workspaceRoot: string): Promise<MigrationState> {
    const statePath = this.getStatePath(workspaceRoot);
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as MigrationState;
      if (parsed && typeof parsed.schemaVersion === 'number') {
        return parsed;
      }
    } catch {
      // Dosya yok: ilk sürüm
    }

    return {
      schemaVersion: 1,
      lastMigrationAt: 0,
      migratedVersions: [1]
    };
  }

  public async checkMigrationNeeded(workspaceRoot: string): Promise<{
    needed: boolean;
    currentVersion: number;
    targetVersion: number;
  }> {
    const state = await this.getMigrationState(workspaceRoot);
    return {
      needed: state.schemaVersion < CURRENT_SCHEMA_VERSION,
      currentVersion: state.schemaVersion,
      targetVersion: CURRENT_SCHEMA_VERSION
    };
  }

  public async runMigration(workspaceRoot: string): Promise<{
    success: boolean;
    migratedFrom: number;
    migratedTo: number;
    actions: string[];
  }> {
    const state = await this.getMigrationState(workspaceRoot);
    const actions: string[] = [];

    if (state.schemaVersion >= CURRENT_SCHEMA_VERSION) {
      return {
        success: true,
        migratedFrom: state.schemaVersion,
        migratedTo: state.schemaVersion,
        actions: ['Şema zaten en güncel sürümde. Göç gerekmedi.']
      };
    }

    const fromVersion = state.schemaVersion;

    // v1 -> v2 göçü: tasks, team ve reports dizinlerinin yapılandırılması
    if (state.schemaVersion < 2) {
      const subdirs = ['tasks', 'team', 'reports', 'specs'];
      for (const sub of subdirs) {
        const fullDir = path.join(workspaceRoot, EVREN_KOD_DIR, sub);
        await fs.mkdir(fullDir, { recursive: true });
        actions.push(`.evren-kod/${sub} dizini doğrulandı/oluşturuldu.`);
      }
      state.schemaVersion = 2;
      state.migratedVersions.push(2);
      actions.push('Şema sürümü v2 standardına yükseltildi.');
    }

    state.lastMigrationAt = Date.now();
    const statePath = this.getStatePath(workspaceRoot);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

    return {
      success: true,
      migratedFrom: fromVersion,
      migratedTo: CURRENT_SCHEMA_VERSION,
      actions
    };
  }
}
