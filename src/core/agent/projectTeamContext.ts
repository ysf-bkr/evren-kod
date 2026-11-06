/**
 * Proje profili + aktif ekip istem bağlamı (VS Code konağı).
 *
 * Profil işçi iplikte yeniden taranmasın diye kök başına bir kez çözülür;
 * sistem isteminin bayt-kararlı önbellek öneki bozulmasın. Kullanıcı
 * `.evren-kod/project-profile.json` dosyasını elle düzenlerse
 * `invalidateProjectTeamContext` ile tazeletilir.
 */
import { resolveProfile } from '@evren-kod/core/core/project/ProjectProfiler';
import { formatTeamContext, selectActiveTeam } from '@evren-kod/core/shared/agents/team';

const contextCache = new Map<string, Promise<string>>();

/** Seçili ekip bloğunu üretir; hâl durumu sessizce boş blok olarak döner. */
export function projectTeamContext(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return Promise.resolve('');
  const cached = contextCache.get(workspaceRoot);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const profile = await resolveProfile(workspaceRoot);
      const selection = selectActiveTeam(profile);
      return formatTeamContext(selection, profile);
    } catch {
      // Profil çıkarılamayan klasör ekipsiz kalır; akış asla bundan durmaz.
      return '';
    }
  })();
  contextCache.set(workspaceRoot, pending);
  return pending;
}

/** Bir kökün profil/ekip önbelleğini düşürür (sonraki tur yeniden tarar). */
export function invalidateProjectTeamContext(workspaceRoot: string): void {
  contextCache.delete(workspaceRoot);
}
