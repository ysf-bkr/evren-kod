import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectActiveTeam, formatTeamContext, DEFAULT_TEAM_BUDGET } from '@evren-kod/core/shared/agents/team';

describe('Aktif ekip seçimi', () => {
  test('tam yığın ekibi: çekirdek + tür şemsiyeleri + stack uzmanları', () => {
    const { team } = selectActiveTeam({
      kinds: ['fullstack'],
      stacks: ['react', 'nextjs', 'typescript', 'postgres', 'prisma', 'docker']
    });
    const names = team.map((agent) => agent.name);
    // Çekirdek gözetmenler daima var.
    for (const core of ['manager', 'analyst', 'architect', 'quality', 'security']) {
      assert.ok(names.includes(core), `${core} ekipte olmalı`);
    }
    // fullstack şemsiyeleri.
    for (const umbrella of ['frontend', 'backend', 'database']) {
      assert.ok(names.includes(umbrella), `${umbrella} ekipte olmalı`);
    }
    // Stack eşleşen uzmanlar öne alınır.
    assert.ok(names.includes('react-developer'), 'react uzmanı seçilmeli');
    assert.ok(names.includes('sql-specialist'), 'stack eşleşen veritabanı uzmanı seçilmeli');
  });

  test('mobil profil masaüstü uzmanlarını ekibe almaz', () => {
    const { team } = selectActiveTeam({ kinds: ['mobile'], stacks: ['kotlin', 'android'] });
    const names = team.map((agent) => agent.name);
    assert.ok(names.includes('mobile'));
    assert.ok(names.includes('android-developer'));
    assert.ok(!names.includes('electron-developer'));
    assert.ok(!names.includes('qt-developer'));
  });

  test('bilinmeyen profil yalnızca çekirdek gözetmenlerle kalır', () => {
    const { team } = selectActiveTeam({ kinds: ['unknown'], stacks: [] });
    const names = team.map((agent) => agent.name);
    assert.ok(names.includes('manager'));
    assert.ok(names.includes('explorer'));
    // Uzman kalabalığı yok: sadece gözetmen omurga.
    assert.ok(
      names.every((name) =>
        ['manager', 'analyst', 'architect', 'explorer', 'quality', 'security', 'git'].includes(name)
      )
    );
  });

  test('bütçe uzmanları budar ama çekirdek ve şemsiye roller asla düşmez', () => {
    const { team } = selectActiveTeam(
      {
        kinds: ['fullstack'],
        stacks: [
          'react',
          'vue',
          'angular',
          'svelte',
          'django',
          'fastapi',
          'spring',
          'laravel',
          'go',
          'dotnet'
        ]
      },
      9
    );
    // Sözleşme: bütçe yalnızca uzman kontenjanını sınırlar; 7 çekirdek + 3
    // fullstack şemsiyesi bütçeden bağımsız içeridedir.
    const names = team.map((agent) => agent.name);
    for (const core of ['manager', 'quality', 'security', 'frontend', 'backend', 'database']) {
      assert.ok(names.includes(core), `${core} bütçe dolsa da kalmalı`);
    }
    const specialists = names.filter(
      (name) =>
        ![
          'manager',
          'analyst',
          'architect',
          'explorer',
          'quality',
          'security',
          'git',
          'frontend',
          'backend',
          'database'
        ].includes(name)
    );
    assert.ok(specialists.length <= 9, `uzman kontenjanı aşıldı: ${specialists.length}`);
  });

  test('seçim deterministiktir: aynı profil aynı ekibi üretir', () => {
    const input = { kinds: ['fullstack'] as const, stacks: ['react', 'docker', 'redis'] as const };
    const a = selectActiveTeam(input);
    const b = selectActiveTeam(input);
    assert.deepEqual(
      a.team.map((agent) => agent.name),
      b.team.map((agent) => agent.name)
    );
  });

  test('prompt bloğu yalnızca seçilen ekibi listeler ve Türkçe gerekçeler taşınabilir', () => {
    const selection = selectActiveTeam({ kinds: ['web-backend'], stacks: ['go'] });
    const text = formatTeamContext(selection, { kinds: ['web-backend'], stacks: ['go'] });
    assert.match(text, /ACTIVE SPECIALIST TEAM/);
    assert.match(text, /@backend/);
    assert.match(text, /@go-developer/);
    // Ekipte olmayan uzman prompt'a sızmaz.
    assert.ok(!text.includes('@flutter-developer'));
    // Gerekçeler Türkçe ve dolu.
    const reason = selection.reasons['go-developer'];
    assert.ok(reason && reason.length > 0);
  });

  test('varsayılan bütçe katalog büyüklüğünden küçüktür', () => {
    assert.ok(DEFAULT_TEAM_BUDGET <= 16, 'ekip bütçesi token disiplini için küçük kalmalı');
  });
});
