import { errorResponse, successResponse } from "@tinycms/contracts";
import { Hono } from "hono";

type AdminWorker = {
  Bindings: {
    ADMIN_HOST: string;
  };
  Variables: {
    requestId: string;
  };
};

export const app = new Hono<AdminWorker>();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);

  await next();

  context.header("X-Request-Id", requestId);
});

app.use("*", async (context, next) => {
  const configuredHost = context.env.ADMIN_HOST?.trim().toLowerCase();
  const requestHost = new URL(context.req.url).hostname.toLowerCase();

  if (!configuredHost || requestHost !== configuredHost) {
    return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
  }

  return next();
});

app.get("/healthz", (context) => {
  return context.json(successResponse({ status: "ok" }, context.get("requestId")));
});

app.notFound((context) => {
  return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
});

app.onError((_, context) => {
  return context.json(
    errorResponse("INTERNAL_ERROR", "Internal server error", context.get("requestId")),
    500,
  );
});

export default app;
