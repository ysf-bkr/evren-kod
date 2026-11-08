/**
 * FastApply — Hızlı ve Akıllı Diff / Değişiklik Uygulama Motoru
 *
 * Büyük dosyalarda (500+ satır) dosyanın tamamını baştan yazmak yerine,
 * sadece değişen kod bloklarını (hunk/chunk veya SEARCH/REPLACE) güvenle ve
 * toleranslı (fuzzy) olarak uygular.
 *
 * Temel Yetenekler:
 * 1. Tam Eşleşme (Exact Match): Hedef metin birebir eşleşirse anında değiştirir.
 * 2. Bulanık Eşleşme (Fuzzy Match): Girinti (boşluk/tab), satır sonları (\r\n vs \n)
 *    veya küçük biçimlendirme farklarında satır bazlı Levenshtein / benzerlik
 *    puanlaması yaparak doğru bloğu bulur (güven skoru >= 0.80).
 * 3. Çoklu Blok Sıralı Uygulama: Birden fazla hunk/chunk uygulandığında satır
 *    kaymalarını (offset drift) takip ederek sonraki blokların bozulmasını önler.
 * 4. Aider/Cursor SEARCH/REPLACE Blok Desteği:
 *    <<<<<<< SEARCH
 *    eski kod
 *    =======
 *    yeni kod
 *    >>>>>>> REPLACE
 */

export interface FastApplyChunk {
  search: string;
  replace: string;
  startLineHint?: number;
}

export interface FastApplyResult {
  success: boolean;
  content: string;
  appliedCount: number;
  totalChunks: number;
  confidence: number;
  diffSummary?: string;
  error?: string;
}

export interface FuzzyMatchLocation {
  startIndex: number;
  endIndex: number;
  confidence: number;
  matchedText: string;
}

/** Satırı girinti ve satır sonu boşluklarından arındırıp normalize eder. */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/** İki satır arasındaki Levenshtein mesafesini hesaplar. */
function lineDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev;
      } else {
        row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + 1);
      }
      prev = temp;
    }
  }
  return row[b.length]!;
}

/** İki satır dizisi arasındaki benzerlik oranını hesaplar (0.0 - 1.0). */
function compareLineArrays(targetLines: string[], candidateLines: string[]): number {
  if (targetLines.length !== candidateLines.length || targetLines.length === 0) return 0;

  let totalScore = 0;
  for (let i = 0; i < targetLines.length; i++) {
    const t = normalizeLine(targetLines[i] ?? '');
    const c = normalizeLine(candidateLines[i] ?? '');
    if (t === c) {
      totalScore += 1;
    } else {
      const maxLen = Math.max(t.length, c.length);
      if (maxLen === 0) {
        totalScore += 1;
      } else {
        const dist = lineDistance(t, c);
        const sim = Math.max(0, 1 - dist / maxLen);
        totalScore += sim;
      }
    }
  }
  return totalScore / targetLines.length;
}

