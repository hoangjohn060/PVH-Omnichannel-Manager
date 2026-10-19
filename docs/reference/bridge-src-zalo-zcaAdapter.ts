import { Zalo, ThreadType } from "zca-js";
import {
  ZaloApi, ZaloThreadKind, IncomingMessage, ReactionEvent, UndoEvent, QuoteSource, UserProfile, GroupProfile, ZaloCredentials,
  normalizeIncoming, normalizeReaction, normalizeUndo, toZcaThreadType,
} from "./types.js";
import { resolveStickerImage } from "./stickerResolver.js";
import type { ProxyOptions } from "./proxyOptions.js";

export class ZcaAdapter implements ZaloApi {
  private constructor(private api: any) {}

  /** Login from saved credentials and start listening. */
  static async fromCredentials(creds: ZaloCredentials, proxy: ProxyOptions = {}): Promise<ZcaAdapter> {
    const zalo = new Zalo({ selfListen: true, ...proxy });
    const api = await zalo.login({
      imei: creds.imei, cookie: creds.cookie as any, userAgent: creds.userAgent, language: creds.language ?? "vi",
    });
    api.listener.start({ retryOnClose: true });
    return new ZcaAdapter(api);
  }

  async sendText(threadId: string, kind: ZaloThreadKind, text: string, quote?: QuoteSource): Promise<{ msgId: string }> {
    // With a quote, zca-js takes a MessageContent object and routes to the /quote endpoint.
    const payload = quote
      ? { msg: text, quote: { ...quote, propertyExt: undefined } }
      : text;
    const res = await this.api.sendMessage(payload, threadId, toZcaThreadType(kind) as ThreadType);
    const msgId = String(res?.message?.msgId ?? "");
    if (!msgId) throw new Error("zca-js sendText returned no msgId");
    return { msgId };
  }

  async sendAttachment(
    threadId: string, kind: ZaloThreadKind, file: { filename: string; data: Buffer }, caption: string
  ): Promise<{ msgId: string }> {
    // zca-js AttachmentSource (buffer form) requires a filename WITH an allowed extension
    // and metadata.totalSize; without them the upload silently produces no msgId.
    const filename = /\.[A-Za-z0-9]+$/.test(file.filename) ? file.filename : `${file.filename || "attachment"}.jpg`;
    const res = await this.api.sendMessage(
      { msg: caption, attachments: { data: file.data, filename, metadata: { totalSize: file.data.length } } },
      threadId, toZcaThreadType(kind) as ThreadType
    );
    const ids = res?.attachment ?? [];
    const msgId = String(ids[0]?.msgId ?? res?.message?.msgId ?? "");
    if (!msgId) throw new Error("zca-js sendAttachment returned no msgId");
    return { msgId };
  }

  async getUserInfo(uid: string): Promise<UserProfile> {
    const res: any = await this.api.getUserInfo(uid);
    const profile = res?.changed_profiles?.[uid] ?? res?.[uid] ?? res ?? {};
    return { uid, displayName: profile.zaloName || profile.displayName || profile.dName || uid, avatar: profile.avatar, phone: profile.phone };
  }

  async getGroupInfo(groupId: string): Promise<GroupProfile> {
    const res: any = await this.api.getGroupInfo(groupId);
    const info = res?.gridInfoMap?.[groupId] ?? {};
    return { groupId, name: info.name ?? groupId, avatar: info.fullAvt ?? info.avt };
  }

  onMessage(cb: (msg: IncomingMessage) => void): void {
    this.api.listener.on("message", (raw: any) => { void this.deliver(raw, cb); });
  }

  // A sticker message carries only { id, catId, type } — no image URL. Resolve the image via
  // the sticker_detail API and upgrade it to a media image so Chatwoot renders the actual
  // sticker. If resolution fails, fall back to the classified "[Sticker]" text (never blank).
  private async deliver(raw: any, cb: (msg: IncomingMessage) => void): Promise<void> {
    try {
      const msg = normalizeIncoming(raw);
      if (raw?.data?.msgType === "chat.sticker") {
        const img = await resolveStickerImage(this.api, raw?.data?.content?.id);
        if (img) {
          cb({ ...msg, text: "", classified: { kind: "media", mediaType: "image", href: img.href, filename: img.filename, caption: "" } });
          return;
        }
      }
      cb(msg);
    } catch {
      // Last resort: deliver the best-effort normalized message so nothing is lost.
      try { cb(normalizeIncoming(raw)); } catch { /* ignore */ }
    }
  }

  onReaction(cb: (evt: ReactionEvent) => void): void {
    this.api.listener.on("reaction", (raw: any) => {
      try { cb(normalizeReaction(raw)); } catch { /* ignore malformed reaction */ }
    });
  }

  onUndo(cb: (evt: UndoEvent) => void): void {
    this.api.listener.on("undo", (raw: any) => {
      try { cb(normalizeUndo(raw)); } catch { /* ignore malformed undo */ }
    });
  }

  onClosed(cb: (code: number, reason: string) => void): void {
    // Only the terminal `closed` event means zca-js gave up. `disconnected` fires on every
    // websocket drop *before* its own retry, so reacting to it would tear down a session that
    // is about to recover. The supervisor recreates the session when `closed` fires.
    this.api.listener.on("closed", (code: number, reason: string) => cb(Number(code), reason ?? "closed"));
  }

  /** Serialize the live cookie jar into the shape `Zalo.login()` accepts, so restarts use a fresh cookie. */
  getSerializedCookie(): unknown {
    try {
      const jar = this.api.getCookie?.();
      if (!jar) return null;
      return typeof jar.toJSON === "function" ? jar.toJSON() : jar;
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    try { this.api.listener.stop(); } catch { /* ignore */ }
  }
}
