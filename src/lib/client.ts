"use client";

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload.data as T;
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
