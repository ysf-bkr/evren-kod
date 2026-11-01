import React from 'react';
import { Check, FileDiff } from 'lucide-react';
import { Button } from '../ui';
import { vscode } from '../../utils/vscode';

interface ApprovalActionButtonsProps {
  toolCallId: string;
  /** Yalnızca yazma/düzenleme araçları fark önizlemesi açar. */
  showDiff?: boolean;
  /** Bildirim şeridi ghost, adım kartı secondary ton kullanır. */
  diffVariant?: 'secondary' | 'ghost';
}

/**
 * Araç onay üçlüsü: Farkı Gör + Reddet + Onayla. Adım kartı ile sabit
 * bildirim şeridi aynı düğmeleri gönderir; davranış iki yerde ayrı ayrı
 * bakım görmesin diye burada yaşar.
 */
export const ApprovalActionButtons: React.FC<ApprovalActionButtonsProps> = ({
  toolCallId,
  showDiff = false,
  diffVariant = 'secondary'
}) => (
  <>
    {showDiff && (
      <Button
        size="xs"
        variant={diffVariant}
        onClick={() => vscode.postMessage({ type: 'PREVIEW_TOOL_DIFF', payload: { toolCallId } })}
        icon={<FileDiff className="evren-kod-icon-xs" />}
        title="Önerilen değişikliği fark (diff) görünümünde incele"
      >
        Farkı Gör
      </Button>
    )}
    <Button
      size="xs"
      variant="secondary"
      onClick={() => vscode.postMessage({ type: 'REJECT_TOOL', payload: { toolCallId } })}
    >
      Reddet
    </Button>
    <Button
      size="xs"
      variant="primary"
      onClick={() => vscode.postMessage({ type: 'APPROVE_TOOL', payload: { toolCallId } })}
      icon={<Check className="evren-kod-icon-xs" />}
    >
      Onayla
    </Button>
  </>
);
