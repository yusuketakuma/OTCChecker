"use client";

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildErrorMessage(response: Response, payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;

    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  return `Request failed (${response.status})`;
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload));
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }

  return payload as T;
}

export async function postJson<T>(
  input: RequestInfo | URL,
  body: unknown,
  init?: RequestInit,
) {
  return fetchJson<T>(input, {
    method: "POST",
    body: JSON.stringify(body),
    ...init,
  });
}

export async function putJson<T>(
  input: RequestInfo | URL,
  body: unknown,
  init?: RequestInit,
) {
  return fetchJson<T>(input, {
    method: "PUT",
    body: JSON.stringify(body),
    ...init,
  });
}
