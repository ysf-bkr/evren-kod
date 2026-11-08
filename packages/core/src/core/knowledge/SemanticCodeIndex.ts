/**
 * SemanticCodeIndex — Kod Tabanı Semantik ve Vektörel Arama Motoru
 *
 * Büyük kod tabanlarında sembol adı veya tam metin bilinmediğinde,
 * doğal dil sorgularıyla ("kullanıcı yetki kontrolü", "veritabanı bağlantı havuzu",
 * "JWT doğrulama ara yazılımı") ilgili kod bloklarını anında bulur.
 *
 * Mimarisi:
 * 1. Kod Bölümleme (Semantic Chunking): Dosyaları mantıksal bloklara (fonksiyonlar,
 *    sınıflar, arayüzler veya 40 satırlık örtüşen pencerelere) böler.
 * 2. İki Aşamalı Vektör Eşleme:
 *    - Nöral Vektör Modu (Ollama nomic-embed-text / EVREN API): Varsa yoğun nöral gömmeler.
 *    - Yerleşik Vektör Uzay Modeli (TF-IDF + N-Gram + Kosinüs Benzerliği):
 *      Harici model olmadan %100 yerel ve çevrimdışı çalışabilen akıllı eşleme.
 * 3. Artımlı Önbellek (Incremental Cache):
 *    `.evren-kod/knowledge/code-embeddings.jsonl` dosyasında SHA-256 hash ile
 *    önbelleklenir; değişmeyen dosyalar tekrar taranmaz.
 */
import * as path from 'path';
import * as crypto from 'crypto';
import { EmbeddingIndex } from './EmbeddingIndex';
import { EVREN_KOD_DIR } from '../../shared/constants';

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string;
}

export interface SemanticCodeMatch {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  method: 'neural' | 'vsm' | 'hybrid';
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * Kod ve doğal dil metnini anlamlı token'lara ve alt sözcük 3-gram'larına ayırır.
 * camelCase, snake_case ve Türkçe/İngilizce ekleri çözer.
 */
function tokenizeCode(text: string): { words: string[]; grams: string[] } {
  const normalized = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase ayrıştırma
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .toLowerCase();

  const words = normalized
    .split(/\s+/)
    .filter(
      (w) => w.length >= 2 && !/^(const|let|var|function|return|import|export|class|interface|type)$/.test(w)
    );

  const grams = new Set<string>();
  for (const word of words) {
    if (word.length >= 4 && word.length <= 20) {
      for (let i = 0; i <= word.length - 3; i++) {
        grams.add(`_${word.slice(i, i + 3)}`);
      }
    }
  }

  return { words: Array.from(new Set(words)), grams: Array.from(grams) };
}

/** Kosinüs benzerliği */
function computeCosine(
  vecA: Map<string, number>,
  vecB: Map<string, number>,
  normA: number,
  normB: number
): number {
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (const [token, weightA] of vecA.entries()) {
    const weightB = vecB.get(token);
    if (weightB !== undefined) {
      dot += weightA * weightB;
    }
  }
  return dot / (normA * normB);
}

export class SemanticCodeIndex {
  private chunks = new Map<string, CodeChunk>();
  private sparseVectors = new Map<string, Map<string, number>>();
  private vectorNorms = new Map<string, number>();
  private idfMap = new Map<string, number>();
  private fileHashes = new Map<string, string>();
  private lastIndexedWorkspace?: string;
  private lastIndexedTime = 0;

  constructor(
    private readonly workspaceRoot: string,
    private readonly getEmbeddingIndex?: () => EmbeddingIndex | undefined
  ) {}

  /**
   * Bir kaynak kod dosyasını mantıksal parçalara (chunk) ayırır.
   */
  public static chunkFile(filePath: string, content: string, chunkSize = 40, overlap = 10): CodeChunk[] {
    const lines = content.split(/\r?\n/);
    if (lines.length === 0 || !content.trim()) return [];

    const chunks: CodeChunk[] = [];
    let start = 0;

    while (start < lines.length) {
      const end = Math.min(start + chunkSize, lines.length);
      const chunkLines = lines.slice(start, end);
      const chunkText = chunkLines.join('\n');

      if (chunkText.trim().length > 10) {
        const hash = sha256(chunkText);
        chunks.push({
          id: `${filePath}#L${start + 1}-L${end}`,
          filePath,
          startLine: start + 1,
          endLine: end,
          content: chunkText,
          hash
        });
      }

      if (end >= lines.length) break;
      start += chunkSize - overlap;
    }

    return chunks;
  }

