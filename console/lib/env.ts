/**
 * Centralised environment access.
 *
 * Every secret in the app is read through here so that a missing key fails
 * with a named, actionable error at the point of use rather than as a vague
 * `undefined` deep inside a third-party SDK.
 *
 * Nothing in this file is imported by client components.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. Copy console/.env.example to console/.env and fill it in (see build plan §12).`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  get groqApiKey() {
    return required("GROQ_API_KEY");
  },
  get groqModel() {
    return optional("GROQ_MODEL", "llama-3.3-70b-versatile");
  },
  get vapidPublicKey() {
    return required("VAPID_PUBLIC_KEY");
  },
  get vapidPrivateKey() {
    return required("VAPID_PRIVATE_KEY");
  },
  get vapidSubject() {
    return optional("VAPID_SUBJECT", "mailto:admin@example.com");
  },
};

/** True when a key is present, for degrading gracefully instead of throwing. */
export function hasEnv(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim() !== "");
}
