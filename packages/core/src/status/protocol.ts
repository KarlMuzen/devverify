import { z } from 'zod';
import { ProtocolError } from './errors.js';
import { mapApiState } from './types.js';
import { redactSecrets } from './redact.js';

const successSchema = z.object({
  name: z.string(),
  state: z.string(),
}).passthrough();

const errorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
  }).passthrough(),
}).passthrough();

export interface ParsedSuccess {
  state: ReturnType<typeof mapApiState>;
  rawState: string;
}

function errorMessage(body: string, apiKey: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const result = errorSchema.safeParse(parsed);
    if (result.success) {
      return redactSecrets(result.data.error.message?.trim() || fallback, [apiKey]);
    }
  } catch {
    // Malformed error payloads use the safe fallback.
  }

  return fallback;
}

/**
 * Validates the JSON returned for HTTP 200 and preserves unknown API states.
 */
export function parseSuccess(body: string, status: number): ParsedSuccess {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ProtocolError('Status API returned invalid JSON.', status);
  }

  const result = successSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProtocolError(
      'Status API returned an invalid response body.',
      status,
    );
  }

  return {
    state: mapApiState(result.data.state),
    rawState: result.data.state,
  };
}

/**
 * Extracts a safe provider error message without ever returning the API key.
 */
export function parseErrorMessage(
  body: string,
  apiKey: string,
  fallback: string,
): string {
  return errorMessage(body, apiKey, fallback);
}
