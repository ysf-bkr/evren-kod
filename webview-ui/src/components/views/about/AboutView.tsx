import React, { useEffect, useState } from 'react';
import {
  Github,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Zap,
  Plug,
  Layers,
  Bot,
  Compass,
  Code2,
  Scale,
  Info,
  Monitor,
  FolderOpen,
  RefreshCw,
  BookOpen,
  Bug
} from 'lucide-react';
import { AboutInfo, NavigationDestination } from '@shared/types';
import { ScreenHeader } from '../../common/ScreenHeader';
import { Logo } from '../../common/Logo';
import { Button, IconButton, LinkButton, ListButton } from '../../ui';
import { vscode } from '../../../utils/vscode';
import { COPY_FEEDBACK_MS } from '../../../utils/uiTiming';

interface AboutViewProps {
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const REPO_URL = 'https://github.com/ysf-bkr/evren-kod';
const DEVELOPER_NAME = 'Yusuf BEKAR';
const DEVELOPER_EMAIL = 'ybekar@msn.com';

const FEATURES = [
  {
    icon: <Zap className="evren-kod-icon-sm evren-kod-text-warning" />,
    title: 'Otonom ReAct',
    desc: 'Planlar, uygular, test eder ve düzeltir.'
  },
  {
    icon: <Compass className="evren-kod-icon-sm evren-kod-text-brand" />,
    title: 'Planlama / Kodlama / Eğitim modları',
    desc: 'Planlama ve eğitimde salt okunur korumalar; eğitimde adım adım ders.'
  },
  {
    icon: <Plug className="evren-kod-icon-sm evren-kod-text-info" />,
    title: 'MCP desteği',
    desc: 'Harici araçlar ve sunucular.'
  },
  {
    icon: <Layers className="evren-kod-icon-sm evren-kod-text-success" />,
    title: 'LSP entegrasyonu',
    desc: 'Tanılar, tanımlara gitme ve üzerine gelme.'
  },
  {
    icon: <Bot className="evren-kod-icon-sm evren-kod-text-brand" />,
    title: 'Alt ajanlar',
    desc: 'Görevleri uzman rollere devreder.'
  },
  {
    icon: <ShieldCheck className="evren-kod-icon-sm evren-kod-text-error" />,
    title: 'Güvenlik',
    desc: 'Yol kısıtlamaları, izinler ve denetim.'
  }
];

const SHORTCUTS = [
  { keys: 'Enter', desc: 'Mesajı gönder' },
  { keys: 'Shift + Enter', desc: 'Yeni satır' }
];

const openUrl = (url: string) => vscode.postMessage({ type: 'OPEN_EXTERNAL', payload: { url } });

export const AboutView: React.FC<AboutViewProps> = ({ onSelectMenu, changedFileCount }) => {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_ABOUT_INFO' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ABOUT_INFO_LOADED') {
        setInfo(event.data.payload);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refreshInfo = () => {
    setInfo(null);
    vscode.postMessage({ type: 'GET_ABOUT_INFO' });
  };

  const diagnostics = () => {
    const lines = [
      'Evren Kod tanılama bilgileri',
      `Geliştirici: ${DEVELOPER_NAME} <${DEVELOPER_EMAIL}>`,
      `Eklenti: ${info?.extensionVersion || __APP_VERSION__}`,
      `VS Code: ${info?.vscodeVersion || 'bilinmiyor'}`,
      `Platform: ${info?.platform || 'bilinmiyor'}`,
      `Çalışma alanı güvenilir: ${info?.isTrusted ?? 'bilinmiyor'}`,
      `Çalışma alanı kökleri: ${(info?.workspaceFolders || []).join(', ') || '(yok)'}`,
      `Tarih: ${new Date().toISOString()}`
    ].join('\n');

    navigator.clipboard
      .writeText(lines)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => {});
  };

  const version = info?.extensionVersion || __APP_VERSION__;

