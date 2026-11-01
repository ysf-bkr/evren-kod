import * as vscode from 'vscode';

/**
 * VS Code fark (diff) görünümü için bellek-içi sanal içerik sağlayıcı.
 * Orijinal (değişiklik öncesi), önerilen (proposed) veya Git HEAD içeriğini 'evren-kod-diff' şemasıyla sunar.
 * Bellek-içi sanal şema salt-okunurdur ve untitled belgeler gibi "Kayıt edilsin mi?" uyarısı tetiklemez.
 */
export class EvrenDiffContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  public static readonly scheme = 'evren-kod-diff';
  private static instance: EvrenDiffContentProvider | undefined;

  private _documents = new Map<string, string>(); // anahtarlar kararlı (dosya + amaç): aynı amaç üzerine yazar, harita sınırlı kalır
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  public static getInstance(): EvrenDiffContentProvider {
    if (!EvrenDiffContentProvider.instance) {
      EvrenDiffContentProvider.instance = new EvrenDiffContentProvider();
    }
    return EvrenDiffContentProvider.instance;
  }

  public setDocumentContent(uri: vscode.Uri, content: string): void {
    this._documents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this._documents.get(uri.toString()) ?? '';
  }

  public dispose(): void {
    this._documents.clear();
    this._onDidChange.dispose();
  }
}
