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

/**
 * The agent's proof that it owns a pairing claim, presented to redeem it.
 *
 * Same shape and strength as a device token because it is the same kind of
 * thing: a bearer credential that is never displayed and never typed. That is
 * the whole reason it can be 32 bytes where a pairing code has to be 6
 * characters a human can read off a screen without mistakes.
 */
export function generateClaimSecret(): string {
  return randomBytes(32).toString("hex");
}

const MATCH_CODE_LENGTH = 4;
const MATCH_CHOICE_COUNT = 4;

/**
 * One code for the PC to display, plus decoys, shuffled into the set the
 * approval page renders.
 *
 * Four choices rather than three because the extra decoy is free and drops a
 * blind guess from 33% to 25%. The real defence is that someone with no code
 * in front of them should press Deny, not guess -- a wrong pick kills the claim
 * outright, so there is exactly one attempt.
 */
export function generateMatchCodes(): { matchCode: string; choices: string[] } {
  const codes = new Set<string>();
  while (codes.size < MATCH_CHOICE_COUNT) {
    let code = "";
    for (let i = 0; i < MATCH_CODE_LENGTH; i++) {
      code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
    }
    codes.add(code);
  }

  const choices = [...codes];
  // Fisher-Yates with a CSPRNG: Math.random() would make the correct position
  // predictable from the claim's creation time.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }

  return { matchCode: choices[randomInt(choices.length)], choices };
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
