export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function resolveApiUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (clean.startsWith("dashboard/api/")) {
    return "/" + clean;
  }
  return "/dashboard/api/" + clean;
}

function isAuthEndpoint(path: string): boolean {
  const clean = path.replace(/^\/+/, "").replace(/^dashboard\/api\//, "");
  return clean === "login" || clean === "session";
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["X-Dashboard-Request"] = "1";
  }

  const res = await fetch(resolveApiUrl(path), {
    method,
    credentials: "same-origin",
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    signal,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(
      "The dashboard returned an unexpected response. Reload and try again.",
      res.status,
    );
  }

  if (!res.ok) {
    if (res.status === 401 && !isAuthEndpoint(path)) {
      unauthorizedHandler?.();
    }
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Request failed. Try again.";
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>("GET", path, undefined, signal);
}

export function apiPost<T>(
  path: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  return request<T>("POST", path, body, signal);
}
