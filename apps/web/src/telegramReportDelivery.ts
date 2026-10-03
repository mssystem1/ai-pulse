export type TelegramReportDelivery = {
  initData: string;
  initDataUnsafe?: { user?: { allows_write_to_pm?: boolean } };
  requestWriteAccess?: (callback: (allowed: boolean) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
};

// This permission controls the message prompt only. The API still verifies
// signed initData and the real payment update before accessing or fulfilling an order.
export async function ensureTelegramReportDelivery(telegram: TelegramReportDelivery): Promise<void> {
  if (!telegram.initData) throw new Error("Open this Mini App from the PULSE bot.");
  if (telegram.initDataUnsafe?.user?.allows_write_to_pm === true) return;
  const help = "Allow PULSE to send your report to chat before checkout. Open PULSE chat and press Start, or allow messages when prompted.";
  if (!telegram.requestWriteAccess || telegram.isVersionAtLeast?.("6.9") === false) {
    throw new Error("Update Telegram and reopen the Mini App from PULSE chat to enable report delivery.");
  }
  await new Promise<void>((resolve, reject) => {
    try {
      telegram.requestWriteAccess!(allowed => allowed === true ? resolve() : reject(new Error(help)));
    } catch {
      reject(new Error(help));
    }
  });
}
