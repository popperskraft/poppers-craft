import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { errorSessionFromCookieHeader, writeSiteErrorLog } = await import("./lib/error-logs");
    const captured = error instanceof Error ? error : new Error(String(error ?? "Неизвестная серверная ошибка"));
    const digest = typeof error === "object" && error && "digest" in error ? String(error.digest ?? "") : "";
    await writeSiteErrorLog({
      category: "server",
      message: captured.message,
      page: request.path,
      method: request.method,
      source: `${context.routeType}:${context.routePath}`,
      stack: captured.stack,
      digest,
      sessionId: errorSessionFromCookieHeader(request.headers.cookie),
      userAgent: request.headers["user-agent"],
    });
  } catch (loggingError) {
    console.error("Next.js request error could not be saved", loggingError);
  }
};
