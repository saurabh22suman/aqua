import { pingDatabase } from "./platform";
import { getWorkerHealth } from "./worker-heartbeats";
import { resolveProviderName } from "@/lib/messaging/provider";
import type { MessageProviderName } from "@/lib/messaging/provider";
import { isObjectStoreEnabled } from "@/lib/storage/object-store";
import { env } from "@/lib/env";
import type { WorkerHealthState } from "@/lib/health/worker-heartbeat";

export type DatabaseEvidence = {
  state: "reachable" | "unreachable";
  detail: string;
};

export type WorkerEvidence = {
  state: WorkerHealthState | "unreadable";
  lastSeenAt: Date | null;
  detail: string;
};

export type ProviderEvidence = {
  state: "mock" | "capture" | "disabled" | "unsupported";
  /** True when a provider NAME is set in the environment. */
  configured: boolean;
  detail: string;
};

export type StorageEvidence = {
  state: "configured" | "not_configured";
  detail: string;
};

export type SystemEvidence = {
  database: DatabaseEvidence;
  worker: WorkerEvidence;
  provider: ProviderEvidence;
  storage: StorageEvidence;
  readAt: Date;
};

async function readDatabase(): Promise<DatabaseEvidence> {
  try {
    await pingDatabase();
    return {
      state: "reachable",
      detail: "The application database answered a live query.",
    };
  } catch {
    return {
      state: "unreachable",
      detail:
        "The application database did not answer. The driver's own message is not " +
        "repeated here, because it can carry the connection details.",
    };
  }
}

async function readWorker(): Promise<WorkerEvidence> {
  try {
    const health = await getWorkerHealth();
    const detail =
      health.state === "healthy"
        ? "The worker recorded a heartbeat inside the grace window."
        : health.state === "stale"
          ? "The last heartbeat is older than the grace window, so the worker is treated as not running."
          : "No worker heartbeat has been recorded at all.";
    return { state: health.state, lastSeenAt: health.lastSeenAt, detail };
  } catch {
    return {
      state: "unreadable",
      lastSeenAt: null,
      detail:
        "The worker heartbeat could not be read, so no heartbeat state is available.",
    };
  }
}

function readProvider(): ProviderEvidence {
  const configured = env.WHATSAPP_PROVIDER !== undefined;
  let name: MessageProviderName;
  try {
    name = resolveProviderName();
  } catch {
    return {
      state: "disabled",
      configured,
      detail:
        "The messaging provider could not be resolved, so no provider is in use and " +
        "sends fail loudly.",
    };
  }
  if (name === "mock") {
    return {
      state: "mock",
      configured,
      detail:
        "The mock provider pretends to deliver. Nothing leaves the system, and no " +
        "delivery is proven.",
    };
  }
  if (name === "capture") {
    return {
      state: "capture",
      configured,
      detail:
        "The capture provider is a synthetic preview sink. Nothing reaches a real " +
        "recipient, and no delivery is proven.",
    };
  }
  if (name === "cloud") {
    return {
      state: "unsupported",
      configured,
      detail:
        "A provider is configured that this release cannot use, so sends fail loudly. " +
        "No delivery is proven.",
    };
  }
  return {
    state: "disabled",
    configured,
    detail: "No messaging provider is in use, so sends fail loudly.",
  };
}

function readStorage(): StorageEvidence {
  if (!isObjectStoreEnabled()) {
    return {
      state: "not_configured",
      detail:
        "The object store is not configured, so there is no backup evidence to show.",
    };
  }
  return {
    state: "configured",
    detail:
      "The object store is configured. The application records no backup or restore " +
      "health, so this is not evidence that a backup exists.",
  };
}

/**
 * The whole read, in ONE call, so ONE audited operation row covers it.
 */
export async function getSystemEvidence(): Promise<SystemEvidence> {
  const [database, worker] = await Promise.all([readDatabase(), readWorker()]);
  return {
    database,
    worker,
    provider: readProvider(),
    storage: readStorage(),
    readAt: new Date(),
  };
}
