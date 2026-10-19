import type { Message, SendMessageResponse } from 'zca-js';
import type { ZaloMessage } from '@pvh/shared/types';
export function pngDataUrl(image: string): string {
  const base64 = image.replace(/^data:image\/png;base64,/, '');
  if (base64.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('INVALID_QR_IMAGE');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('INVALID_QR_PNG');
  return `data:image/png;base64,${base64}`;
}
export function normalizeMessage(accountId: string, raw: Message): ZaloMessage {
  const data = raw.data;
  if (!data.msgId || !/^\d{1,30}$/.test(raw.threadId)) throw new Error('INVALID_MESSAGE_ID');
  const content = data.content;
  const object = typeof content === 'object' && content !== null ? content as Record<string, unknown> : null;
  const kind = typeof content === 'string' ? 'text' : /photo|image/i.test(data.msgType) ? 'image' : /file/i.test(data.msgType) ? 'file' : 'other';
  const timestamp = Number(data.ts);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('INVALID_MESSAGE_TIMESTAMP');
  return { platform: 'zalo', accountId, messageId: String(data.msgId), threadId: raw.threadId, threadType: raw.type,
    senderId: String(data.uidFrom), senderName: String(data.dName ?? ''), isSelf: raw.isSelf, agentId: null,
    text: typeof content === 'string' ? content : String(object?.title ?? object?.description ?? `[${data.msgType}]`),
    timestamp, kind, attachment: object ? { url: typeof object.href === 'string' && /^https:\/\//.test(object.href) ? object.href : null, name: typeof object.title === 'string' ? object.title : null } : null,
    status: raw.isSelf ? 'SENT' : 'RECEIVED',
  };
}
export function sentMessageId(response: SendMessageResponse): string {
  const id = response.message?.msgId;
  if (!id || !Number.isFinite(Number(id))) throw new Error('SEND_NO_MESSAGE_ID');
  return String(id);
}