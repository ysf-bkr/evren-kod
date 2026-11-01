import * as vscode from 'vscode';
import * as path from 'path';
import {
  ExtensionToWebviewMessage,
  UserSettings,
  WebviewToExtensionMessage,
  VsCodeThemeConfig,
  WorkspaceCustomizations
} from '@evren-kod/core/shared/types';
import { AgentCore, createSharedServices, SharedServices } from '../core/agent/AgentCore';
import { SessionRegistry } from '../core/agent/SessionRegistry';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { logWarning } from '@evren-kod/core/shared/logging';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { ErrorReporter, githubCliRunner } from '@evren-kod/core/feedback/errorReporter';
import { buildWebviewHtml } from './webviewHtml';
import {
  loadDefaultSettings,
  mergeExplicitConfiguration,
  persistSettings,
  readThemeConfig,
  restoreSettings,
  safeSettingsForWebview,
  settingsDiffer
} from './settingsStore';
import { EvrenDiffContentProvider } from '../shared/diffContentProvider';
import { createWebviewMessageHandlers, WebviewMessageHandlerMap } from './sidebarMessageHandlers';
import { openFileInEditor, showGitFileDiff, showSnapshotDiff } from './sidebarEditorOps';
import { exportSession, importSession } from './sidebarSessionOps';
import { buildCustomizationsPayload, postGitChanges, postKnowledgeStatus } from './sidebarStatusOps';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'evren-kod.SidebarProvider';

  private _view?: vscode.WebviewView;
  private _registry?: SessionRegistry;
  /** Oturum kayıt defteri için paylaşılan ağır servisler (tek örnek). */
  private _shared?: SharedServices;
  private _settings: UserSettings;
  private _configListenerRegistered = false;
  private _pendingNewSession = false;
  private _diffProvider = EvrenDiffContentProvider.getInstance();
  private _errorReporter?: ErrorReporter;

  /**
   * Otomatik hata bildirimi tek örneği. Ayar her bildirimde yeniden
   * okunduğundan kullanıcı kapatınca bekleyen bir gönderim bile durur.
   */
  private get errorReporter(): ErrorReporter {
    if (!this._errorReporter) {
      this._errorReporter = new ErrorReporter({
        runGitHub: githubCliRunner,
        store: this._context.globalState,
        context: {
          extensionVersion: String(this._context.extension?.packageJSON?.version ?? '0.0.0'),
          appHost: vscode.env.appName,
          platform: process.platform
        },
        isEnabled: () => vscode.workspace.getConfiguration('evren-kod').get<boolean>('reportErrors') === true,
        onReported: (issueUrl) => {
          if (!issueUrl) return;
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: `Bu hata GitHub'a bildirildi: ${issueUrl}` }
          });
        },
        onSilentFailure: (reason) => logWarning('Error reporting skipped', reason)
      });
    }
    return this._errorReporter;
  }

  /** Etkin oturumun çekirdeği. Oturum yoksa `undefined`. */
  private get _agentCore(): AgentCore | undefined {
    return this._registry?.getActiveCore();
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._settings = loadDefaultSettings();
  }

  /**
   * Webview açılmadan önce ayarları ve SecretStorage anahtarlarını yükler.
   * Kurucular await edilemediği için activate() tarafından çağrılır.
   */
  public async initialize(): Promise<void> {
    try {
      this._context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
          EvrenDiffContentProvider.scheme,
          this._diffProvider
        )
      );
    } catch (err) {
      logWarning('Failed to register diff content provider', err);
    }

    try {
      this._settings = await restoreSettings(this._context, this._settings);
    } catch (err) {
      // SecretStorage okunamazsa varsayılan ayarlarla devam et.
      logWarning('Failed to load settings', err);
    }
  }

  public dispose(): void {
    this._registry?.disposeAll();
    this._registry = undefined;
  }

  /**
   * Yeni bir sohbet açar ve ona geçer.
   *
   * Önemli: çalışan diğer oturumlar **durdurulmaz**. Önceki sohbet (ve varsa
   * alt ajanları) arka planda çalışmaya devam eder; kullanıcı geçmişten geri
   * döndüğünde aynı çekirdeği bulur.
   */
  public async newSession(): Promise<void> {
    if (!this._registry) {
      // Görünüm henüz resolve edilmediyse resolve sırasında uygulanır.
      this._pendingNewSession = true;
      return;
    }
    const core = this._registry.openNewSession();
    const key = this._registry.active;
    if (key) {
      // Sıra önemli (selectSession ile aynı sözleşme): arayüz önce etkin
      // oturumu öğrenmeli, ardından durumunu almalı. Aksi halde yeni oturumun
      // boş durumu "arka plan güncellemesi" sayılır ve pencere eski sohbette
      // kalır — yeni sohbet düğmesi ve geçmişten silme aynı kök nedenden
      // etkileniyordu.
      this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: key } });
      this.postMessage({ type: 'TASK_STATE_UPDATE', payload: core.getState(), sessionKey: key });
    }
    this.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'info', message: 'Yeni bir görev başlatabilirsiniz.' }
    });
  }

  /** Oturum kayıt defterini ve paylaşılan servisleri kurar. */
  private createRegistry(): SessionRegistry {
    this._shared = createSharedServices(this._context, () => this._settings);
    return new SessionRegistry({
      context: this._context,
      settings: () => this._settings,
      shared: this._shared,
      onStateUpdate: (sessionKey, state) => {
        // Arayüz yalnızca etkin oturumun durumunu çizer; arka plan oturumları
        // için gelen güncellemeler yok sayılır (liste ayrıca gönderilir).
        if (sessionKey !== this._registry?.active) return;
        this.postMessage({ type: 'TASK_STATE_UPDATE', payload: state, sessionKey });
      },
      onNotify: (sessionKey, notification) => {
        const active = this._registry?.active;
        const isBackground = Boolean(active) && sessionKey !== active;
        // Arka plan oturumunun bilgi bildirimleri (alt ajan durum güncellemeleri
        // gibi) kullanıcıyı meşgul etmesin; yalnızca uyarı ve hatalar sızar.
        if (isBackground && notification.level === 'info') return;
        this.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: notification.level,
            message: isBackground ? `Arka plan: ${notification.message}` : notification.message
          },
          sessionKey
        });
      },
      onStreamChunk: (sessionKey, messageId, chunk) => {
        if (sessionKey !== this._registry?.active) return;
        this.postMessage({ type: 'STREAM_CHUNK', payload: { messageId, text: chunk }, sessionKey });
      },
      onSessionsChanged: () => {
        this.postMessage({
          type: 'SESSIONS_CHANGED',
          payload: {
            sessions: (this._registry?.snapshots() ?? []).map((session) => ({
              key: session.key,
              id: session.id,
              prompt: session.prompt,
              status: session.status,
              running: session.running,
              messageCount: session.messageCount
            }))
          }
        });
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist')
      ]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Oturum kayıt defteri eklentinin ömrü boyunca yaşar. Görünüm yeniden
    // açıldığında çalışan görevler, testler veya akışlar iptal edilmez.
    if (!this._registry) {
      this._registry = this.createRegistry();
      // Son etkin oturum geri yüklenir; yoksa boş bir sohbet açılır.
      this._registry.bootstrap();
      this.warmUpBackgroundIndexes();
    }

    if (this._pendingNewSession) {
      this._pendingNewSession = false;
      void this.newSession();
    }

    webviewView.onDidDispose(() => {
      if (this._view === webviewView) {
        this._view = undefined;
      }
      // Oturumlar arka planda sürer; yalnızca görünüm referansı temizlenir.
    });

    // Webview arayüzünden gelen mesajları işle
    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      try {
        await this.handleWebviewMessage(message);
      } catch (err) {
        logWarning('Failed to process message', err);
        this.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: errorMessage(err, 'An unexpected error occurred.') }
        });
      }
    });

    // Tema ve yazı tipi yapılandırma güncellemelerini dinle (yalnızca bir kez kaydet).
    if (!this._configListenerRegistered) {
      this._configListenerRegistered = true;
      this._context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (
            e.affectsConfiguration('editor') ||
            e.affectsConfiguration('terminal.integrated') ||
            e.affectsConfiguration('workbench')
          ) {
            this.postMessage({
              type: 'VSCODE_THEME_CHANGED',
              payload: this.getVsCodeThemeConfig()
            });
          }

          if (e.affectsConfiguration('evren-kod')) {
            this.syncSettingsFromConfiguration();
          }
        })
      );
    }

    // Webview hazır olur olmaz ilk ayarları ve mevcut oturum durumunu gönder
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
    this.postMessage({ type: 'VSCODE_THEME_CHANGED', payload: this.getVsCodeThemeConfig() });
    const activeCore = this._agentCore;
    const activeKey = this._registry?.active;
    if (activeCore && activeKey) {
      this.postMessage({ type: 'TASK_STATE_UPDATE', payload: activeCore.getState(), sessionKey: activeKey });
      this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: activeKey } });
    }
  }

  /**
   * Ağır indeksleri arka planda başlatır.
   *
   * Çağrı haritası dil sunucusundan üretilir; tur başlangıcını beklemek yerine
   * eklenti açılır açılmaz arka planda hazırlanır ve bellekte + diskte tutulur.
   * Kullanıcı bir dosyayı kaydettiğinde yalnızca o dosya yeniden taranır.
   *
   * Not: bu iş LLM çağrısı yapmaz. Harita LSP'den çıkarılır; model tabanlı bir
   * "alt ajan" hem pahalı hem de yanlış olurdu (uydurma kenarlar üretirdi).
   */
  private warmUpBackgroundIndexes(): void {
    const core = this._agentCore;
    if (!core) return;

    const workspaceRoot = getActiveWorkspaceRoot();
    if (workspaceRoot) {
      void core.getCallGraphManager().ensureReady(workspaceRoot);
    }

    // Kullanıcı düzenlediği dosyalar da haritaya yansısın (yalnızca ajan
    // yazdığında güncellenmesi haritayı bayat bırakıyordu).
    this._context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        const root = getActiveWorkspaceRoot();
        if (!root || document.uri.scheme !== 'file') return;
        const relative = path.relative(root, document.uri.fsPath).replace(/\\/g, '/');
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
        void core.getCallGraphManager().onFileChanged(root, relative);
      })
    );

    // Silinen dosyaların düğümleri bir sonraki kayıtta temizlenir; hemen
    // temizlemek için tam bir güncelleme tetiklenir.
    this._context.subscriptions.push(
      vscode.workspace.onDidDeleteFiles((event) => {
        const root = getActiveWorkspaceRoot();
        if (!root || event.files.length === 0) return;
        const manager = core.getCallGraphManager();
        const first = event.files[0];
        if (!first) return;
        const relative = path.relative(root, first.fsPath).replace(/\\/g, '/');
        void manager.onFileChanged(root, relative);
      })
    );
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    // Hata bildirim tek geçiş noktası: kullanıcıya ulaşan her hata mesajı
    // buradan geçer. Ayar açıksa ve `gh` hazırsa mükerrer olmayan bir GitHub
    // sorunu açılır; başarısızlık sohbet akışını asla etkilemez.
    if (message.type === 'NOTIFICATION' && message.payload.level === 'error') {
      void this.errorReporter.report(message.payload.message);
    }
    if (this._view) {
      // postMessage görünüm kapandıktan sonra reddedilebilir; yakalanmamış promise olmasın.
      Promise.resolve(this._view.webview.postMessage(message)).catch(() => {});
    }
  }

  private _messageHandlers?: WebviewMessageHandlerMap;

  /**
   * Mesaj dağıtım tablosu. Her webview mesaj tipi tam olarak bir işleyiciye
   * bağlanır; böylece bağlantı okunabilir kalır ve yeni bir mesaj tipi,
   * işleyicisinin kaydedilmesini zorunlu kılar (harita, union üzerinde
   * kapsamlıdır).
   */
  private get messageHandlers(): WebviewMessageHandlerMap {
    this._messageHandlers ??= this.createMessageHandlers();
    return this._messageHandlers;
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage) {
    const handler = this.messageHandlers[message.type] as (
      m: WebviewToExtensionMessage
    ) => Promise<void> | void;
    await handler(message);
  }

  private createMessageHandlers(): WebviewMessageHandlerMap {
    return createWebviewMessageHandlers({
      getAgentCore: () => this._agentCore,
      getSettings: () => this._settings,
      postMessage: (m) => this.postMessage(m),
      newSession: () => this.newSession(),
      selectSession: (id) => this.selectSession(id),
      updateSettings: (s) => this.updateSettings(s),
      openFileInEditor: (f, l) => this.openFileInEditor(f, l),
      postGitChanges: () => this.postGitChanges(),
      showGitFileDiff: (f) => this.showGitFileDiff(f),
      showSnapshotDiff: (f, o) => this.showSnapshotDiff(f, o),
      exportSession: (id, fmt) => this.exportSession(id, fmt),
      importSession: () => this.importSession(),
      postKnowledgeStatus: () => this.postKnowledgeStatus(),
      buildCustomizationsPayload: (r, rel) => this.buildCustomizationsPayload(r, rel),
      getSafeSettingsForWebview: () => this.getSafeSettingsForWebview(),
      getVsCodeThemeConfig: () => this.getVsCodeThemeConfig(),
      getRegistry: () => this._registry,
      getExtensionContext: () => this._context
    });
  }

  private async openFileInEditor(filePath: string, line?: number): Promise<void> {
    await openFileInEditor(filePath, line, {
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m),
      diffProvider: this._diffProvider,
      buildCustomizationsPayload: (r) => this.buildCustomizationsPayload(r)
    });
  }

  private async postGitChanges(): Promise<void> {
    await postGitChanges({
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m)
    });
  }

  private async showGitFileDiff(filePath: string): Promise<void> {
    await showGitFileDiff(filePath, {
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m),
      diffProvider: this._diffProvider,
      buildCustomizationsPayload: (r) => this.buildCustomizationsPayload(r)
    });
  }

  private async exportSession(taskId: string, format: 'json' | 'markdown'): Promise<void> {
    await exportSession(taskId, format, {
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m),
      loadSession: (id) => this.selectSession(id)
    });
  }

  private async importSession(): Promise<void> {
    await importSession({
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m),
      loadSession: (id) => this.selectSession(id)
    });
  }

  private async postKnowledgeStatus(): Promise<void> {
    await postKnowledgeStatus({
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m)
    });
  }

  private async buildCustomizationsPayload(
    workspaceRoot: string | undefined,
    reload = true
  ): Promise<WorkspaceCustomizations> {
    return buildCustomizationsPayload(this._agentCore, workspaceRoot, reload);
  }

  private async showSnapshotDiff(filePath: string, originalContent: string): Promise<void> {
    await showSnapshotDiff(filePath, originalContent, {
      getAgentCore: () => this._agentCore,
      postMessage: (m) => this.postMessage(m),
      diffProvider: this._diffProvider,
      buildCustomizationsPayload: (r) => this.buildCustomizationsPayload(r)
    });
  }

  /**
   * VS Code ayarları (evren.*) değiştiğinde ajanı ve arayüzü günceller.
   * Yalnızca açıkça yapılandırılmış değerler uygulanır; dokunulmayan ayarlar
   * oturumun zaten sahip olduğu değeri korur.
   */
  private syncSettingsFromConfiguration() {
    const config = vscode.workspace.getConfiguration('evren-kod');
    const next = mergeExplicitConfiguration(this._settings, config);
    if (!settingsDiffer(next, this._settings)) return;

    this._settings = next;
    this._agentCore?.updateSettings(this._settings);
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
  }

  private async updateSettings(newSettings: Partial<UserSettings>) {
    this._settings = await persistSettings(this._context, this._settings, newSettings);
    // Ayar tüm açık oturumlara uygulanır; arka planda çalışan bir tur yeni
    // ayarı bir sonraki isteğinde görür.
    this._registry?.updateSettings(this._settings);
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
  }

  /**
   * Başka bir sohbeti etkin yapar.
   *
   * Oturum bellekte çalışıyorsa aynı çekirdek kullanılır; arka plandaki tur ve
   * alt ajanlar kesintisiz sürer. Aksi halde geçmişten yüklenir.
   */
  private async selectSession(sessionId: string): Promise<void> {
    const registry = this._registry;
    if (!registry) return;

    const core = registry.activate(sessionId);
    if (!core) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: 'Önceki oturum bulunamadı veya silinmiş.' }
      });
      return;
    }

    const key = registry.active;
    if (!key) return;
    // Sıra önemli: arayüz önce hangi oturumun etkin olduğunu öğrenmeli,
    // ardından o oturumun durumunu almalı.
    this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: key } });
    this.postMessage({ type: 'TASK_STATE_UPDATE', payload: core.getState(), sessionKey: key });
  }

  private getSafeSettingsForWebview(): UserSettings {
    return safeSettingsForWebview(this._settings);
  }

  private getVsCodeThemeConfig(): VsCodeThemeConfig {
    return readThemeConfig();
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml({
      distDir: path.join(this._extensionUri.fsPath, 'webview-ui', 'dist'),
      cspSource: webview.cspSource,
      toWebviewUri: (relativeAssetPath) =>
        webview
          .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist', relativeAssetPath))
          .toString(),
      theme: this.getVsCodeThemeConfig()
    });
  }
}
