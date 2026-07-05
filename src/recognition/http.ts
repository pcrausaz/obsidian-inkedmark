/**
 * Shared JSON POST over Obsidian's `requestUrl` (CORS bypass on desktop and
 * mobile). `requestUrl({throw: false})` covers HTTP error statuses, but
 * connection-level failures (refused, unreachable, DNS, TLS) still reject —
 * this helper owns that workaround so call sites don't each re-copy the
 * try/catch.
 */

import { requestUrl, type RequestUrlResponse } from "obsidian";

/** The request never reached the server (refused, unreachable, DNS, TLS). */
export class ConnectionError extends Error {}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<RequestUrlResponse> {
  try {
    return await requestUrl({
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
  } catch (err) {
    throw new ConnectionError(err instanceof Error ? err.message : String(err));
  }
}
