import React, { useEffect, useState } from 'react';
import { RefreshCw, FolderTree } from 'lucide-react';
import { ProjectKind, ProjectProfile, PROJECT_KIND_IDS, PROJECT_STACK_IDS, StackId } from '@shared/types';
import { PROJECT_KIND_LABELS } from '@shared/projectLabels';
import { vscode } from '../../../utils/vscode';
import { Button, Chip, Section, SectionTitle, SelectField, Toggle } from '../../ui';

/**
 * Proje profili kartı: kullanıcının hangi tür uygulamayı geliştirdiğini
 * gösterir ve elle düzeltmeye açar. Kayıt `manual` kaynaklıdır; otomatik
 * tarama elle seçimin üzerine yazmaz — bilinen tek istisna aşağıdaki
 * "Yeniden Tara" düğmesinin açık kullanıcı eylemidir.
 */
export const ProjectProfileCard: React.FC = () => {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [kind, setKind] = useState<ProjectKind>('unknown');
  const [stacks, setStacks] = useState<StackId[]>([]);
  const [monorepo, setMonorepo] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type !== 'PROJECT_PROFILE_LOADED') return;
      const loaded = msg.payload.profile as ProjectProfile;
      setProfile(loaded);
      setKind(loaded.primaryKind);
      setStacks(loaded.stacks);
      setMonorepo(loaded.monorepo);
      setDirty(false);
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'GET_PROJECT_PROFILE' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleStack = (stack: StackId) => {
    setStacks((prev) => (prev.includes(stack) ? prev.filter((s) => s !== stack) : [...prev, stack].sort()));
    setDirty(true);
  };

  const confidencePercent = profile ? Math.round(profile.confidence * 100) : 0;

  return (
    <Section>
      <SectionTitle icon={<FolderTree className="evren-kod-icon-xs" />} title="Proje Profili ve Uzman Ekip" />
      {!profile ? (
        <p className="text-2xs evren-kod-text-muted">Profil taranıyor…</p>
      ) : (
        <>
          <p className="text-2xs evren-kod-text-muted" data-testid="project-profile-meta">
            {profile.source === 'manual' ? 'Elle seçildi' : `Otomatik tespit · Güven: %${confidencePercent}`}{' '}
            · Yığın: {profile.stacks.length > 0 ? profile.stacks.join(', ') : 'bilinmiyor'}
            {profile.monorepo ? ' · Monorepo' : ''}
          </p>
          {profile.evidence.length > 0 && (
            <ul className="text-2xs evren-kod-text-muted list-inside list-disc">
              {profile.evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <SelectField
            label="Proje türü"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ProjectKind);
              setDirty(true);
            }}
            hint="Uzman ekip bu türe göre seçilir. Otomatik tespit yanlışsa buradan düzeltin."
          >
            {PROJECT_KIND_IDS.map((id) => (
              <option key={id} value={id}>
                {PROJECT_KIND_LABELS[id]}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Teknoloji yığını">
            {PROJECT_STACK_IDS.map((stack) => (
              <Chip key={stack} active={stacks.includes(stack)} onClick={() => toggleStack(stack)}>
                {stack}
              </Chip>
            ))}
          </div>
          <Toggle
            checked={monorepo}
            onChange={(value) => {
              setMonorepo(value);
              setDirty(true);
            }}
            title="Monorepo"
            description="Depoda birden fazla bağımsız paket veya çalışma alanı var; tarama ve ekip seçimi buna göre davranır."
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() =>
                vscode.postMessage({
                  type: 'SAVE_PROJECT_PROFILE',
                  payload: { primaryKind: kind, stacks, monorepo }
                })
              }
            >
              Elle Kaydet
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className="evren-kod-icon-xs" />}
              onClick={() => vscode.postMessage({ type: 'GET_PROJECT_PROFILE', payload: { rescan: true } })}
            >
              Yeniden Tara
            </Button>
          </div>
          <p className="text-2xs evren-kod-text-muted">
            Elle kayıt kalıcıdır ve uzman ekibi anında yeniden seçer. "Yeniden Tara" otomatik tespiti
            çalıştırır; elle seçiminizi de üzerine yazabilir.
          </p>
        </>
      )}
    </Section>
  );
};
