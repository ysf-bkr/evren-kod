import { ChatMessage, CheckpointSummary } from '@shared/types';

/** Sohbetin tek bir turu: bir kullanıcı istemi ve ona ait tüm asistan adımları. */
export interface ChatTurn {
  id: string;
  user?: ChatMessage;
  assistant: ChatMessage[];
}

/**
 * Mesajları turlara böler.
 *
 * Bir tur, kullanıcı istemiyle başlar ve sonraki kullanıcı istemine kadar
 * süren tüm asistan/sistem mesajlarını kapsar. Yeni kayıtlarda `turnId`
 * doğrudan kullanılır; eski kayıtlarda kullanıcı mesajı sınır kabul edilir.
 */
export function groupMessages(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (const message of messages) {
    const current = turns[turns.length - 1];
    const startsTurn =
      message.role === 'user' || !current || (message.turnId !== undefined && current.id !== message.turnId);

    if (startsTurn) {
      turns.push({
        id: message.turnId ?? message.id,
        user: message.role === 'user' ? message : undefined,
        assistant: message.role === 'user' ? [] : [message]
      });
      continue;
    }

    current.assistant.push(message);
  }

  return turns;
}

/** Markdown işaretlerini sıyırıp akordeon başlığı için tek satırlık özet üretir. */
export function summarizeTurn(turn: ChatTurn): string {
  const withContent = [...turn.assistant].reverse().find((message) => message.content.trim());
  if (withContent) {
    const line = withContent.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`~|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) return line.length > 110 ? `${line.slice(0, 110)}…` : line;
  }

  const toolCount = turn.assistant.reduce((total, message) => total + (message.toolCalls?.length ?? 0), 0);
  if (toolCount > 0) return `${toolCount} araç adımı çalıştırıldı`;
  return 'Yanıt';
}

/**
 * Bu mesajın başladığı turda alınan checkpoint.
 *
 * Checkpoint önizlemesi kullanıcı mesajının ilk 40 karakteridir; bu yüzden
 * önizlemesi eşleşen en eski checkpoint bu mesaja aittir. Oraya geri sarmak,
 * mesaj gönderildikten sonra ajanın yaptığı her şeyi geri alır.
 */
export function findCheckpointForMessage(
  message: ChatMessage,
  checkpoints?: CheckpointSummary[]
): CheckpointSummary | undefined {
  if (!checkpoints || checkpoints.length === 0) return undefined;
  const preview = message.content.slice(0, 40);
  if (!preview.trim()) return undefined;
  return checkpoints
    .filter(
      (checkpoint) => checkpoint.preview === preview && checkpoint.timestamp >= message.timestamp - 1000
    )
    .sort((a, b) => a.timestamp - b.timestamp)[0];
}
