// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "@/components/pwa/update-prompt";
import { installFakeIndexedDB } from "../offline/fake-indexeddb";
import { OFFLINE_IDENTITY } from "../offline/fixture-identity";

// The update contract (docs/design-system/pwa.md):
//   * a new worker version is offered, never forced;
//   * an update that installs while the page stays open is OFFERED —
//     the browser fires "updatefound" before the new worker becomes the
//     waiting one, so the installing worker's state has to be watched;
//   * nothing is reloaded while attendance is pending or a form holds
//     unsaved input;
//   * the person decides — "later" is a real answer;
//   * the listeners are removed when the page is left, so a stale
//     registration cannot keep them attached.
//
// Agent-owned file (tests/pwa/**).

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("@/lib/offline/service-worker-update", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/offline/service-worker-update")>();
  return { ...actual, reloadAfterUpdate: reload };
});

type FakeWorker = {
  postMessage: ReturnType<typeof vi.fn>;
  state: string;
  listeners: Set<(event: Event) => void>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  setState: (state: string) => void;
};

function createFakeWorker(state = "installed"): FakeWorker {
  const listeners = new Set<(event: Event) => void>();
  const worker: FakeWorker = {
    postMessage: vi.fn(),
    state,
    listeners,
    addEventListener: (type, listener) => {
      if (type === "statechange") listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "statechange") listeners.delete(listener);
    },
    setState: next => {
      worker.state = next;
      for (const listener of listeners) listener(new Event("statechange"));
    },
  };
  return worker;
}

type FakeRegistration = {
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  listeners: Set<(event: Event) => void>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  listenerCount: () => number;
};

function installFakeServiceWorker(options: { waiting: boolean }) {
  const worker = createFakeWorker();
  const registrationListeners = new Set<(event: Event) => void>();
  const controllerListeners = new Set<(event: Event) => void>();
  const registration: FakeRegistration = {
    waiting: options.waiting ? worker : null,
    installing: null,
    listeners: registrationListeners,
    addEventListener: (type, listener) => {
      if (type === "updatefound") registrationListeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "updatefound") registrationListeners.delete(listener);
    },
    listenerCount: () => registrationListeners.size,
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
    registration,
    /** The browser starts a new worker: "updatefound" fires now, while
     *  the new worker is still installing. */
    startUpdate() {
      const installing = createFakeWorker("installing");
      registration.installing = installing;
      for (const listener of registrationListeners) listener(new Event("updatefound"));
      return installing;
    },
    /** The new worker finished installing and is now the waiting one. */
    promoteToWaiting(installing: FakeWorker) {
      registration.waiting = installing;
      installing.setState("installed");
      installing.setState("waiting");
    },
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

  it("watches the active registration even when no worker is waiting yet", async () => {
    // The registration exists and is active; there is no waiting worker
    // yet. The prompt must still be listening, or an update that
    // installs while this page stays open is never offered.
    const sw = installFakeServiceWorker({ waiting: false });
    render(<UpdatePrompt pathname="/owner" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));
  });

  it("offers an update when a new worker installs while the page stays open", async () => {
    const sw = installFakeServiceWorker({ waiting: false });
    render(<UpdatePrompt pathname="/owner" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));

    // The browser fires "updatefound" while the new worker is still
    // installing; it only becomes the waiting worker afterwards.
    const installing = sw.startUpdate();
    installing.setState("installed");
    sw.promoteToWaiting(installing);

    expect(await screen.findByText(/new version/i)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("hands the handover to the worker that just installed", async () => {
    const sw = installFakeServiceWorker({ waiting: false });
    render(<UpdatePrompt pathname="/owner" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));

    const installing = sw.startUpdate();
    installing.setState("installed");
    sw.promoteToWaiting(installing);
    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));

    await waitFor(() =>
      expect(installing.postMessage).toHaveBeenCalledWith({ type: "aqua-activate-update" }),
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("removes its listeners when the page is left", async () => {
    const sw = installFakeServiceWorker({ waiting: false });
    const { unmount } = render(<UpdatePrompt pathname="/owner" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));

    unmount();
    expect(sw.registration.listenerCount()).toBe(0);
  });

  it("does not leave a stale listener behind when the page navigates", async () => {
    const sw = installFakeServiceWorker({ waiting: false });
    const { rerender } = render(<UpdatePrompt pathname="/owner" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));

    rerender(<UpdatePrompt pathname="/owner/members" />);
    await waitFor(() => expect(sw.registration.listenerCount()).toBe(1));
    expect(sw.registration.listenerCount()).toBe(1);
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
