import { v7 as uuidv7 } from "uuid";
import type { MessageProvider, SendResult } from "./provider";

// C-40a — the mock provider. It performs no network call: it returns a
// fake provider message id and the send service records the row. Used
// outside production only; the resolver and the env boot guard between
// them make production mocking impossible.

export function createMockProvider(): MessageProvider {
  return {
    name: "mock",
    async send(): Promise<SendResult> {
      return {
        providerMessageId: `mock-${uuidv7()}`,
        status: "sent",
      };
    },
  };
}
