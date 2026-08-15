import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";

const EXCLUDED_REQUEST_HEADERS = new Set(["host", "content-length"]);
const EXCLUDED_RESPONSE_HEADERS = new Set(["connection", "content-length", "transfer-encoding"]);
const APP_AUTHORIZATION_HEADER = "x-bordchamp-authorization";

async function proxy(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const apiUrl = process.env.BORDCHAMP_API_URL;
  if (!apiUrl) {
    context.error("BORDCHAMP_API_URL is not configured");
    return { status: 503, jsonBody: { message: "API backend is not configured" } };
  }

  const incomingUrl = new URL(request.url);
  const path = request.params.path ?? "";
  const target = new URL(path, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  target.search = incomingUrl.search;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!EXCLUDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  const appAuthorization = headers.get(APP_AUTHORIZATION_HEADER);
  headers.delete(APP_AUTHORIZATION_HEADER);
  if (appAuthorization) headers.set("authorization", appAuthorization);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", "https");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(target, {
    method: request.method,
    headers,
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
  });

  const responseHeaders: Record<string, string> = {};
  for (const [name, value] of response.headers) {
    if (!EXCLUDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
  }

  const hasResponseBody = request.method !== "HEAD" && response.status !== 204 && response.status !== 304;
  return {
    status: response.status,
    headers: responseHeaders,
    ...(hasResponseBody ? { body: await response.arrayBuffer() } : {}),
  };
}

app.http("bordchampProxy", {
  authLevel: "anonymous",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  route: "{*path}",
  handler: proxy,
});