/**
 * "lsp" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import { ToolDefinition, ToolExecutionContext } from '@evren-kod/core/tools/base';
import { argString } from '@evren-kod/core/tools/args';
import type { LspPort } from '@evren-kod/core/tools/contracts';

/** Ortak ön koşul: LSP istemcisi hazır olmalı. */
function requireClient(ctx: ToolExecutionContext): LspPort {
  if (!ctx.lspClient) {
    throw new Error('LSP client is not ready.');
  }
  return ctx.lspClient;
}

/** 1 tabanlı satır/sütun argümanlarının ortak ayrıştırması. */
function positionFrom(args: Record<string, unknown>): { line: number; character: number } {
  return {
    line: parseInt(String(args.line), 10) || 1,
    character: parseInt(String(args.character || 1), 10) || 1
  };
}

/** Konum tabanlı araçların (definition/hover/references) ortak parametre şeması. */
const positionParameters: ToolDefinition['parameters'] = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path.' },
    line: { type: 'string', description: 'Line number (1-based).' },
    character: { type: 'string', description: 'Column number (1-based).' }
  },
  required: ['path', 'line']
};

export const getDiagnosticsTool: ToolDefinition = {
  name: 'get_diagnostics',
  description:
    'Lists compiler (TypeScript, ESLint, Python, etc.) and linter errors/warnings (LSP diagnostics) in the project or a specific file. Use this to verify there are no errors after code changes.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the file to check (leave empty to scan the entire open project).'
      },
      minSeverity: {
        type: 'string',
        enum: ['error', 'warning'],
        description:
          'Minimum severity: "error" (only compile/type errors) or "warning" (includes all warnings).'
      }
    },
    required: []
  },
  execute: async (args, ctx) => {
    const client = requireClient(ctx);
    return client.getDiagnostics(
      ctx.workspaceRoot,
      argString(args.path),
      args.minSeverity === 'error' ? 'error' : 'warning'
    );
  }
};

export const getDefinitionTool: ToolDefinition = {
  name: 'get_definition',
  description:
    'Goes directly to the definition of a symbol (function, class, variable) at the specified file and line (Go to Definition).',
  parameters: positionParameters,
  execute: async (args, ctx) => {
    const client = requireClient(ctx);
    const { line, character } = positionFrom(args);
    return client.getDefinition(argString(args.path), line, character, ctx.workspaceRoot);
  }
};

export const getHoverTool: ToolDefinition = {
  name: 'get_hover',
  description:
    'Gets type information or documentation for the symbol at the specified file and line (Hover).',
  parameters: positionParameters,
  execute: async (args, ctx) => {
    const client = requireClient(ctx);
    const { line, character } = positionFrom(args);
    return client.getHover(argString(args.path), line, character, ctx.workspaceRoot);
  }
};

export const getReferencesTool: ToolDefinition = {
  name: 'get_references',
  description: 'Finds all references to the symbol at the specified file/line/column through LSP.',
  parameters: positionParameters,
  execute: async (args, ctx) => {
    const client = requireClient(ctx);
    const { line, character } = positionFrom(args);
    return client.getReferences(argString(args.path), line, character, ctx.workspaceRoot);
  }
};

export const getWorkspaceSymbolsTool: ToolDefinition = {
  name: 'get_workspace_symbols',
  description: 'Searches for symbols in the workspace using the LSP workspace symbol provider.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol name or partial name.' }
    },
    required: ['query']
  },
  execute: async (args, ctx) => {
    if (!ctx.lspClient) throw new Error('LSP client is not ready.');
    return ctx.lspClient.getWorkspaceSymbols(argString(args.query), ctx.workspaceRoot);
  }
};
