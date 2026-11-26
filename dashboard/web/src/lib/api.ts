import { toast } from "sonner";

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function notify(
  title: string,
  type: "info" | "success" | "error" | "warning" = "info",
  description = "",
) {
  const fn = toast[type] || toast;
  fn(title, description ? { description } : undefined);
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL("/dashboard/api/" + path, location.origin), {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Dashboard-Request": "1",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      "The dashboard returned an unexpected response. Reload and try again.",
    );
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed. Try again.",
    );
  }
  return data as T;
}
