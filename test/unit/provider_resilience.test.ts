import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import {
  OpenAICompatibleProvider,
  DailyTokenLimitError,
  StreamInterruptedError
} from '@evren-kod/core/providers/openai';

/**
 * Adım Altı — sağlayıcı dayanıklılık matrisi.
 *
 * Her satır gerçek bir arıza modunu sınar: hız sınırı + Retry-After, sonsuz
 * 429 döngüsü, geçici 5xx, günlük kota, akışta taşıma hatası, takılma,
 * kullanıcı iptali, [DONE] GÖRMEDEN kapanan akış (yarım yanıtı başarılı
 * sayma = yanlış başarı, INVARIANTS 8) ve bozuk tool-call argümanları.
 * Ağ yok: fetch, hatalı akışları üretebilen sahte gövdelerle değiştirilir.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(config: { stallTimeoutMs?: number; timeoutMs?: number } = {}) {
  return new OpenAICompatibleProvider({
    id: 'test',
    name: 'Test Provider',
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    ...config
  });
}

const encoder = new TextEncoder();

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function sseResponse(lines: string[]) {
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

/** Akışı kontrol altında tutan gövde: parça ver, hata ver ya da sessizce kapat. */
function scriptedSse(opts: {
  events: string[];
  /** 'error' hata verir; 'close' [DONE] görmeden kapatır. */
  tail?: 'error' | 'close';
  errorMessage?: string;
}) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of opts.events) {
          controller.enqueue(encoder.encode(`${event}\n`));
        }
        if (opts.tail === 'error') {
          controller.error(new Error(opts.errorMessage ?? 'ECONNRESET'));
        } else if (opts.tail === 'close') {
          controller.close();
        }
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

/** fetch stub'u: init.signal'i akışın hatalanmasına bağlar (gerçek fetch'in yaptığı gibi). */
function stubFetchWithAbortableStream(events: string[]) {
  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(`${event}\n`));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('socket hang up')));
        }
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }) as typeof fetch;
}

const textEvent = (t: string) => `data: {"choices":[{"delta":{"content":"${t}"}}]}`;
const DONE = 'data: [DONE]';
const stream = (cb?: (c: string) => void) => (cb ?? (() => {})) as (c: string) => void;

describe('Dayanıklılık: hız sınırı ve geri çekilme', () => {
  it('Retry-After başlığına uyar: ikinci deneme başlık kadar bekler', async () => {
    let calls = 0;
    const started = Date.now();
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: 'rate limited' }, 429, { 'Retry-After': '1' });
      return jsonResponse({ choices: [{ message: { content: 'tamam' } }] });
    }) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], []);
    assert.strictEqual(res.text, 'tamam');
    assert.strictEqual(calls, 2);
    assert.ok(Date.now() - started >= 900, 'Retry-After: 1 yaklaşık 1 saniye bekletmeli');
  });

  it('kalıcı 429 sonsuz döngüye girmez: deneme sınırında dürüst hata verir', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ error: 'rate limited' }, 429, { 'Retry-After': '0' });
    }) as typeof fetch;

    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'x' }], []),
      /API error \[429\]/
    );
    assert.strictEqual(calls, 3, 'deneme sayısı sınırlı olmalı (maxAttempts=3)');
  });

  it('geçici 5xx yeniden denenir ve sonra başarılı olur', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: 'overloaded' }, 503, { 'Retry-After': '0' });
      return jsonResponse({ choices: [{ message: { content: 'döndü' } }] });
    }) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], []);
    assert.strictEqual(res.text, 'döndü');
    assert.strictEqual(calls, 2);
  });

  it('günlük kota (429 + daily_token_limit_exceeded) yeniden denenmez, işaretli hata fırlatır', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse(
        {
          error: {
            code: 'daily_token_limit_exceeded',
            message: 'kota doldu',
            resets_at: '2026-11-08T00:00:00Z'
          }
        },
        429
      );
    }) as typeof fetch;

    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'x' }], []),
      (err: unknown) => {
        assert.ok(err instanceof DailyTokenLimitError);
        return true;
      }
    );
    assert.strictEqual(calls, 1, 'kota hatası backoff ile bekletmemeli');
  });
});

