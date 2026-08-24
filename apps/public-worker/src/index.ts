import { errorResponse, successResponse } from "@tinycms/contracts";
import { Hono } from "hono";

type PublicWorker = {
  Variables: {
    requestId: string;
  };
};

const app = new Hono<PublicWorker>();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);

  await next();

  context.header("X-Request-Id", requestId);
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
