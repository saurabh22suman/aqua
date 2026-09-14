import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// C-35 — payment QR service against a real database: both kinds,
// validation, audit, soft delete, image retrieval and RLS.

type QrService = typeof import("@/lib/services/payment-qrs");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let qrs: QrService;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerId = asUserId(uuidv7());
const RUN = Date.now().toString(36);

// 1x1 PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const ctx = { tenantId: tenantA, userId: ownerId };

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  qrs = await import("@/lib/services/payment-qrs");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'QR A', 'active'), ($3, $4, 'QR B', 'active')",
    [tenantA, `qr-a-${RUN}`, tenantB, `qr-b-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ownerId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("payment QRs", () => {
  it("creates a UPI QR, lists it with a nickname, and audits it", async () => {
    const created = await qrs.createPaymentQr(ctx, {
      nickname: "Office account",
      kind: "upi",
      upiId: "club@okhdfcbank",
      payeeName: "Sharma Sports",
    });
    expect(created.ok).toBe(true);

    const list = await qrs.listPaymentQrs(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      nickname: "Office account",
      kind: "upi",
      upiId: "club@okhdfcbank",
      payeeName: "Sharma Sports",
      isActive: true,
      hasImage: false,
    });

    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1",
      [tenantA],
    );
    expect(audit.rows.map((r) => r.action)).toContain("payment_qr.create");
  });

  it("rejects a bad UPI ID and a duplicate nickname (case-insensitive)", async () => {
    const badUpi = await qrs.createPaymentQr(ctx, {
      nickname: "Bad",
      kind: "upi",
      upiId: "not-a-vpa",
      payeeName: "X",
    });
    expect(badUpi.ok).toBe(false);

    const duplicate = await qrs.createPaymentQr(ctx, {
      nickname: "office ACCOUNT",
      kind: "upi",
      upiId: "other@bank",
      payeeName: "X",
    });
    expect(duplicate.ok).toBe(false);
  });

  it("stores an image QR and serves the exact bytes back", async () => {
    const created = await qrs.createPaymentQr(ctx, {
      nickname: "Bank QR",
      kind: "image",
      image: { data: PNG_BYTES, mime: "image/png" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const list = await qrs.listPaymentQrs(ctx);
    const imageRow = list.find((r) => r.id === created.id);
    expect(imageRow?.hasImage).toBe(true);

    const image = await qrs.getPaymentQrImage(ctx, created.id);
    expect(image?.mime).toBe("image/png");
    expect(image?.data.equals(PNG_BYTES)).toBe(true);
  });

  it("refuses oversize images and wrong mime types", async () => {
    const oversize = await qrs.createPaymentQr(ctx, {
      nickname: "Too big",
      kind: "image",
      image: { data: Buffer.alloc(262145), mime: "image/png" },
    });
    expect(oversize.ok).toBe(false);

    const wrongType = await qrs.createPaymentQr(ctx, {
      nickname: "Wrong type",
      kind: "image",
      image: { data: PNG_BYTES, mime: "text/plain" },
    });
    expect(wrongType.ok).toBe(false);

    const empty = await qrs.createPaymentQr(ctx, {
      nickname: "Empty",
      kind: "image",
      image: { data: new Uint8Array(0), mime: "image/png" },
    });
    expect(empty.ok).toBe(false);
  });

  it("updates nickname and active state, and refuses UPI fields on an image QR", async () => {
    const list = await qrs.listPaymentQrs(ctx);
    const upiQr = list.find((r) => r.kind === "upi")!;
    const renamed = await qrs.updatePaymentQr(ctx, upiQr.id, {
      nickname: "Main account",
      isActive: false,
    });
    expect(renamed.ok).toBe(true);

    const after = await qrs.listPaymentQrs(ctx);
    const updated = after.find((r) => r.id === upiQr.id);
    expect(updated?.nickname).toBe("Main account");
    expect(updated?.isActive).toBe(false);

    const activeOnly = await qrs.listPaymentQrs(ctx, { activeOnly: true });
    expect(activeOnly.find((r) => r.id === upiQr.id)).toBeUndefined();

    const badUpi = await qrs.updatePaymentQr(ctx, upiQr.id, {
      upiId: "nope",
    });
    expect(badUpi.ok).toBe(false);

    const imageQr = after.find((r) => r.kind === "image")!;
    const upiOnImage = await qrs.updatePaymentQr(ctx, imageQr.id, {
      upiId: "x@bank",
    });
    expect(upiOnImage.ok).toBe(false);
  });

  it("soft-deletes and frees the nickname", async () => {
    const list = await qrs.listPaymentQrs(ctx);
    const target = list.find((r) => r.kind === "image")!;
    const deleted = await qrs.deletePaymentQr(ctx, target.id);
    expect(deleted.ok).toBe(true);

    const after = await qrs.listPaymentQrs(ctx);
    expect(after.find((r) => r.id === target.id)).toBeUndefined();
    expect(await qrs.getPaymentQrImage(ctx, target.id)).toBeNull();

    const reuse = await qrs.createPaymentQr(ctx, {
      nickname: target.nickname,
      kind: "upi",
      upiId: "again@bank",
      payeeName: "Again",
    });
    expect(reuse.ok).toBe(true);

    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1 and action = 'payment_qr.delete'",
      [tenantA],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("keeps QRs tenant-isolated under RLS", async () => {
    const otherCtx = { tenantId: tenantB, userId: ownerId };
    expect(await qrs.listPaymentQrs(otherCtx)).toHaveLength(0);

    const listA = await qrs.listPaymentQrs(ctx);
    const foreign = await qrs.getPaymentQrImage(otherCtx, listA[0]!.id);
    expect(foreign).toBeNull();
  });
});
