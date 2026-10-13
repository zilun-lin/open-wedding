import { createRequestHandler, RouterContextProvider } from "react-router";
import { platformContext, type AppEnv } from "../app/platform/context";
import { handleApi } from "../app/platform/api.server";
import { deliverOutbox, sweepOutbox } from "../app/platform/email.server";
import { getConfig, invitedEvents } from "../app/platform/config.server";
import { guestSession } from "../app/platform/security.server";
import { calendarFile } from "../app/domain/calendar.server";
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    let response: Response;
    if (path.startsWith("/api/")) response = await handleApi(request, env, ctx);
    else if (path.startsWith("/calendar/")) {
      const match = path.match(/^\/calendar\/(en|zh-Hans)\/([a-z0-9-]+)\.ics$/),
        config = getConfig(),
        guest = await guestSession(request, env),
        invited = await invitedEvents(env.DB, guest?.id);
      const event =
        match &&
        config.events.find(
          (e) =>
            e.id === match[2] &&
            (e.visibility === "public" || invited.includes(e.id)),
        );
      response = event
        ? new Response(
            calendarFile(event, match![1], new URL(request.url).hostname),
            {
              headers: {
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": `attachment; filename="${event.id}.ics"`,
              },
            },
          )
        : new Response("Not found", { status: 404 });
    } else {
      const context = new RouterContextProvider();
      context.set(platformContext, { env, ctx });
      response = await requestHandler(request, context);
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (import.meta.env.PROD)
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await deliverOutbox(env, message.body.id);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sweepOutbox(env));
  },
} satisfies ExportedHandler<AppEnv, { id: string }>;
