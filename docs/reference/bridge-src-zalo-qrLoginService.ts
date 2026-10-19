import { Zalo, LoginQRCallbackEventType } from "zca-js";
import type { LoginQRCallbackEvent } from "zca-js";
import { QrLoginService } from "../admin/routes.js";
import { AccountRepo } from "../store/accountRepo.js";
import { MappingRepo } from "../store/mappingRepo.js";
import { ReconnectSupervisor } from "./reconnectSupervisor.js";
import { encryptCredentials } from "../crypto/credentials.js";
import type { ProxyOptions } from "./proxyOptions.js";

export class ZcaQrLoginService implements QrLoginService {
  constructor(
    private supervisor: ReconnectSupervisor,
    private accounts: AccountRepo,
    private mapping: MappingRepo,
    private credentialsKey: Buffer,
    private resolveProxyOptions: (accountId: number) => Promise<ProxyOptions>,
  ) {}

  async startLogin(accountId: number): Promise<{ qrImageBase64: string }> {
    const proxy = await this.resolveProxyOptions(accountId);
    const zalo = new Zalo({ selfListen: true, ...proxy });
    return await new Promise((resolve, reject) => {
      let resolved = false;
      zalo
        .loginQR({}, async (event: LoginQRCallbackEvent) => {
          if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
            const img = event.data?.image;
            const dataUrl = img?.startsWith("data:") ? img : `data:image/png;base64,${img}`;
            if (!resolved) { resolved = true; resolve({ qrImageBase64: dataUrl }); }
          }
          if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
            try {
              const creds = { imei: event.data.imei, cookie: event.data.cookie, userAgent: event.data.userAgent, language: "vi" };
              await this.mapping.saveCredentials(accountId, encryptCredentials(creds, this.credentialsKey));
              // Hand off: the supervisor loads the just-saved creds, builds + registers the adapter,
              // binds inbound, sets status connected, and persists the refreshed cookie.
              await this.supervisor.connect(accountId);
            } catch (err) {
              console.error("QR login GotLoginInfo error for account", accountId, err);
              await this.accounts.updateStatus(accountId, "expired").catch(() => {});
            }
          }
        })
        .catch((err: unknown) => { if (!resolved) { resolved = true; reject(err); } });
    });
  }
}
