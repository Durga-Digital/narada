import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  SESv2Client,
  GetAccountCommand,
  GetConfigurationSetCommand,
} from "@aws-sdk/client-sesv2";
import { loadConfig } from "@narada/core/config";
import { createSesStatusReader } from "@narada/core/ses-status";
const config = (mode: "local" | "aws") =>
  loadConfig({
    NARADA_MODE: mode,
    BETTER_AUTH_SECRET: "a".repeat(40),
    AWS_REGION: "us-east-1",
    SES_CONFIGURATION_SET: "narada-test",
  });
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("never contacts AWS in local mode or invents live quotas", async () => {
  const send = vi.spyOn(SESv2Client.prototype, "send");
  expect(await createSesStatusReader(config("local"))()).toEqual({
    mode: "local",
    region: "us-east-1",
    configurationSet: "narada-test",
    account: null,
    delivery: null,
    checkedAt: null,
  });
  expect(send).not.toHaveBeenCalled();
});
it("reads actual account and pool configuration, coalesces requests and refreshes after cache expiry", async () => {
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockImplementation(async (command) => {
      if (command instanceof GetAccountCommand)
        return {
          ProductionAccessEnabled: false,
          SendingEnabled: false,
          SendQuota: { MaxSendRate: 1, Max24HourSend: 200, SentLast24Hours: 0 },
          EnforcementStatus: "HEALTHY",
          Details: { ContactLanguage: "secret-not-exposed" },
        };
      expect(command).toBeInstanceOf(GetConfigurationSetCommand);
      expect(command.input).toEqual({ ConfigurationSetName: "narada-test" });
      return {
        DeliveryOptions: {
          SendingPoolName: "existing-pool",
          TlsPolicy: "REQUIRE",
        },
        SendingOptions: { SendingEnabled: true },
      };
    });
  const read = createSesStatusReader(config("aws"));
  const [first, concurrent] = await Promise.all([read(), read()]);
  expect(concurrent).toEqual(first);
  expect(first.account).toMatchObject({
    productionAccess: false,
    sendingEnabled: false,
    maxPerSecond: 1,
    maxPer24Hours: 200,
    sentLast24Hours: 0,
  });
  expect(first.delivery).toEqual({
    poolName: "existing-pool",
    tlsPolicy: "REQUIRE",
    sendingEnabled: true,
  });
  expect(JSON.stringify(first)).not.toContain("secret-not-exposed");
  await read();
  expect(send).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(30_001);
  await read();
  expect(send).toHaveBeenCalledTimes(4);
});
it("keeps absent account fields unknown rather than reporting zero or production", async () => {
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(async () => ({}));
  const result = await createSesStatusReader(config("aws"))();
  expect(result.account?.maxPer24Hours).toBeNull();
  expect(result.account?.productionAccess).toBeNull();
  expect(result.delivery?.poolName).toBeNull();
});
it("reports read failures without exposing AWS error details and allows retry", async () => {
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockRejectedValue(new Error("sensitive account data"));
  const read = createSesStatusReader(config("aws"));
  await expect(read()).rejects.toThrow("Unable to read SES status");
  send.mockImplementation(async () => ({}));
  await expect(read()).resolves.toMatchObject({ mode: "aws" });
});