export class FastApplyEngine {
  /**
   * Hedef metni kaynak metin içinde tam veya bulanık (fuzzy) olarak arar.
   * Girinti ve boşluk farklarını tolere eder.
   */
  public static findFuzzy(
    sourceText: string,
    targetText: string,
    minConfidence = 0.8
  ): FuzzyMatchLocation | undefined {
    // 1. Önce tam eşleşme kontrolü
    const exactIndex = sourceText.indexOf(targetText);
    if (exactIndex !== -1) {
      return {
        startIndex: exactIndex,
        endIndex: exactIndex + targetText.length,
        confidence: 1.0,
        matchedText: targetText
      };
    }

    // 2. CRLF/LF normalizasyonu ile tam eşleşme
    const normSource = sourceText.replace(/\r\n/g, '\n');
    const normTarget = targetText.replace(/\r\n/g, '\n');
    const normExactIndex = normSource.indexOf(normTarget);
    if (normExactIndex !== -1) {
      // Orijinal kaynak metindeki karakter konumuna eşle
      const before = normSource.slice(0, normExactIndex);
      const linesBefore = before.split('\n').length - 1;
      const targetLinesCount = normTarget.split('\n').length - 1;

      const sourceLines = sourceText.split(/\r?\n/);
      const startLine = linesBefore;
      const endLine = startLine + targetLinesCount;

      const startChar = sourceLines.slice(0, startLine).reduce((acc, l) => acc + l.length + 1, 0);
      const matchedBlock = sourceLines.slice(startLine, endLine + 1).join('\n');

      return {
        startIndex: startChar,
        endIndex: startChar + matchedBlock.length,
        confidence: 0.99,
        matchedText: matchedBlock
      };
    }

    // 3. Satır bazlı kayan pencere (Sliding Window) ve Levenshtein benzerliği
    const sourceLines = normSource.split('\n');
    const targetLines = normTarget.split('\n');

    if (targetLines.length === 0 || sourceLines.length < targetLines.length) {
      return undefined;
    }

    let bestScore = 0;
    let bestStartLine = -1;

    const windowSize = targetLines.length;
    for (let i = 0; i <= sourceLines.length - windowSize; i++) {
      const windowLines = sourceLines.slice(i, i + windowSize);
      const score = compareLineArrays(targetLines, windowLines);

      if (score > bestScore) {
        bestScore = score;
        bestStartLine = i;
        if (bestScore === 1.0) break; // Kusursuz normalize eşleşme
      }
    }

    if (bestScore >= minConfidence && bestStartLine !== -1) {
      // Satır indislerini orijinal metindeki indekslere dönüştür
      const lines = sourceText.split(/\r?\n/);
      let charCount = 0;
      for (let i = 0; i < bestStartLine; i++) {
        charCount += (lines[i]?.length ?? 0) + 1; // +1 satır sonu
      }
      const matchedLines = lines.slice(bestStartLine, bestStartLine + windowSize);
      const matchedText = matchedLines.join(sourceText.includes('\r\n') ? '\r\n' : '\n');

      return {
        startIndex: charCount,
        endIndex: charCount + matchedText.length,
        confidence: bestScore,
        matchedText
      };
    }

    return undefined;
  }

  /**
   * Hedef metni kaynak metinde bulur ve güvenli biçimde yerine yenisini koyar.
   */
  public static fuzzyReplace(
    sourceText: string,
    targetText: string,
    replacementText: string,
    minConfidence = 0.8
  ): { updatedContent: string; confidence: number; replacedText?: string } | undefined {
    const match = this.findFuzzy(sourceText, targetText, minConfidence);
    if (!match) return undefined;

    // Girintiyi koruma (isteğe bağlı): Eşleşen bloğun ilk satır girintisini algıla
    const matchedFirstLineIndent = match.matchedText.match(/^[ \t]*/)?.[0] ?? '';
    const targetFirstLineIndent = targetText.match(/^[ \t]*/)?.[0] ?? '';

    let adjustedReplacement = replacementText;
    if (
      matchedFirstLineIndent &&
      targetFirstLineIndent !== matchedFirstLineIndent &&
      !replacementText.startsWith(matchedFirstLineIndent)
    ) {
      // Model girintisiz yazdıysa orijinal girintiyi uygula
      const replLines = replacementText.split('\n');
      adjustedReplacement = replLines
        .map((line, idx) =>
          idx === 0 && line.startsWith(targetFirstLineIndent)
            ? matchedFirstLineIndent + line.slice(targetFirstLineIndent.length)
            : line
        )
        .join('\n');
    }

    const before = sourceText.slice(0, match.startIndex);
    const after = sourceText.slice(match.endIndex);
    const updatedContent = before + adjustedReplacement + after;

    return {
      updatedContent,
      confidence: match.confidence,
      replacedText: match.matchedText
    };
  }

