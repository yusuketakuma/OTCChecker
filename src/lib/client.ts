"use client";

type FlattenedErrorDetails = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

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

function readFlattenedErrorMessage(details: unknown) {
  if (!details || typeof details !== "object") {
    return "";
  }

  const { formErrors, fieldErrors } = details as FlattenedErrorDetails;

  const firstFormError = formErrors?.find(
    (message): message is string => typeof message === "string" && Boolean(message.trim()),
  );

  if (firstFormError) {
    return firstFormError.trim();
  }

  if (fieldErrors && typeof fieldErrors === "object") {
    for (const [field, messages] of Object.entries(fieldErrors)) {
      const firstFieldError = messages?.find(
        (message): message is string => typeof message === "string" && Boolean(message.trim()),
      );

      if (firstFieldError) {
        return `${field}: ${firstFieldError.trim()}`;
      }
    }
  }

  return "";
}

function buildErrorMessage(response: Response, payload: unknown) {
  if (payload && typeof payload === "object") {
    const detailsMessage = "details" in payload ? readFlattenedErrorMessage(payload.details) : "";

    if (detailsMessage) {
      return detailsMessage;
    }

    if ("error" in payload) {
      const error = payload.error;

      if (typeof error === "string" && error.trim()) {
        return error;
      }
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
