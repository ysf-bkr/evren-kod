/**
 * Yayın kapısı aracı.
 *
 * Araç incedir: kararı kaydeder, gerçek denetimi konak tarafındaki port
 * yapar. "pass" beyanı kriterler işaretli değilse ya da doğrulama taze
 * geçmemişse makine tarafından BLOCK'a çevrilir — modelin iyimserliği
 * kapıyı açamaz.
 */
import { ToolDefinition } from './base';
import { argString } from './args';

export const recordReleaseGateTool: ToolDefinition = {
  name: 'record_release_gate',
  description:
    'Records the final release gate verdict for the current spec. Call this as the last audit step (preferably as the independent @release-gate specialist): walk every acceptance criterion with the scenario that proved it, list known risks and the rollback path. A PASS verdict is only stored when every criterion is checked and verification freshly passed; otherwise the machine records BLOCK with the reasons. Any file change after a PASS invalidates the verdict.',
  parameters: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['pass', 'block'],
        description: 'Your gate decision: "pass" only if every criterion has fresh evidence.'
      },
      reasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Why this verdict; for BLOCK, each blocker as one entry.'
      },
      criteria: {
        type: 'array',
        description:
          'One entry per acceptance criterion id (format "ac-1") with the scenario that proved it.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Criterion id, for example "ac-1".' },
            note: {
              type: 'string',
              description: 'Evidence: which scenario/command proved it and with what result.'
            }
          },
          required: ['id', 'note']
        }
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Known residual risks; an explicit short list, never "none" as a shrug.'
      },
      rollback: {
        type: 'string',
        description: 'One sentence: how to undo this change if it misbehaves in production.'
      }
    },
    required: ['verdict', 'reasons', 'criteria', 'rollback']
  },
  execute: async (args, context) => {
    if (!context.releaseGate) {
      throw new Error('Release gate service is not ready (no active workflow).');
    }
    const verdict = argString(args.verdict).toLowerCase() === 'pass' ? 'pass' : 'block';
    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((item) => argString(item)).filter(Boolean) : [];
    const rawCriteria = Array.isArray(args.criteria) ? args.criteria : [];
    const criteriaEvidence = rawCriteria
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return { id: argString(record.id), note: argString(record.note) };
      })
      .filter((item) => item.id && item.note);
    return context.releaseGate.record({
      verdict,
      reasons: toStringArray(args.reasons),
      criteriaEvidence,
      risks: toStringArray(args.risks),
      rollback: argString(args.rollback)
    });
  }
};
