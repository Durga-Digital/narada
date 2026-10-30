import {
  SESv2Client,
  GetAccountCommand,
  GetConfigurationSetCommand,
} from "@aws-sdk/client-sesv2";
import type { Config } from "./config.js";
import { AppError } from "./model.js";

import type { SesStatus } from "@narada/contracts/types";
export type { SesStatus } from "@narada/contracts/types";
/** Read-only account information. Local mode must never contact AWS. */
export function createSesStatusReader(config: Config) {
  let cached: SesStatus | undefined;
  let expiresAt = 0;
  let pending: Promise<SesStatus> | undefined;
  const base = {
    mode: config.NARADA_MODE,
    region: config.AWS_REGION,
    configurationSet: config.SES_CONFIGURATION_SET,
  };
  async function read(): Promise<SesStatus> {
    const client = new SESv2Client({
      region: config.AWS_REGION,
      maxAttempts: 2,
    });
    try {
      const [account, configuration] = await Promise.all([
        client.send(new GetAccountCommand({})),
        client.send(
          new GetConfigurationSetCommand({
            ConfigurationSetName: config.SES_CONFIGURATION_SET,
          }),
        ),
      ]);
      cached = {
        ...base,
        checkedAt: new Date().toISOString(),
        account: {
          productionAccess: account.ProductionAccessEnabled ?? null,
          sendingEnabled: account.SendingEnabled ?? null,
          enforcementStatus: account.EnforcementStatus ?? null,
          maxPerSecond: account.SendQuota?.MaxSendRate ?? null,
          maxPer24Hours: account.SendQuota?.Max24HourSend ?? null,
          sentLast24Hours: account.SendQuota?.SentLast24Hours ?? null,
        },
        delivery: {
          poolName: configuration.DeliveryOptions?.SendingPoolName ?? null,
          tlsPolicy: configuration.DeliveryOptions?.TlsPolicy ?? null,
          sendingEnabled: configuration.SendingOptions?.SendingEnabled ?? null,
        },
      };
      expiresAt = Date.now() + 30_000;
      return cached;
    } catch {
      throw new AppError(
        503,
        "Unable to read SES status. Check the AWS Region, configuration set, and the application's SES read permissions.",
      );
    } finally {
      client.destroy();
    }
  }
  return async (): Promise<SesStatus> => {
    if (config.NARADA_MODE === "local")
      return { ...base, checkedAt: null, account: null, delivery: null };
    if (cached && Date.now() < expiresAt) return cached;
    // Coalesce concurrent page loads as well as caching successful results.
    pending ??= read().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
