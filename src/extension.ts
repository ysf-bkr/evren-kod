import * as vscode from 'vscode';
import { SidebarProvider } from './webview/SidebarProvider';
import { setLogSink } from '@evren-kod/core/shared/logging';
import { errorMessage } from '@evren-kod/core/shared/errors';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Evren Kod');
  context.subscriptions.push(output);
  setLogSink((level, message, error) => {
    const suffix = error === undefined ? '' : ` — ${errorMessage(error)}`;
    output.appendLine(`[${level}] ${message}${suffix}`);
  });

  const sidebarProvider = new SidebarProvider(context.extensionUri, context);

  // Ayarlar ve API anahtarları yüklenmeden webview/ajan oluşturulmaz (yarış durumunu önler).
  await sidebarProvider.initialize();

  // Webview görünümünü kaydet
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Komutları kaydet
  context.subscriptions.push(
    sidebarProvider,
    vscode.commands.registerCommand('evren-kod.openSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.evren-kod-sidebar-view');
    }),
    vscode.commands.registerCommand('evren-kod.newTask', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.evren-kod-sidebar-view');
      await sidebarProvider.newSession();
      vscode.window.showInformationMessage('Evren Kod: Yeni görev oturumu hazır.');
    })
  );
}

export function deactivate() {
  setLogSink(undefined);
}
