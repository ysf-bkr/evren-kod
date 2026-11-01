import type { WebviewMessageHandlerMap, SidebarHandlerContext } from './sidebarMessageHandlers';

type ToolHandlerKeys = 'APPROVE_TOOL' | 'APPROVE_SPEC' | 'APPROVE_PLAN' | 'REJECT_APPROVAL' | 'REJECT_TOOL';

/** Araç onay/red handler'larını döner. */
export function createToolHandlers(
  ctx: SidebarHandlerContext
): Pick<WebviewMessageHandlerMap, ToolHandlerKeys> {
  return {
    APPROVE_TOOL: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.approveTool(message.payload.toolCallId);
      }
    },

    APPROVE_SPEC: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.approveSpec();
      }
    },

    APPROVE_PLAN: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.approvePlan();
      }
    },

    REJECT_APPROVAL: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.rejectApproval(message.payload?.reason);
      }
    },

    REJECT_TOOL: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.rejectTool(message.payload.toolCallId, message.payload.reason);
      }
    }
  };
}
