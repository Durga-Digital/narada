import { Hono } from "hono";
import type { Runtime } from "@narada/core/runtime";
import { AppError } from "@narada/core/model";
import { escapeHtml, readUnsubscribeToken } from "@narada/core/broadcast-model";
export function unsubscribeRoutes(runtime: Runtime) {
  const app = new Hono(),
    directory = runtime.contacts;
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    await next();
  });
  app.get("/:token", async (c) => {
    const { email, topicId } = readUnsubscribeToken(
      runtime.config.BETTER_AUTH_SECRET,
      c.req.param("token"),
    );
    if (c.req.query("preferences") !== "1")
      return c.html(
        page(
          "Unsubscribe?",
          `<p>You will stop receiving ${topicId ? "this topic’s" : "this audience’s"} broadcasts. Transactional messages are unaffected.</p><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button>Unsubscribe</button></form><p><a href="?preferences=1">Manage email preferences</a></p>`,
        ),
      );
    await directory.segments();
    const details = await directory.details(email);
    const topics = details.topics.filter(
      (t) =>
        t.active &&
        (t.visibility === "public" || t.id === topicId || t.subscribed),
    );
    return c.html(
      page(
        "Email preferences",
        `<p>${escapeHtml(email)}</p>${details.unsubscribedAll ? "<p>All broadcasts are currently paused for you. Saving topic choices does not resume them.</p>" : ""}<form method="post"><input type="hidden" name="action" value="preferences">${topics.map((t) => `<label><input type="checkbox" name="topic_${t.id}" ${t.subscribed ? "checked" : ""}> ${escapeHtml(t.name)}<small>${escapeHtml(t.description)}</small></label>`).join("")}<button>Save preferences</button></form><form method="post"><input type="hidden" name="action" value="${details.unsubscribedAll ? "resume" : "all"}"><button>${details.unsubscribedAll ? "Resume broadcasts for selected topics" : "Unsubscribe from all broadcasts"}</button></form><p>Transactional messages are unaffected.</p>`,
      ),
    );
  });
  app.post("/:token", async (c) => {
    const token = c.req.param("token"),
      { email, topicId } = readUnsubscribeToken(
        runtime.config.BETTER_AUTH_SECRET,
        token,
      );
    const data = await c.req.parseBody();
    if (data["List-Unsubscribe"] === "One-Click") {
      await runtime.subscriptions.unsubscribe(
        token,
        runtime.config.BETTER_AUTH_SECRET,
      );
      return c.html(
        page(
          "You’re unsubscribed.",
          '<p>You will no longer receive these broadcasts.</p><a href="?preferences=1">Manage preferences</a>',
        ),
      );
    }
    if (data.action === "all")
      await runtime.subscriptions.unsubscribeAll(email);
    else if (data.action === "resume")
      await runtime.subscriptions.resume(email);
    else if (data.action === "preferences") {
      const details = await directory.details(email);
      const allowed = details.topics.filter(
        (t) =>
          t.active &&
          (t.visibility === "public" || t.id === topicId || t.subscribed),
      );
      for (const topic of allowed)
        await runtime.subscriptions.subscribe(
          email,
          topic.id,
          data[`topic_${topic.id}`] === "on",
          "Subscriber preference page",
        );
    } else throw new AppError(400, "Invalid preference request");
    return c.html(
      page(
        "Preferences saved.",
        '<p>Your choices have been updated.</p><a href="?preferences=1">Back to preferences</a>',
      ),
    );
  });
  return app;
}
function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:16px/1.7 system-ui;background:#fafbf8;color:#253a2b;max-width:560px;margin:10vh auto;padding:24px}h1{font:36px Georgia}button{background:#345d37;color:white;border:0;border-radius:8px;padding:12px 24px;font:inherit;cursor:pointer}form{margin:24px 0}label{display:block;border:1px solid #ddd;padding:16px;margin:12px 0;border-radius:8px}small{display:block;color:#666;margin-left:24px}a{color:#345d37}</style><h1>${escapeHtml(title)}</h1>${body}</html>`;
}