  /**
   * SEARCH / REPLACE bloklarını ayrıştırır (Aider / Cursor formatı).
   */
  public static parseSearchReplaceBlocks(diffText: string): FastApplyChunk[] {
    const chunks: FastApplyChunk[] = [];
    const blockRegex = /<{5,}\s*SEARCH\s*\n([\s\S]*?)\n={5,}\s*\n([\s\S]*?)\n>{5,}\s*REPLACE/g;

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(diffText)) !== null) {
      chunks.push({
        search: match[1] ?? '',
        replace: match[2] ?? ''
      });
    }

    return chunks;
  }

  /**
   * Unified diff metnini ayrıştırıp chunk listesine dönüştürür.
   */
  public static parseUnifiedDiffChunks(diffText: string): FastApplyChunk[] {
    const chunks: FastApplyChunk[] = [];
    const lines = diffText.split(/\r?\n/);
    let currentSearch: string[] = [];
    let currentReplace: string[] = [];
    let inHunk = false;
    let startLineHint: number | undefined;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        if (inHunk && (currentSearch.length > 0 || currentReplace.length > 0)) {
          chunks.push({
            search: currentSearch.join('\n'),
            replace: currentReplace.join('\n'),
            startLineHint
          });
          currentSearch = [];
          currentReplace = [];
        }
        inHunk = true;
        const match = line.match(/@@ -(\d+)/);
        if (match) {
          startLineHint = parseInt(match[1] || '1', 10);
        }
      } else if (inHunk) {
        if (line.startsWith('-')) {
          currentSearch.push(line.slice(1));
        } else if (line.startsWith('+')) {
          currentReplace.push(line.slice(1));
        } else if (line.startsWith(' ') || line === '') {
          const content = line.startsWith(' ') ? line.slice(1) : line;
          currentSearch.push(content);
          currentReplace.push(content);
        }
      }
    }

    if (inHunk && (currentSearch.length > 0 || currentReplace.length > 0)) {
      chunks.push({
        search: currentSearch.join('\n'),
        replace: currentReplace.join('\n'),
        startLineHint
      });
    }

    return chunks;
  }

  /**
   * Verilen tüm değişiklik bloklarını (chunks) kaynak metne sırasıyla uygular.
   */
  public static applyChunks(
    sourceText: string,
    chunks: FastApplyChunk[],
    minConfidence = 0.8
  ): FastApplyResult {
    if (chunks.length === 0) {
      return {
        success: false,
        content: sourceText,
        appliedCount: 0,
        totalChunks: 0,
        confidence: 0,
        error: 'Uygulanacak geçerli diff veya SEARCH/REPLACE bloğu bulunamadı.'
      };
    }

    let currentContent = sourceText;
    let appliedCount = 0;
    let totalConfidence = 0;

    for (const chunk of chunks) {
      if (!chunk.search.trim()) {
        continue;
      }

      const res = this.fuzzyReplace(currentContent, chunk.search, chunk.replace, minConfidence);
      if (res) {
        currentContent = res.updatedContent;
        appliedCount++;
        totalConfidence += res.confidence;
      }
    }

    const avgConfidence = appliedCount > 0 ? totalConfidence / appliedCount : 0;
    const success = appliedCount > 0;

    return {
      success,
      content: currentContent,
      appliedCount,
      totalChunks: chunks.length,
      confidence: avgConfidence,
      diffSummary: `${appliedCount}/${chunks.length} blok başarıyla uygulandı (güven: %${Math.round(avgConfidence * 100)})`
    };
  }

  /**
   * Serbest formatlı diff metnini (Unified diff veya SEARCH/REPLACE) otomatik algılayıp uygular.
   */
  public static applyDiff(sourceText: string, diffText: string, minConfidence = 0.8): FastApplyResult {
    // 1. SEARCH/REPLACE blokları dene
    let chunks = this.parseSearchReplaceBlocks(diffText);

    // 2. Bulunamazsa Unified Diff hunk'larını dene
    if (chunks.length === 0) {
      chunks = this.parseUnifiedDiffChunks(diffText);
    }

    return this.applyChunks(sourceText, chunks, minConfidence);
  }
}
