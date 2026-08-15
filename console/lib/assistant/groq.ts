import Groq from "groq-sdk";
import { env } from "../env";

let client: Groq | null = null;

export function groqClient(): Groq {
  if (!client) {
    client = new Groq({ apiKey: env.groqApiKey });
  }
  return client;
}

export function groqModel(): string {
  return env.groqModel;
}