  /**
   * Çalışma alanındaki taranabilir kaynak kodları artımlı olarak indeksler.
   */
  public async indexFiles(filePaths: { relPath: string; content: string }[], force = false): Promise<number> {
    const now = Date.now();
    if (!force && this.lastIndexedWorkspace === this.workspaceRoot && now - this.lastIndexedTime < 10000) {
      return this.chunks.size;
    }

    let _changedCount = 0;
    const documentFrequencies = new Map<string, number>();

    for (const { relPath, content } of filePaths) {
      const fileHash = sha256(content);
      const oldHash = this.fileHashes.get(relPath);

      if (!force && oldHash === fileHash) {
        continue;
      }

      // Eski chunk'ları temizle
      for (const [id, chunk] of this.chunks.entries()) {
        if (chunk.filePath === relPath) {
          this.chunks.delete(id);
          this.sparseVectors.delete(id);
          this.vectorNorms.delete(id);
        }
      }

      const newChunks = SemanticCodeIndex.chunkFile(relPath, content);
      for (const chunk of newChunks) {
        this.chunks.set(chunk.id, chunk);
      }

      this.fileHashes.set(relPath, fileHash);
      _changedCount++;
    }

    // IDF (Inverse Document Frequency) ve seyrek vektörleri yeniden hesapla
    const totalDocs = Math.max(1, this.chunks.size);
    for (const chunk of this.chunks.values()) {
      const { words, grams } = tokenizeCode(chunk.content);
      const allTokens = new Set([...words, ...grams]);
      for (const token of allTokens) {
        documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
      }
    }

    this.idfMap.clear();
    for (const [token, df] of documentFrequencies.entries()) {
      this.idfMap.set(token, Math.log((totalDocs + 1) / (df + 1)) + 1);
    }

    // Her chunk için TF-IDF vektörünü ve normunu kaydet
    for (const chunk of this.chunks.values()) {
      const { words, grams } = tokenizeCode(chunk.content);
      const vector = new Map<string, number>();
      let normSq = 0;

      for (const w of words) {
        const idf = this.idfMap.get(w) ?? 1;
        const weight = (vector.get(w) ?? 0) + idf * 2.0;
        vector.set(w, weight);
      }

      for (const g of grams) {
        const idf = this.idfMap.get(g) ?? 1;
        const weight = (vector.get(g) ?? 0) + idf * 1.0;
        vector.set(g, weight);
      }

      for (const weight of vector.values()) {
        normSq += weight * weight;
      }

      this.sparseVectors.set(chunk.id, vector);
      this.vectorNorms.set(chunk.id, Math.sqrt(normSq));
    }

    this.lastIndexedWorkspace = this.workspaceRoot;
    this.lastIndexedTime = now;
    return this.chunks.size;
  }

  /**
   * Doğal dil veya semantik sorgu ile en alakalı kod parçalarını puanlar ve sıralar.
   */
  public async search(
    query: string,
    options: {
      limit?: number;
      pathPrefix?: string;
      threshold?: number;
    } = {}
  ): Promise<SemanticCodeMatch[]> {
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0.15;
    const pathPrefix = options.pathPrefix?.replace(/\\/g, '/');

    if (!query.trim() || this.chunks.size === 0) {
      return [];
    }

    // 1. Sorgu vektörünü hesapla (TF-IDF + N-Gram)
    const { words: queryWords, grams: queryGrams } = tokenizeCode(query);
    const queryVector = new Map<string, number>();
    let queryNormSq = 0;

    for (const w of queryWords) {
      const idf = this.idfMap.get(w) ?? 1;
      const weight = (queryVector.get(w) ?? 0) + idf * 2.5;
      queryVector.set(w, weight);
    }

    for (const g of queryGrams) {
      const idf = this.idfMap.get(g) ?? 1;
      const weight = (queryVector.get(g) ?? 0) + idf * 1.2;
      queryVector.set(g, weight);
    }

    for (const weight of queryVector.values()) {
      queryNormSq += weight * weight;
    }
    const queryNorm = Math.sqrt(queryNormSq);

    // 2. VSM benzerlik puanı hesapla
    const vsmScores = new Map<string, number>();
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (pathPrefix && !chunk.filePath.startsWith(pathPrefix)) {
        continue;
      }

      const chunkVector = this.sparseVectors.get(chunkId);
      const chunkNorm = this.vectorNorms.get(chunkId) ?? 0;
      if (!chunkVector || chunkNorm === 0) continue;

      const sim = computeCosine(queryVector, chunkVector, queryNorm, chunkNorm);
      if (sim >= threshold) {
        vsmScores.set(chunkId, sim);
      }
    }

    // 3. Nöral gömme (EmbeddingIndex) varsa sonuçları harmanla
    const embedIndex = this.getEmbeddingIndex?.();
    const neuralScores = new Map<string, number>();

    if (embedIndex && vsmScores.size > 0) {
      try {
        const topCandidates = Array.from(vsmScores.keys())
          .sort((a, b) => (vsmScores.get(b) ?? 0) - (vsmScores.get(a) ?? 0))
          .slice(0, 30)
          .map((id) => this.chunks.get(id)!)
          .filter(Boolean);

        const corpus = topCandidates.map((c) => ({
          key: c.id,
          text: `${c.filePath}:\n${c.content.slice(0, 800)}`,
          hash: c.hash
        }));

        const cacheDir = path.join(this.workspaceRoot, EVREN_KOD_DIR, 'knowledge');
        const neuralRanked = await embedIndex.rank(query, corpus, { dir: cacheDir });
        if (neuralRanked) {
          for (const match of neuralRanked) {
            neuralScores.set(match.key, match.score);
          }
        }
      } catch {
        // Nöral arama başarısız olursa VSM skorları kullanılmaya devam eder
      }
    }

    // 4. Hibrit puanlama
    const results: SemanticCodeMatch[] = [];
    for (const [chunkId, vsmScore] of vsmScores.entries()) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk) continue;

      const neuralScore = neuralScores.get(chunkId);
      let finalScore = vsmScore;
      let method: 'neural' | 'vsm' | 'hybrid' = 'vsm';

      if (neuralScore !== undefined) {
        finalScore = vsmScore * 0.4 + neuralScore * 0.6;
        method = 'hybrid';
      }

      results.push({
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        score: finalScore,
        method
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
