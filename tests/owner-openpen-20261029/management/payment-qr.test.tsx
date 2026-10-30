// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Payment QR settings lead with the saved collection destinations; the
// two creation paths stay behind one contextual disclosure, because a
// QR helps someone pay and is not itself a payment confirmation.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  createPaymentQrAction: async () => ({ ok: true }),
  updatePaymentQrAction: async () => ({ ok: true }),
  deletePaymentQrAction: async () => ({ ok: true }),
  listPaymentQrsAction: async () => [],
}));

import { PaymentQrManager } from "@/components/payment-qr-manager";

afterEach(cleanup);

const QRS = [
  {
    id: "qr-1",
    nickname: "Front desk UPI",
    kind: "upi" as const,
    upiId: "splash@upi",
    payeeName: "Splash Sports Club",
    imageMime: null,
    hasImage: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-10-01T04:00:00.000Z",
  },
];

describe("payment QR settings", () => {
  it("shows saved destinations before the add paths", async () => {
    render(<PaymentQrManager qrs={QRS} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Collection destinations" }),
    ).toBeTruthy();
    expect(screen.getByText("Front desk UPI")).toBeTruthy();

    // Creation paths are not competing with the saved list.
    expect(screen.queryByRole("button", { name: "Add UPI QR" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Add a payment QR" }),
    );
    expect(
      screen.getByRole("button", { name: "Add UPI QR" }),
    ).toBeTruthy();
  });
});
