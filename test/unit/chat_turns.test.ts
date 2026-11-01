import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { ScriptedProvider, createAgent, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Sohbet turu sözleşmeleri:
 * 1. Düzenleme, istemi ikinci kez eklemek yerine o turdan sonrasını atar.
 * 2. Bir kullanıcı istemi ve tüm asistan adımları aynı `turnId`'yi taşır;
 *    arayüz bunları tek yanıt bloğunda toplar.
 */
const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-chat-turns-');

describe('Sohbet turları: düzenleme ve gruplama', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('düzenleme eski turu atar ve istemi yalnızca bir kez ekler', async () => {
    const root = await workspace();
    const { core } = createAgent(
      new ScriptedProvider([{ text: 'ilk yanıt' }, { text: 'ikinci yanıt' }, { text: 'düzeltilmiş yanıt' }]),
      root
    );

    await core.handleSendMessage('ilk istem');
    await core.handleSendMessage('ikinci istem');

    const firstUser = core.getState().messages.find((message) => message.content === 'ilk istem');
    assert.ok(firstUser, 'ilk istem kaydedilmeli');

    await core.editMessage(firstUser.id, 'düzeltilmiş istem');

    const messages = core.getState().messages;
    const userMessages = messages.filter((message) => message.role === 'user');

    assert.deepStrictEqual(
      userMessages.map((message) => message.content),
      ['düzeltilmiş istem'],
      'düzenleme sonrası yalnızca düzeltilmiş istem kalmalı'
    );
    assert.equal(
      messages.some((message) => message.content === 'ikinci istem'),
      false,
      'düzenlenen turdan sonraki mesajlar atılmalı'
    );
    assert.equal(
      messages.filter((message) => message.role === 'assistant').at(-1)?.content,
      'düzeltilmiş yanıt'
    );
  });

  it('kullanıcı istemi ve asistan yanıtları aynı turn kimliğini paylaşır', async () => {
    const root = await workspace();
    const { core } = createAgent(new ScriptedProvider([{ text: 'yanıt' }]), root);

    await core.handleSendMessage('görev');

    const messages = core.getState().messages;
    const user = messages.find((message) => message.role === 'user');
    assert.ok(user?.turnId, 'kullanıcı mesajı tur kimliği taşımalı');

    const assistants = messages.filter((message) => message.role === 'assistant');
    assert.ok(assistants.length > 0);
    for (const message of assistants) {
      assert.equal(message.turnId, user.turnId, 'asistan adımları aynı tura bağlanmalı');
    }
  });

  it('yeni sohbet açıkken çalışan görevi durdurur', async () => {
    const root = await workspace();
    const { core } = createAgent(new ScriptedProvider([{ text: 'yanıt' }]), root);

    await core.handleSendMessage('görev');
    await core.createNewSession();

    assert.equal(core.getState().messages.length, 0, 'yeni sohbet mesajları temizler');
    assert.equal(core.getState().status, 'idle');
  });
});
