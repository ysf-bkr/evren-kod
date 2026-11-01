import * as vscode from 'vscode';
import * as path from 'path';
import { resolveWorkspacePath } from '@evren-kod/core/tools/pathSafety';
import { errorMessage } from '@evren-kod/core/shared/errors';

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  message: string;
  source?: string;
  code?: string | number;
}

export class LspClient {
  /**
   * Konum tabanlı isteklerin ortak ön yüzü: çalışma alanı yol çözümlemesi +
   * uri ve 0 tabanlı konum. Yol çözümlemesi patlarsa ajana gösterilecek mesaj döner.
   */
  private resolveTarget(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): { ok: true; uri: vscode.Uri; position: vscode.Position } | { ok: false; message: string } {
    try {
      const fullPath = workspaceRoot ? resolveWorkspacePath(filePath, workspaceRoot) : filePath;
      return {
        ok: true,
        uri: vscode.Uri.file(fullPath),
        position: new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1))
      };
    } catch (err) {
      return { ok: false, message: `Security: ${errorMessage(err)}` };
    }
  }

  /**
   * Proje ya da belirli bir dosya için derleyici, linter ve tip tanılarını toplar.
   */
  public async getDiagnostics(
    workspaceRoot?: string,
    filePath?: string,
    minSeverity: 'error' | 'warning' = 'warning'
  ): Promise<string> {
    const allDiagnostics: DiagnosticItem[] = [];

    const severityMap: Record<number, 'Error' | 'Warning' | 'Information' | 'Hint'> = {
      [vscode.DiagnosticSeverity.Error]: 'Error',
      [vscode.DiagnosticSeverity.Warning]: 'Warning',
      [vscode.DiagnosticSeverity.Information]: 'Information',
      [vscode.DiagnosticSeverity.Hint]: 'Hint'
    };

    if (filePath) {
      let fullPath: string;
      try {
        fullPath = workspaceRoot ? resolveWorkspacePath(filePath, workspaceRoot) : filePath;
      } catch (err) {
        return `Security: ${errorMessage(err)}`;
      }
      const uri = vscode.Uri.file(fullPath);
      const diags = vscode.languages.getDiagnostics(uri);
      this.collectDiagnostics(uri, diags, allDiagnostics, severityMap, minSeverity, workspaceRoot);
    } else {
      const allEntries = vscode.languages.getDiagnostics();
      for (const [uri, diags] of allEntries) {
        if (uri.scheme === 'file') {
          this.collectDiagnostics(uri, diags, allDiagnostics, severityMap, minSeverity, workspaceRoot);
        }
      }
    }

    if (allDiagnostics.length === 0) {
      return filePath
        ? `No errors or warnings found in "${filePath}" (clean).`
        : 'No compiler or type errors found in the workspace (clean).';
    }

    // Sonuçları ajan için okunur biçimde düzenle
    let output = `Found ${allDiagnostics.length} errors/warnings in total:\n\n`;
    for (const d of allDiagnostics.slice(0, 50)) {
      output += `[${d.severity.toUpperCase()}] ${d.file}:${d.line}:${d.column}\n`;
      output += `  Message: ${d.message}${d.source ? ` (${d.source})` : ''}\n\n`;
    }

    if (allDiagnostics.length > 50) {
      output += `...and ${allDiagnostics.length - 50} more errors/warnings.`;
    }

    return output.trim();
  }

  /**
   * Konum bazlı dil sağlayıcı isteğinin tek kapısı: yolu çözer, komutu yürütür,
   * hem güvenlik hem sağlayıcı hatasını ajana gösterilecek `message`'e çevirir.
   * Tanım/hover/referans metotlarının ortak iskeleti.
   */
  private async resolveAndCommand<T>(
    command: string,
    errorPrefix: string,
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<{ ok: true; value: T | undefined } | { ok: false; message: string }> {
    const target = this.resolveTarget(filePath, line, character, workspaceRoot);
    if (!target.ok) {
      return { ok: false, message: target.message };
    }
    try {
      const value = await vscode.commands.executeCommand<T>(command, target.uri, target.position);
      return { ok: true, value: value ?? undefined };
    } catch (err) {
      return { ok: false, message: `${errorPrefix}: ${errorMessage(err)}` };
    }
  }

  /**
   * Belirtilen dosya ve satır/kolonda sembolün tanımını bulur.
   */
  public async getDefinition(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<string> {
    const result = await this.resolveAndCommand<vscode.Location[] | vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      'Error searching for definition',
      filePath,
      line,
      character,
      workspaceRoot
    );
    if (!result.ok) return result.message;
    const definitions = result.value;
    if (!definitions || definitions.length === 0) {
      return `No definition found for the symbol at "${filePath}:${line}:${character}".`;
    }

    let output = `Definition location (${definitions.length} results):\n`;
    for (const def of definitions) {
      const targetUri = 'targetUri' in def ? def.targetUri : def.uri;
      const targetRange = 'targetRange' in def ? def.targetRange : def.range;
      const relPath = workspaceRoot ? path.relative(workspaceRoot, targetUri.fsPath) : targetUri.fsPath;
      output += `- File: ${relPath}, Line: ${targetRange.start.line + 1}, Column: ${targetRange.start.character + 1}\n`;
    }

    return output.trim();
  }

  /**
   * Belirtilen dosya ve satırdaki sembol için tip bilgisi (hover) getirir.
   */
  public async getHover(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<string> {
    const result = await this.resolveAndCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      'Error getting type information',
      filePath,
      line,
      character,
      workspaceRoot
    );
    if (!result.ok) return result.message;
    const hovers = result.value;
    if (!hovers || hovers.length === 0) {
      return `No type information found for "${filePath}:${line}:${character}".`;
    }

    const contents = hovers
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))
      .filter(Boolean)
      .join('\n\n');

    return contents || '(No type information)';
  }

  /**
   * Tek dosya için kesin belge sembolleri (ad, tür, satır aralığı); bilgi tabanı
   * indeksini regex tahminleri yerine tam aralıklarla zenginleştirir. Dil
   * sunucusu cevap vermezse undefined döner.
   */
  public async getDocumentSymbols(
    filePath: string,
    workspaceRoot?: string
  ): Promise<Array<{ name: string; kind: string; line: number; endLine?: number }> | undefined> {
    let fullPath: string;
    try {
      fullPath = workspaceRoot ? resolveWorkspacePath(filePath, workspaceRoot) : filePath;
    } catch (err) {
      return Promise.reject(new Error(`Security: ${errorMessage(err)}`));
    }
    const uri = vscode.Uri.file(fullPath);

    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[] | vscode.SymbolInformation[]
    >('vscode.executeDocumentSymbolProvider', uri);
    if (!symbols || symbols.length === 0) return undefined;

    const result: Array<{ name: string; kind: string; line: number; endLine?: number }> = [];
    const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation, depth: number): void => {
      if (result.length >= 300) return;
      if ('range' in symbol && symbol.range) {
        result.push({
          name: symbol.name,
          kind: symbolKindLabel(symbol.kind),
          line: symbol.range.start.line + 1,
          endLine: symbol.range.end.line + 1
        });
        if ('children' in symbol && Array.isArray(symbol.children)) {
          for (const child of symbol.children) {
            visit(child, depth + 1);
          }
        }
      } else if ('location' in symbol && symbol.location?.range) {
        result.push({
          name: symbol.name,
          kind: symbolKindLabel(symbol.kind),
          line: symbol.location.range.start.line + 1,
          endLine: symbol.location.range.end.line + 1
        });
      }
    };
    for (const symbol of symbols) {
      visit(symbol, 0);
    }
    return result;
  }

  public async getReferences(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<string> {
    const result = await this.resolveAndCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      'Error getting references',
      filePath,
      line,
      character,
      workspaceRoot
    );
    if (!result.ok) return result.message;
    const references = result.value;
    if (!references || references.length === 0) {
      return `No references found for "${filePath}:${line}:${character}".`;
    }
    const lines = references.slice(0, 200).map((reference) => {
      const rel = workspaceRoot ? path.relative(workspaceRoot, reference.uri.fsPath) : reference.uri.fsPath;
      return `- ${rel}:${reference.range.start.line + 1}:${reference.range.start.character + 1}`;
    });
    if (references.length > 200) {
      lines.push(`... and ${references.length - 200} more references.`);
    }
    return `References (${references.length}):\n${lines.join('\n')}`;
  }

  /**
   * Bir sembolün referanslarını yapısal olarak döndürür (çağrı haritası için).
   *
   * `getReferences` metni biçimlendirip döndürür; bu metot konumları ham
   * bırakır. Dil sunucusu cevap vermezse `undefined` döner.
   */
  public async getReferenceLocations(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<Array<{ file: string; line: number }> | undefined> {
    const target = this.resolveTarget(filePath, line, character, workspaceRoot);
    if (!target.ok) return undefined; // Çalışma alanı dışı: haritaya girmez.
    const { uri, position } = target;

    try {
      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
      );
      if (!references) return undefined;
      return references
        .filter((reference) => reference.uri.scheme === 'file')
        .map((reference) => ({
          file: workspaceRoot
            ? path.relative(workspaceRoot, reference.uri.fsPath).replace(/\\/g, '/')
            : reference.uri.fsPath,
          line: reference.range.start.line + 1
        }));
    } catch {
      return undefined; // Dil sunucusu yok ya da yanıt vermedi.
    }
  }

  public async getWorkspaceSymbols(query: string, workspaceRoot?: string): Promise<string> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query
      );
      if (!symbols || symbols.length === 0) {
        return `No workspace symbol found for "${query}".`;
      }
      const filtered = workspaceRoot
        ? symbols.filter((symbol) => {
            const rel = path.relative(workspaceRoot!, symbol.location.uri.fsPath);
            return !rel.startsWith('..') && !path.isAbsolute(rel);
          })
        : symbols;
      if (filtered.length === 0) {
        return `No symbol found for "${query}" in this workspace.`;
      }
      const lines = filtered.slice(0, 100).map((symbol) => {
        const rel = workspaceRoot
          ? path.relative(workspaceRoot, symbol.location.uri.fsPath)
          : symbol.location.uri.fsPath;
        return `- [${vscode.SymbolKind[symbol.kind]}] ${symbol.name} — ${rel}:${symbol.location.range.start.line + 1}`;
      });
      return `Workspace symbols (${filtered.length}):\n${lines.join('\n')}`;
    } catch (err) {
      return `Error getting workspace symbols: ${errorMessage(err)}`;
    }
  }

  private collectDiagnostics(
    uri: vscode.Uri,
    diags: vscode.Diagnostic[],
    target: DiagnosticItem[],
    severityMap: Record<number, 'Error' | 'Warning' | 'Information' | 'Hint'>,
    minSeverity: 'error' | 'warning',
    workspaceRoot?: string
  ) {
    const relFile = workspaceRoot ? path.relative(workspaceRoot, uri.fsPath) : uri.fsPath;
    // Çalışma alanı dışındaki dosyalar için tanı bildirme.
    if (workspaceRoot && (relFile.startsWith('..') || path.isAbsolute(relFile))) {
      return;
    }
    // node_modules veya dist tanılarını atla
    if (relFile.includes('node_modules') || relFile.startsWith('dist/')) {
      return;
    }

    for (const d of diags) {
      const sev = severityMap[d.severity] || 'Information';
      if (minSeverity === 'error' && sev !== 'Error') {
        continue;
      }
      if (minSeverity === 'warning' && sev !== 'Error' && sev !== 'Warning') {
        continue;
      }

      target.push({
        file: relFile,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        severity: sev,
        message: d.message,
        source: d.source,
        code: typeof d.code === 'object' ? d.code.value : d.code
      });
    }
  }
}

/** VS Code sembol türünü bilgi tabanının kullandığı etiketlere çevirir. */
function symbolKindLabel(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Class:
      return 'class';
    case vscode.SymbolKind.Interface:
      return 'interface';
    case vscode.SymbolKind.Enum:
      return 'enum';
    case vscode.SymbolKind.Struct:
      return 'type';
    case vscode.SymbolKind.TypeParameter:
      return 'type';
    case vscode.SymbolKind.Method:
      return 'method';
    case vscode.SymbolKind.Function:
      return 'function';
    case vscode.SymbolKind.Property:
      return 'property';
    case vscode.SymbolKind.Variable:
      return 'variable';
    case vscode.SymbolKind.Constant:
      return 'variable';
    case vscode.SymbolKind.Module:
      return 'module';
    case vscode.SymbolKind.Namespace:
      return 'module';
    default:
      return 'symbol';
  }
}
