import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  TeamCoordinationServer,
  CoordinationMessage
} from '@evren-kod/core/core/team/TeamCoordinationServer';

describe('TeamCoordinationServer: dağıtık ekip koordinasyonu', () => {
  it('oturum ve varlık bildirimlerini doğru işler', () => {
    const server = new TeamCoordinationServer();

    const joinResult = server.handleMessage({
      type: 'presence_join',
      sessionId: 'sess-1',
      userName: 'Ahmet',
      filePath: 'src/app.ts',
      timestamp: Date.now()
    });

    assert.strictEqual(joinResult.success, true);
    assert.strictEqual(server.getSessionCount(), 1);

    const leaveResult = server.handleMessage({
      type: 'presence_leave',
      sessionId: 'sess-1',
      userName: 'Ahmet',
      timestamp: Date.now()
    });

    assert.strictEqual(leaveResult.success, true);
    assert.strictEqual(server.getSessionCount(), 0);
  });

  it('çakışan dosya kilitlerini engeller ve uyarı üretir', () => {
    const server = new TeamCoordinationServer(10_000);
    const alerts: CoordinationMessage[] = [];

    server.addListener((msg) => {
      if (msg.type === 'conflict_alert') alerts.push(msg);
    });

    // İlk kullanıcı kilit alır
    const lock1 = server.handleMessage({
      type: 'lock_acquire',
      sessionId: 'sess-1',
      userName: 'Geliştirici A',
      filePath: 'src/core/auth.ts',
      timestamp: Date.now()
    });
    assert.strictEqual(lock1.success, true);
    assert.strictEqual(server.getLockCount(), 1);

    // İkinci kullanıcı aynı dosyayı kilitlemeye çalışır
    const lock2 = server.handleMessage({
      type: 'lock_acquire',
      sessionId: 'sess-2',
      userName: 'Geliştirici B',
      filePath: 'src/core/auth.ts',
      timestamp: Date.now()
    });

    assert.strictEqual(lock2.success, false);
    assert.match(lock2.error || '', /Geliştirici A tarafından kilitli/);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0]?.filePath, 'src/core/auth.ts');

    // İlk kullanıcı kilidi bırakınca ikinci kullanıcı alabilir
    server.handleMessage({
      type: 'lock_release',
      sessionId: 'sess-1',
      userName: 'Geliştirici A',
      filePath: 'src/core/auth.ts',
      timestamp: Date.now()
    });

    const lock3 = server.handleMessage({
      type: 'lock_acquire',
      sessionId: 'sess-2',
      userName: 'Geliştirici B',
      filePath: 'src/core/auth.ts',
      timestamp: Date.now()
    });
    assert.strictEqual(lock3.success, true);
  });
});
