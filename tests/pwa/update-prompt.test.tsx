// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "@/components/pwa/update-prompt";
import { installFakeIndexedDB } from "../offline/fake-indexeddb";
import { OFFLINE_IDENTITY } from "../offline/fixture-identity";

// The update contract (docs/design-system/pwa.md):
//   * a new worker version is offered, never forced;
//   * nothing is reloaded while attendance is pending or a form holds
//     unsaved input;
//   * the person decides — "later" is a real answer.
//
// Agent-owned file (tests/pwa/**).

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("@/lib/offline/service-worker-update", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/offline/service-worker-update")>();
  return { ...actual, reloadAfterUpdate: reload };
});

type FakeWorker = { postMessage: ReturnType<typeof vi.fn>; state: string };

function installFakeServiceWorker(options: { waiting: boolean }) {
  const worker: FakeWorker = { postMessage: vi.fn(), state: "installed" };
  const registrationListeners = new Set<(event: Event) => void>();
  const controllerListeners = new Set<(event: Event) => void>();
  const registration = {
    waiting: options.waiting ? worker : null,
    installing: null,
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === "updatefound") registrationListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === "updatefound") registrationListeners.delete(listener);
    },
  };
  const serviceWorker = {
    controller: { state: "activated" },
    getRegistration: async () => registration,
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === "controllerchange") controllerListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === "controllerchange") controllerListeners.delete(listener);
    },
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
  return {
    worker,
    fireControllerChange: () => {
      for (const listener of controllerListeners) listener(new Event("controllerchange"));
    },
  };
}

beforeEach(() => {
  reload.mockClear();
  installFakeIndexedDB();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the update prompt", () => {
  it("offers a waiting worker instead of applying it silently", async () => {
    installFakeServiceWorker({ waiting: true });
    render(<UpdatePrompt pathname="/owner" />);

    expect(await screen.findByText(/new version/i)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /update now/i })).toBeTruthy();
  });

  it("does nothing at all when there is no waiting worker", async () => {
    installFakeServiceWorker({ waiting: false });
    const { container } = render(<UpdatePrompt pathname="/owner" />);
    await Promise.resolve();
    expect(container.textContent?.trim()).toBe("");
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to update while attendance is waiting to sync", async () => {
    const sw = installFakeServiceWorker({ waiting: true });
    const { activateOfflineIdentity, enqueueMark } = await import("@/lib/offline/idb");
    await activateOfflineIdentity(OFFLINE_IDENTITY);
    await enqueueMark({
      ...OFFLINE_IDENTITY,
      clientId: "pending-1",
      sessionId: "session-1",
      memberId: "member-1",
      status: "present",
      savedAt: Date.now(),
      attempts: 0,
    });

    render(<UpdatePrompt pathname="/coach" />);
    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));

    expect(await screen.findByText(/waiting to sync|pending/i)).toBeTruthy();
    expect(sw.worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("activates the waiting worker and reloads once it is safe", async () => {
    const sw = installFakeServiceWorker({ waiting: true });
    render(<UpdatePrompt pathname="/owner" />);
    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));

    await waitFor(() => expect(sw.worker.postMessage).toHaveBeenCalled());
    expect(sw.worker.postMessage).toHaveBeenCalledWith({ type: "aqua-activate-update" });
    expect(reload).not.toHaveBeenCalled();

    sw.fireControllerChange();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("never reloads while a form still holds unsaved input", async () => {
    const sw = installFakeServiceWorker({ waiting: true });
    document.body.innerHTML = `<form><input name="fee" value="1200" /></form>`;
    render(<UpdatePrompt pathname="/owner" />);
    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));

    expect(await screen.findByText(/unsaved|not saved|pending/i)).toBeTruthy();
    expect(sw.worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("lets the person say later without touching the worker", async () => {
    const sw = installFakeServiceWorker({ waiting: true });
    render(<UpdatePrompt pathname="/owner" />);
    fireEvent.click(await screen.findByRole("button", { name: /later/i }));

    await waitFor(() => expect(screen.queryByText(/new version/i)).toBeNull());
    expect(sw.worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("never appears on the operator console", async () => {
    installFakeServiceWorker({ waiting: true });
    const { container } = render(<UpdatePrompt pathname="/ops" />);
    await Promise.resolve();
    expect(container.textContent?.trim()).toBe("");
  });
});
