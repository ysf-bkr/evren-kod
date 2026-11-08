import * as path from 'path';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import { EVREN_KOD_DIR } from '../../shared/constants';
import { TechDebtItem, TechDebtReport } from '../../shared/types';

export type TechDebtSeverity = 'high' | 'medium' | 'low';
export type { TechDebtItem, TechDebtReport };

const DEBT_REGEX = /(?:\/\/|\/\*|\*|#)\s*(TODO|FIXME|HACK|XXX|@deprecated)\b[:\s-]?\s*(.*)/i;

export class TechDebtTracker {
  /**
   * Tek bir dosya içeriğindeki teknik borç göstergelerini tarar.
   */
  public scanContent(filePath: string, content: string): TechDebtItem[] {
    const items: TechDebtItem[] = [];
    const lines = content.split('\n');

    // Büyük dosya kontrolü
    if (lines.length > 500) {
      items.push({
        filePath,
        line: lines.length,
        type: 'large_file',
        severity: lines.length > 800 ? 'high' : 'medium',
        description: `Dosya boyutu aşırı büyük (${lines.length} satır). Modüllere ayrılmalı.`
      });
    }

    lines.forEach((lineText, idx) => {
      const match = DEBT_REGEX.exec(lineText);
      if (!match) return;

      const rawTag = match[1]?.toUpperCase() ?? '';
      const tag = rawTag.startsWith('@') ? rawTag : rawTag === 'DEPRECATED' ? '@DEPRECATED' : rawTag;
      const message = match[2]?.trim() || lineText.trim();
      const lineNum = idx + 1;

      if (tag === 'FIXME') {
        items.push({
          filePath,
          line: lineNum,
          type: 'fixme',
          severity: 'high',
          description: `Kritik hata çözümü bekliyor: ${message}`
        });
      } else if (tag === 'HACK' || tag === 'XXX') {
        items.push({
          filePath,
          line: lineNum,
          type: 'hack',
          severity: 'medium',
          description: `Geçici kod / geçici yama (workaround): ${message}`
        });
      } else if (tag === '@DEPRECATED') {
        items.push({
          filePath,
          line: lineNum,
          type: 'deprecated',
          severity: 'medium',
          description: `Kullanım dışı API: ${message}`
        });
      } else if (tag === 'TODO') {
        items.push({
          filePath,
          line: lineNum,
          type: 'todo',
          severity: 'low',
          description: `Yapılacak iş: ${message}`
        });
      }
    });

    return items;
  }

  /**
   * Çalışma alanındaki proje kaynak dosyalarını tarayarak teknik borç raporu üretir.
   * `node_modules`, `dist`, `.git`, `out`, `build` gibi derleme çıktıları atlanır.
   */
  public async scanWorkspace(
    workspaceRoot: string,
    options?: { maxFiles?: number }
  ): Promise<TechDebtReport> {
    const maxFiles = options?.maxFiles ?? 500;
    const fileEntries: Array<{ filePath: string; content: string }> = [];

    const dirsToScan = ['src', 'packages', 'webview-ui/src', 'test', 'scripts'];
    const ignoredDirs = new Set([
      'node_modules',
      'dist',
      '.git',
      'out',
      'build',
      '.vscode-test',
      'coverage',
      '.gemini'
    ]);

    const walk = async (currentDir: string): Promise<void> => {
      if (fileEntries.length >= maxFiles) return;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (fileEntries.length >= maxFiles) break;
        if (ignoredDirs.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (
          entry.isFile() &&
          /\.(ts|tsx|js|mjs|py|go|rs)$/.test(entry.name) &&
          !entry.name.endsWith('.d.ts')
        ) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            fileEntries.push({
              filePath: path.relative(workspaceRoot, fullPath),
              content
            });
          } catch {
            // İzin veya okuma hatası olan dosyalar güvenle atlanır
          }
        }
      }
    };

    for (const d of dirsToScan) {
      const p = path.join(workspaceRoot, d);
      try {
        const stat = await fs.stat(p);
        if (stat.isDirectory()) {
          await walk(p);
        }
      } catch {
        // Klasör yoksa atla
      }
    }

    if (fileEntries.length === 0) {
      await walk(workspaceRoot);
    }

    return this.createReport(fileEntries);
  }

  /**
   * Belirtilen dosyalar için kapsamlı teknik borç raporu oluşturur.
   */
  public createReport(files: Array<{ filePath: string; content: string }>): TechDebtReport {
    const allItems: TechDebtItem[] = [];

    for (const file of files) {
      const items = this.scanContent(file.filePath, file.content);
      allItems.push(...items);
    }

    const categoryCounts = {
      todo: allItems.filter((i) => i.type === 'todo').length,
      fixme: allItems.filter((i) => i.type === 'fixme').length,
      hack: allItems.filter((i) => i.type === 'hack').length,
      deprecated: allItems.filter((i) => i.type === 'deprecated').length,
      largeFile: allItems.filter((i) => i.type === 'large_file').length
    };

    // Ceza puanı katsayıları:
    // kritik: -5, yama: -3, eski api: -2, dev dosya: -4, planlanan: -1
    const penalty =
      categoryCounts.fixme * 5 +
      categoryCounts.hack * 3 +
      categoryCounts.deprecated * 2 +
      categoryCounts.largeFile * 4 +
      categoryCounts.todo * 1;

    const score = Math.max(0, Math.min(100, 100 - penalty));

    let grade: TechDebtReport['grade'];
    if (score >= 95) grade = 'A+';
    else if (score >= 85) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    return {
      score,
      grade,
      totalIssues: allItems.length,
      categoryCounts,
      items: allItems,
      scannedFilesCount: files.length,
      timestamp: Date.now()
    };
  }

  /**
   * Markdown formatında teknik borç özeti üretir.
   */
  public generateMarkdownReport(report: TechDebtReport): string {
    const lines: string[] = [
      '# Evren Kod Teknik Borç ve Kod Sağlığı Raporu',
      '',
      `**Genel Kod Sağlığı Skoru:** ${report.score}/100 (Derece: ${report.grade})`,
      `**Taranan Dosya Sayısı:** ${report.scannedFilesCount} | **Toplam Bulgu:** ${report.totalIssues}`,
      '',
      '| Kategori | Adet | Risk Düzeyi |',
      '| :--- | :---: | :--- |',
      `| 🔴 FIXME (Kritik Çözüm Bekleyen) | ${report.categoryCounts.fixme} | Yüksek |`,
      `| 🟠 HACK / XXX (Geçici Yamalar) | ${report.categoryCounts.hack} | Orta |`,
      `| 🟡 Dev Dosyalar (>500 satır) | ${report.categoryCounts.largeFile} | Orta |`,
      `| ⚪ @deprecated (Eski API) | ${report.categoryCounts.deprecated} | Düşük/Orta |`,
      `| 🔵 TODO (Planlanan İyileştirme) | ${report.categoryCounts.todo} | Düşük |`,
      ''
    ];

    if (report.items.length > 0) {
      lines.push('## İlk 15 Bulgu Detayı', '');
      report.items.slice(0, 15).forEach((item) => {
        lines.push(
          `- \`${item.filePath}:${item.line}\` [${item.severity.toUpperCase()}] **${item.type.toUpperCase()}:** ${item.description}`
        );
      });
    }

    return lines.join('\n');
  }

  /**
   * Raporu `.evren-kod/reports/tech-debt.json` ve `tech-debt.md` olarak kaydeder.
   */
  public async saveReport(workspaceRoot: string, report: TechDebtReport): Promise<void> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR, 'reports');
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(path.join(dir, 'tech-debt.json'), JSON.stringify(report, null, 2), 'utf-8');
    await fs.writeFile(path.join(dir, 'tech-debt.md'), this.generateMarkdownReport(report), 'utf-8');
  }
}
