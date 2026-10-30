import { test as base } from "@playwright/test";
export { expect, type Page, type APIRequestContext } from "@playwright/test";

// Browser scenarios share one local owner/IP and can exceed Better Auth's
// sign-in and session-read limits. Honor their retry delay in the test client;
// never disable or relax the server's rate limits. Auth protocol tests use the
// unmodified HTTP client and still observe rate-limit responses directly.
export const test = base.extend<{ localSignInRetry: void }>({
  localSignInRetry: [
    async ({ context }, use, testInfo) => {
      await context.route(
        /\/api\/auth\/(?:sign-in\/email|get-session)(?:\?.*)?$/,
        async (route) => {
          if (
            !["localhost", "127.0.0.1"].includes(
              new URL(route.request().url()).hostname,
            )
          )
            return route.continue();
          for (let attempt = 0; ; attempt++) {
            const response = await route.fetch();
            if (response.status() !== 429 || attempt === 2)
              return route.fulfill({ response });
            const delay = Number(response.headers()["x-retry-after"]);
            if (!Number.isFinite(delay) || delay < 0 || delay > 60)
              return route.fulfill({ response });
            await response.dispose();
            testInfo.setTimeout(testInfo.timeout + (delay + 0.1) * 1000);
            await new Promise((resolve) =>
              setTimeout(resolve, (delay + 0.1) * 1000),
            );
          }
        },
      );
      await use();
    },
    { auto: true },
  ],
});
