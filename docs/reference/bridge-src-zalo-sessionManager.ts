import { ZaloApi, ZaloThreadKind, IncomingMessage, ReactionEvent, UndoEvent, QuoteSource, Sender } from "./types.js";

export class SessionManager {
  private sessions = new Map<number, ZaloApi>();
  private senders = new Map<number, Sender>();
  private onReaction?: (accountId: number, evt: ReactionEvent) => void;
  private onUndo?: (accountId: number, evt: UndoEvent) => void;

  constructor() {}

  /** Register app-level reaction/undo handlers, bound for every session on bindInbound. */
  registerEventHandlers(
    onReaction: (accountId: number, evt: ReactionEvent) => void,
    onUndo: (accountId: number, evt: UndoEvent) => void,
  ): void {
    this.onReaction = onReaction;
    this.onUndo = onUndo;
  }

  register(accountId: number, api: ZaloApi): void {
    this.sessions.set(accountId, api);
  }

  bindInbound(accountId: number, handler: (accountId: number, msg: IncomingMessage) => void): void {
    const api = this.require(accountId);
    api.onMessage((msg) => handler(accountId, msg));
    if (this.onReaction) api.onReaction((evt) => this.onReaction!(accountId, evt));
    if (this.onUndo) api.onUndo((evt) => this.onUndo!(accountId, evt));
  }

  /** Register a standalone sender (OA accounts have no inbound listener). */
  registerSender(accountId: number, sender: Sender): void {
    this.senders.set(accountId, sender);
  }

  has(accountId: number): boolean { return this.sessions.has(accountId) || this.senders.has(accountId); }

  private require(accountId: number): ZaloApi {
    const api = this.sessions.get(accountId);
    if (!api) throw new Error(`No active session for account ${accountId}`);
    return api;
  }

  private sender(accountId: number): Sender {
    return this.senders.get(accountId) ?? this.require(accountId);
  }

  async sendText(accountId: number, threadId: string, kind: ZaloThreadKind, text: string, quote?: QuoteSource) {
    return this.sender(accountId).sendText(threadId, kind, text, quote);
  }

  async sendAttachment(
    accountId: number,
    threadId: string,
    kind: ZaloThreadKind,
    file: { filename: string; data: Buffer },
    caption: string,
  ) {
    return this.sender(accountId).sendAttachment(threadId, kind, file, caption);
  }

  async getUserInfo(accountId: number, uid: string) {
    return this.require(accountId).getUserInfo(uid);
  }

  async getGroupInfo(accountId: number, groupId: string) {
    return this.require(accountId).getGroupInfo(groupId);
  }

  /** Stop and forget one account's in-memory runtime (personal adapter and/or OA sender). */
  async remove(accountId: number): Promise<void> {
    const api = this.sessions.get(accountId);
    if (api) {
      try { await api.stop(); } catch { /* already closed */ }
      this.sessions.delete(accountId);
    }
    this.senders.delete(accountId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()));
    this.sessions.clear();
  }
}
