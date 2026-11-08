/**
 * Araç çıktılarının model bağlamına girmeden önce optimize edilmesi ve filtrelenmesi.
 *
 * Büyük dosyalarda AST iskeleti sunar, başarılı testlerdeki gereksiz log kalabalığını
 * eler, terminal loglarındaki ANSI kodlarını temizler ve diff çıktılarından kilit
 * dosyalarını filtreleyerek %50-80 token tasarrufu sağlar.
 */

// eslint-disable-next-line no-control-regex -- ANSI kaçış kodları terminal çıktısını temizlemek için bilinçli eşlenir.
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const LOCKFILE_REGEX =
  /(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock)/i;
const MINIFIED_OR_ASSET_REGEX = /\.(min\.js|min\.css|map|svg|png|jpg|jpeg|gif|woff|woff2|ttf|eot)$/i;

const SIGNAL_REGEX =
  /(?:error|fail|exception|failed|fatal|cannot|unable|denied|undefined|✖|×|✗|TS\d{4}|at\s+\S+\s+\()/i;

export class OutputOptimizer {
  /**
   * Büyük kod dosyalarında (200+ satır) aralık belirtilmemişse fonksiyon, sınıf ve
   * tip bildirimlerini satır numaralarıyla çıkararak iskelet (skeleton) üretir.
   */
  public optimizeReadFile(
    filePath: string,
    content: string,
    options?: { offset?: number; limit?: number; maxRawLines?: number }
  ): string {
    const lines = content.split('\n');
    const maxLines = options?.maxRawLines ?? 200;

    // Satır aralığı açıkça istenmişse veya dosya kısaysa ham içeriği koru
    if (options?.offset !== undefined || options?.limit !== undefined || lines.length <= maxLines) {
      return content;
    }

    // Yalnızca kod dosyaları için iskelet çıkarımı yap
    const isCode = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|cs|cpp|c|php)$/i.test(filePath);
    if (!isCode) {
      return content;
    }

    const skeletonLines: string[] = [];
    const declarationRegex =
      /^(?:export\s+(?:default\s+)?(?:class|interface|type|function|enum|const|let|var)\b|(?:class|interface|type|function|enum|abstract\s+class)\b|(?:\s{2,4}(?:public|private|protected|static|async|get|set)\s+[a-zA-Z0-9_$]+\s*\())/;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }
      if (declarationRegex.test(line)) {
        skeletonLines.push(`L${index + 1}: ${line.slice(0, 120)}`);
      }
    });

    if (skeletonLines.length >= 5) {
      return (
        `[Dosya İskeleti: "${filePath}" toplam ${lines.length} satır. ` +
        `İlgili bölümleri tam okumak için offset ve limit ile read_file çağrısı yapın.]\n\n` +
        skeletonLines.join('\n')
      );
    }

    return content;
  }

  /**
   * Test çıktısını optimize eder:
   * - Başarılı testlerde gereksiz yüzlerce geçiş satırını atıp özeti korur.
   * - Başarısız testlerde başarılı satırları temizleyip yalnızca hata ve stack trace'leri bırakır.
   */
  public optimizeTestOutput(output: string): string {
    const stripped = output.replace(ANSI_REGEX, '');
    const lines = stripped.split('\n');

    const hasFailure = /(?:fail|failed|error|assertionerror|ERR_ASSERTION|✖|✗)/i.test(stripped);
    const passSummaryMatch =
      /(?:pass(?:ed)?\s+\d+|tests\s+\d+\s+pass|✔\s+\d+\s+pass|all tests passed)/i.exec(stripped);

    // Tüm testler başarılıysa ve hata yoksa çıktıyı damıtılmış tek özete indir
    if (!hasFailure && passSummaryMatch) {
      const summaryLines = lines.filter(
        (l) => /(?:pass|suite|duration|tests|duration_ms)/i.test(l) && !l.includes('npm run')
      );
      return `✔ Testler başarıyla geçti:\n${summaryLines.join('\n').trim() || passSummaryMatch[0]}`;
    }

    // Hata varsa yalnızca hata alan test bloklarını ve stack trace satırlarını filtrele
    if (hasFailure) {
      const filtered: string[] = [];
      let recordingFailure = false;

      for (const line of lines) {
        const isPassLine = /^\s*(?:✔|√|PASS)\b/.test(line);
        const isFailLine = /(?:✖|×|✗|FAIL|Error|AssertionError|assert)/i.test(line);

        if (isPassLine) {
          recordingFailure = false;
          continue;
        }

        if (isFailLine) {
          recordingFailure = true;
        }

        if (recordingFailure || SIGNAL_REGEX.test(line)) {
          filtered.push(line);
        }
      }

      if (filtered.length > 0) {
        return `[Test Hataları Özeti - Geçen test logları elendi]:\n${filtered.slice(0, 80).join('\n')}`;
      }
    }

    return stripped;
  }

  /**
   * Terminal komut çıktısındaki ANSI escape kodlarını ve gereksiz boşlukları temizler.
   */
  public optimizeTerminalOutput(output: string, maxChars = 4_000): string {
    const cleaned = output.replace(ANSI_REGEX, '').replace(/\r\n/g, '\n');
    if (cleaned.length <= maxChars) return cleaned;

    const headChars = Math.floor(maxChars * 0.4);
    const tailChars = Math.floor(maxChars * 0.35);
    const head = cleaned.slice(0, headChars);
    const tail = cleaned.slice(-tailChars);
    const middle = cleaned.slice(headChars, cleaned.length - tailChars);

    const signals: string[] = [];
    for (const line of middle.split('\n')) {
      if (SIGNAL_REGEX.test(line) && line.length < 250) {
        signals.push(line.trim());
        if (signals.length >= 10) break;
      }
    }

    const signalBlock =
      signals.length > 0 ? `\n[... Önemli Hata/Uyarı Sinyalleri ...]\n${signals.join('\n')}\n` : '\n';

    return `${head}\n\n[... Terminal çıktısı kırpıldı (${cleaned.length - maxChars} karakter elendi) ...]${signalBlock}\n${tail}`;
  }

  /**
   * Diff çıktısından devasa kilit dosyalarını ve minified assetleri ayıklar.
   */
  public optimizeDiffOutput(diffText: string): string {
    const diffFiles = diffText.split(/^diff --git /m);
    if (diffFiles.length <= 1) return diffText;

    const filteredDiffs: string[] = [];
    for (const fileDiff of diffFiles) {
      if (!fileDiff.trim()) continue;
      const firstLine = fileDiff.split('\n')[0] ?? '';

      if (LOCKFILE_REGEX.test(firstLine) || MINIFIED_OR_ASSET_REGEX.test(firstLine)) {
        filteredDiffs.push(
          `${firstLine}\n[Diff filtresi: Kilit dosyası / statik asset diff gövdesi token tasarrufu için elendi]\n`
        );
        continue;
      }

      filteredDiffs.push(fileDiff);
    }

    return filteredDiffs.join('\ndiff --git ');
  }
}
