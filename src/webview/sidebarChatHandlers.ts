import { isChatConfigured } from '@evren-kod/core/shared/constants';
import type { WebviewMessageHandlerMap, SidebarHandlerContext } from './sidebarMessageHandlers';

/** SEND_MESSAGE, EDIT_MESSAGE, USER_REPLY, SET_MODE handler'larını döner. */
export function createChatHandlers(
  ctx: SidebarHandlerContext
): Pick<WebviewMessageHandlerMap, 'SEND_MESSAGE' | 'EDIT_MESSAGE' | 'USER_REPLY' | 'SET_MODE'> {
  return {
    SEND_MESSAGE: async (message) => {
      const settings = ctx.getSettings();
      if (!isChatConfigured(settings)) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: 'warning',
            message:
              'Sohbeti başlatmak için lütfen önce Ayarlar bölümünden bir model sağlayıcısı yapılandırın.'
          }
        });
        return;
      }
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.handleSendMessage(message.payload.text, message.payload.mode);
      }
    },

    EDIT_MESSAGE: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        if (message.payload.mode) {
          agentCore.setMode(message.payload.mode);
        }
        await agentCore.editMessage(message.payload.messageId, message.payload.text);
      }
    },

    USER_REPLY: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.provideUserReply(message.payload.reply);
      }
    },

    SET_MODE: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        agentCore.setMode(message.payload.mode);
      }
    }
  };
}
