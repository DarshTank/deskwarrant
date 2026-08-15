import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Pairing-code alphabet: uppercase, with every visually ambiguous glyph removed
 * (no O/0, no I/1). Users read these off a screen and type them into a console
 * on another machine, so transcription errors are the failure mode to design out.
 */
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return code;
}

/** 32 random bytes as 64 hex chars. Returned to the agent exactly once. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

/** Only the hash is ever persisted (build plan §11). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare for equal-length hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Normalise user-typed codes: strip spaces/dashes, uppercase. */
export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}
