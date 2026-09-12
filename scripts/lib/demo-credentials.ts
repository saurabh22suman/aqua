import { setCredentialForPhone } from "@/lib/services/credentials";

// Demo credentials (2026-09-11 phone+PIN auth feature).
//
// Every demo user logs in with phone + PIN. The PIN is a constant so
// the runbook can print it and the operator can read it off the page.
// It is only ever used by the demo-gated seed scripts (which check
// the demo gate before importing this); nothing in lib/services
// knows it.
export const DEMO_PIN = "123456";

export async function seedDemoCredentials(phones: string[]): Promise<void> {
  for (const phone of phones) {
    await setCredentialForPhone(phone, DEMO_PIN);
  }
}
