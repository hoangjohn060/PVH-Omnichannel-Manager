import { parentPort, workerData } from 'node:worker_threads';
import { Zalo, LoginQRCallbackEventType, type API, type Credentials } from 'zca-js';
import type { WorkerCommand, WorkerEvent } from '../zalo/protocol';
import { classifyError } from '../zalo/state';
import { normalizeMessage, pngDataUrl, sentMessageId } from '../zalo/mapping';
import { fetchAvatarData } from '../zalo/avatar';
import type { ZaloMessage } from '@pvh/shared/types';

const port = parentPort!;
const { accountId } = workerData as { accountId: string };
const emit = (event: WorkerEvent): void => port.postMessage(event);
let api: API | undefined;
let credentials: Credentials | undefined;
let abort: (() => unknown) | undefined;
let stopped = false;
let started = false;
let incoming: ZaloMessage[] = [];
let batchTimer: NodeJS.Timeout | undefined;
function flushMessages(): void {
  clearTimeout(batchTimer); batchTimer = undefined;
  if (incoming.length) { emit({ type: 'messages', messages: incoming }); incoming = []; }
}
function enqueueMessage(message: ZaloMessage): void {
  incoming.push(message);
  if (incoming.length >= 100) flushMessages();
  else batchTimer ??= setTimeout(flushMessages, 25);
}
let sessionSaved: (() => void) | undefined;
const saved = new Promise<void>(resolve => { sessionSaved = resolve; });
let identitySaved:(()=>void)|undefined;
const identityReady=new Promise<void>(resolve=>{identitySaved=resolve;});
// No synthetic fingerprint/proxy customization. Use the SDK's own QR flow.
const sdk = new Zalo({ selfListen: true, checkUpdate: false, logging: false,
  polyfill: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }),
});
function persist(): void {
  if (api && credentials) { credentials = { ...credentials, cookie: api.getCookie().toJSON()!.cookies }; emit({ type: 'session', credentials }); }
}
async function connect(command: Extract<WorkerCommand, { type: 'qr' | 'restore' }>): Promise<void> {
  if (started) return;
  started = true;
  try {
    if (command.type === 'restore') { credentials = command.credentials; api = await sdk.login(credentials); }
    else {
      api = await sdk.loginQR({ language: 'vi' }, event => {
        if (stopped) { event.actions?.abort(); return; }
        if (event.actions) abort = event.actions.abort;
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: emit({ type: 'qr', image: pngDataUrl(event.data.image) }); break;
          case LoginQRCallbackEventType.QRCodeScanned:
            emit({ type: 'profile', displayName: event.data.display_name, avatar: event.data.avatar }); emit({ type: 'state', event: 'scan' }); break;
          case LoginQRCallbackEventType.QRCodeExpired:
            emit({ type: 'state', event: 'expired' }); event.actions.abort(); break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            emit({ type: 'failure', code: 'QR_DECLINED', expired: false, retryable: false }); event.actions.abort(); break;
          case LoginQRCallbackEventType.GotLoginInfo:
            credentials = { ...event.data, language: 'vi' }; emit({ type: 'state', event: 'credentials' }); break;
        }
      });
    }
    if (stopped) { api.listener.stop(); return; }
    persist();
    await saved; // Never announce connected until DPAPI session persistence succeeds in main.
    if (stopped) return;
    emit({ type: 'identity', uid: api.getOwnId() });
    await identityReady; // Gateway binds the real UID uniquely before listener.start().
    if(stopped)return;
    try {
      const info = await api.fetchAccountInfo();
      emit({ type: 'profile', displayName: info.profile.displayName, avatar: await fetchAvatarData(info.profile.avatar) ?? '' });
    } catch { /* QR-scanned identity is retained; do not fabricate profile data. */ }
    api.listener.on('message', raw => { try { enqueueMessage(normalizeMessage(accountId, raw)); } catch { emit({ type: 'failure', code: 'MESSAGE_NORMALIZE_FAILED', expired: false, retryable: false }); } });
    api.listener.on('delivered_messages', messages => emit({ type: 'delivery', messageIds: messages.map(message => String(message.data.msgId)), status: 'DELIVERED' }));
    api.listener.on('seen_messages', messages => emit({ type: 'delivery', messageIds: messages.map(message => String(message.data.msgId)), status: 'SEEN' }));
    api.listener.on('connected', () => emit({ type: 'state', event: 'connected' }));
    api.listener.on('error', () => { /* closed/timeout controls reconnect; never log raw SDK payload. */ });
    api.listener.on('closed', code => {
      if (stopped) return;
      emit({ type: 'failure', code: code === 3000 ? 'DUPLICATE_LISTENER' : code === 3003 ? 'SESSION_KICKED' : 'LISTENER_CLOSED', expired: code === 3003, retryable: code !== 3000 && code !== 3003 });
    });
    api.listener.start({ retryOnClose: false });
  } catch (error) {
    if (!stopped) { const code = classifyError(error); emit({ type: 'failure', code, expired: code === 'AUTH_EXPIRED', retryable: code === 'NETWORK' }); }
  }
}
port.on('message', (command: WorkerCommand) => {
  if(command.type==='identity-saved'){identitySaved?.();return;}
  if (command.type === 'session-saved') { sessionSaved?.(); return; }
  if (command.type === 'stop') { stopped = true; flushMessages(); abort?.(); if (api) { persist(); api.listener.stop(); api.listener.removeAllListeners(); } emit({ type: 'stopped' }); return; }
  if (command.type === 'persist') { persist(); return; }
  if (command.type === 'send') {
    void (async () => {
      try { if (!api || stopped) throw new Error('NOT_CONNECTED'); const response = await api.sendMessage(command.input.text, command.input.threadId, command.input.threadType); emit({ type: 'sent', requestId: command.input.requestId, messageId: sentMessageId(response) }); }
      catch { emit({ type: 'send-failed', requestId: command.input.requestId, code: 'SEND_FAILED_OR_UNCONFIRMED' }); }
    })(); return;
  }
  void connect(command);
});