describe('Dayanıklılık: akış kesintileri', () => {
  it('taşıma hatası yarıda patlarsa hata YUTULMAZ, yukarı taşınır', async () => {
    globalThis.fetch = (async () =>
      scriptedSse({
        events: [textEvent('yarı')],
        tail: 'error',
        errorMessage: 'ECONNRESET'
      })) as typeof fetch;

    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'x' }], [], stream()),
      /ECONNRESET/
    );
  });

  it('takılan akış stall zaman aşımıyla kesilir ve tahmini kullanım taşır', async () => {
    stubFetchWithAbortableStream([textEvent('ilk')]);
    const stall = provider({ stallTimeoutMs: 60, timeoutMs: 5000 });
    await assert.rejects(
      () => stall.sendMessage([{ role: 'user', content: 'x' }], [], stream()),
      (err: unknown) => {
        assert.ok(err instanceof StreamInterruptedError, `StreamInterruptedError beklenirdi: ${String(err)}`);
        assert.match((err as Error).message, /stalled/i);
        assert.equal((err as StreamInterruptedError).usage.estimated, true);
        return true;
      }
    );
  });

  it('kullanıcı iptali StreamInterruptedError olarak muhasebeyle döner', async () => {
    stubFetchWithAbortableStream([textEvent('gelen')]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'x' }], [], stream(), controller.signal),
      (err: unknown) => {
        assert.match((err as Error).message, /cancelled by the user/i);
        if (err instanceof StreamInterruptedError) {
          assert.equal(err.usage.estimated, true);
        }
        return true;
      }
    );
  });

  it('[DONE] GÖRMEDEN kapanan akış BAŞARILI SAYILMAZ — yarım yanıt kesinti olarak bildirilir', async () => {
    // Bu, INVARIANTS 8'in sağlayıcı katmanı sınırıdır: kopan bağlantıdan
    // dönen yarım metin "tamamlandı" gibi raporlanamaz.
    globalThis.fetch = (async () =>
      scriptedSse({
        events: [textEvent('merhaba y'), textEvent('arı dunia')],
        tail: 'close'
      })) as typeof fetch;

    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'x' }], [], stream()),
      (err: unknown) => {
        assert.ok(err instanceof StreamInterruptedError);
        assert.match((err as Error).message, /before completion|DONE/i);
        const usage = (err as StreamInterruptedError).usage;
        assert.equal(usage.estimated, true, 'faturalanan token tahmini muhasebeye yazılmalı');
        assert.ok(usage.totalTokens > 0);
        return true;
      }
    );
  });

  it('[DONE] varsa aynı akış sorunsuz tamamlanır (regresyon bekçisi)', async () => {
    globalThis.fetch = (async () => sseResponse([textEvent('eksiksiz'), DONE])) as typeof fetch;
    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], [], stream());
    assert.strictEqual(res.text, 'eksiksiz');
  });
});

describe('Dayanıklılık: bozuk tool-call ve gürültü', () => {
  it('bozuk JSON argümanlar çökertmez: ham hâliyle taşınır ve araç hatası olur', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{bozuk json"}}]}}]}',
        DONE
      ])) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], [], stream());
    assert.strictEqual(res.toolCalls?.length, 1);
    assert.deepStrictEqual(res.toolCalls?.[0]?.arguments, { raw: '{bozuk json' });
  });

  it('isimsiz tool-call parçası hayalet çağrı üretmez', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"arguments":"{\\"a\\":1}"}}]}}]}',
        DONE
      ])) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], [], stream());
    assert.strictEqual(res.toolCalls, undefined);
  });

  it('akış ortasındaki bozuk/alan dışı SSE satırları metni bozmaz, yutulur', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        textEvent('ön'),
        'data: {bozuk json parçası',
        'data: {"choices":[],"note":"bilinmeyen alan"}',
        ': yorum satırı',
        textEvent('si'),
        textEvent(''),
        'data: {"choices":[{"delta":{"content":""}}]}',
        textEvent('zer'),
        DONE
      ])) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], [], stream());
    assert.strictEqual(res.text, 'önsizer', 'gürültü satırları arada yutulmalı, parçalar birleşmeli');
  });

  it('ad ve argüman çok parçalı akışta doğru birleşir (üç parça + kullanım)', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"fetch","arguments":"{\\"url"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":\\"https://a.test\\"}"}}]}}]}',
        'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
        DONE
      ])) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'x' }], [], stream());
    assert.strictEqual(res.toolCalls?.[0]?.name, 'web_fetch');
    assert.deepStrictEqual(res.toolCalls?.[0]?.arguments, { url: 'https://a.test' });
    assert.strictEqual(res.usage?.totalTokens, 5);
  });
});
