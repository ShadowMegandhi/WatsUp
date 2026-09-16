/**
 * The content script side of the relay.
 *
 * This file is deliberately dumb. It performs a fetch and reports exactly what
 * came back, with no interpretation and no domain knowledge. All decisions
 * about what a response means live in the service worker, which is the single
 * writer of state. That split is what stops two open LEARN tabs from racing
 * each other.
 *
 * Running here rather than in the service worker matters: this code executes
 * in a genuine first-party page context on learn.uwaterloo.ca, so the session
 * cookie is attached the way the browser always attaches it. The worker tier
 * relies on a host-permission exemption that silently stops working when the
 * user blocks third-party cookies.
 */

import type { RelayRequest, RelayResponse } from '@shared/messages';
import { REQUEST_TIMEOUT_MS } from '@shared/constants';

/** Headers worth forwarding. Copying them all would be wasteful and noisy. */
const INTERESTING_HEADERS = [
  'content-type',
  'x-rate-limit-remaining',
  'x-request-cost',
  'x-rate-limit-reset',
  'retry-after',
] as const;

export const handleRelayRequest = async (req: RelayRequest): Promise<RelayResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(req.path, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const body = await response.text();

    return {
      id: req.id,
      ok: true,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      headers: pickHeaders(response.headers),
      body,
    };
  } catch (cause) {
    return {
      id: req.id,
      ok: false,
      status: 0,
      finalUrl: req.path,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    clearTimeout(timer);
  }
};

const pickHeaders = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of INTERESTING_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
};