  return (
    <div className="evren-kod-screen">
      <ScreenHeader
        title="Hakkında"
        subtitle="Evren Kod bilgileri ve tanılama"
        onSelectMenu={onSelectMenu}
        activeDestination="about"
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Bilgileri yenile" onClick={refreshInfo} small>
            <RefreshCw className={`evren-kod-icon-xs ${!info ? 'animate-spin' : ''}`} />
          </IconButton>
        }
      />

      <div className="evren-kod-screen-body">
        <div className="evren-kod-soft-card flex flex-col items-center rounded-lg border evren-kod-border-surface p-4 text-center">
          <div className="evren-kod-avatar evren-kod-avatar-soft evren-kod-avatar--xl">
            <Logo className="evren-kod-icon-2xl" colored />
          </div>
          <div className="mt-2 text-sm font-semibold tracking-tight evren-kod-text-fg">Evren Kod</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded-full evren-kod-bg-accent px-1.5 py-0.5 font-mono evren-kod-text-on-accent text-2xs">
              v{version}
            </span>
            <span className="rounded-full border evren-kod-border-surface px-1.5 py-0.5 text-2xs evren-kod-text-muted">
              MIT
            </span>
            <span className="rounded-full border evren-kod-border-surface px-1.5 py-0.5 text-2xs evren-kod-text-muted">
              Açık kaynak
            </span>
          </div>
          <p className="mt-2 max-w-[280px] text-xs leading-relaxed evren-kod-text-muted">
            Zanaat disipliniyle kodlayan, kanıtla doğrulayan otonom VS Code ajanı. Üç ilke: izin sizden
            alınmadan tek satır yazmaz (kalkan), düzenlemeyi kanıtsız başarılı saymaz (zanaat) ve iş gerçekten
            olmadan "oldu" demez (dürüstlük).
          </p>
          <div className="mt-2 text-2xs evren-kod-text-muted">
            Geliştirici: <span className="font-medium evren-kod-text-fg">{DEVELOPER_NAME}</span>
          </div>
          <LinkButton
            plain
            onClick={() => openUrl(`mailto:${DEVELOPER_EMAIL}`)}
            className="mt-1 font-mono text-2xs"
            title="E-posta gönder"
          >
            {DEVELOPER_EMAIL}
          </LinkButton>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              variant="primary"
              size="xs"
              onClick={() => openUrl(REPO_URL)}
              icon={<Github className="evren-kod-icon-xs" />}
            >
              GitHub
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => openUrl(`${REPO_URL}#readme`)}
              icon={<BookOpen className="evren-kod-icon-xs" />}
            >
              README
            </Button>
          </div>
        </div>

        <section className="space-y-1.5">
          <div className="px-0.5 evren-kod-overline evren-kod-text-muted">Özellikler</div>
          <div className="grid grid-cols-2 gap-1.5">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-md border evren-kod-border-surface evren-kod-bg-raised p-2"
              >
                <div className="flex items-center gap-1.5">
                  {feature.icon}
                  <span className="text-xs font-medium evren-kod-text-fg">{feature.title}</span>
                </div>
                <div className="mt-0.5 text-2xs leading-relaxed evren-kod-text-muted">{feature.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 evren-kod-overline evren-kod-text-muted">Ortam</div>
          <div className="space-y-1 rounded-md border evren-kod-border-surface evren-kod-bg-raised p-2.5">
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 evren-kod-text-muted">
                <Code2 className="evren-kod-icon-xs" /> Eklenti
              </span>
              <span className="font-mono evren-kod-text-fg">v{version}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 evren-kod-text-muted">
                <Monitor className="evren-kod-icon-xs" /> VS Code
              </span>
              <span className="font-mono evren-kod-text-fg">{info?.vscodeVersion || '...'}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 evren-kod-text-muted">
                <Info className="evren-kod-icon-xs" /> İşletim sistemi
              </span>
              <span className="font-mono evren-kod-text-fg">{info?.platform || '...'}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 evren-kod-text-muted">
                <FolderOpen className="evren-kod-icon-xs" /> Çalışma alanı
              </span>
              <span className="max-w-[140px] truncate font-mono evren-kod-text-fg">
                {info?.workspaceFolders?.length ? info.workspaceFolders.join(', ') : '(açık değil)'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="flex items-center gap-1 evren-kod-text-muted">
                <ShieldCheck className="evren-kod-icon-xs" /> Güven
              </span>
              <span
                className={`font-mono ${info?.isTrusted ? 'evren-kod-text-success' : 'evren-kod-text-warning'}`}
              >
                {info ? (info.isTrusted ? 'güvenilir' : 'kısıtlı') : '...'}
              </span>
            </div>

            <Button
              variant="secondary"
              size="xs"
              block
              onClick={diagnostics}
              className="mt-1"
              icon={
                copied ? (
                  <Check className="evren-kod-icon-xs evren-kod-text-success" />
                ) : (
                  <Copy className="evren-kod-icon-xs" />
                )
              }
            >
              {copied ? 'Tanılama bilgileri kopyalandı' : 'Tanılama bilgilerini kopyala'}
            </Button>
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 evren-kod-overline evren-kod-text-muted">Kısayollar</div>
          <div className="rounded-md border evren-kod-border-surface evren-kod-bg-raised p-2">
            {SHORTCUTS.map((shortcut, index) => (
              <div
                key={shortcut.keys}
                className={`flex items-center justify-between gap-2 py-0.5 text-2xs ${index > 0 ? 'border-t evren-kod-border-surface' : ''}`}
              >
                <span className="evren-kod-text-muted">{shortcut.desc}</span>
                <kbd className="rounded border evren-kod-border-surface evren-kod-bg-input px-1 py-0.5 font-mono text-2xs evren-kod-text-fg">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="px-0.5 evren-kod-overline evren-kod-text-muted">Bağlantılar</div>
          <div className="space-y-1">
            <ListButton
              onClick={() => openUrl(`${REPO_URL}/issues`)}
              icon={<Bug className="evren-kod-icon-sm evren-kod-text-error" />}
              title="Sorun bildir"
              trailing={<ExternalLink className="evren-kod-icon-xs opacity-50" />}
            />
            <ListButton
              onClick={() => openUrl(REPO_URL)}
              icon={<Github className="evren-kod-icon-sm evren-kod-text-brand" />}
              title="Kaynak kod"
              trailing={<ExternalLink className="evren-kod-icon-xs opacity-50" />}
            />
          </div>
        </section>

        <section className="rounded-md border evren-kod-border-surface evren-kod-bg-raised p-2.5">
          <div className="flex items-center gap-1.5 evren-kod-title">
            <Scale className="evren-kod-icon-xs evren-kod-text-brand" /> Lisans ve yasal bilgiler
          </div>
          <p className="mt-1 text-2xs leading-relaxed evren-kod-text-muted">
            Evren Kod eklentisi MIT lisansı altında lisanslanmıştır ve {DEVELOPER_NAME} tarafından bağımsız
            açık kaynaklı bir proje olarak geliştirilmektedir.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1 text-2xs evren-kod-text-muted">
            <span className="rounded evren-kod-bg-base px-1.5 py-0.5">React</span>
            <span className="rounded evren-kod-bg-base px-1.5 py-0.5">Lucide</span>
            <span className="rounded evren-kod-bg-base px-1.5 py-0.5">esbuild</span>
            <span className="rounded evren-kod-bg-base px-1.5 py-0.5">VS Code API</span>
          </div>
        </section>

        <div className="pb-2 text-center text-2xs evren-kod-text-muted">
          Evren · {DEVELOPER_NAME} · Bağımsız açık kaynaklı proje
        </div>
      </div>
    </div>
  );
};
