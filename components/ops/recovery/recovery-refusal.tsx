// components/ops/recovery/recovery-refusal.tsx
//
// The refusal a viewer gets.
//
// It names no console material and no data: the account is told that
// the surface is administrator-only and that nothing was read. The
// refusal happens before any platform read (app/(platform)/ops/
// recovery/page.tsx -> the admin gate), so there is nothing to show
// even in principle.
//
// There is no control here at all - not even a disabled one. A refused
// operator gets a sentence, never a surface that cannot work.
//
// It lives in its own module so the console stays readable, and
// recovery-console.tsx re-exports it: the public import path
// ("@/components/ops/recovery/recovery-console") is unchanged for the
// page and for the tests that were written against it.

import { OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";

export function RecoveryRefusal() {
  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Operator console"
        title="Administrator access required"
        lede="This investigation console is limited to administrator accounts. Your platform account can browse the rest of the console, but it cannot open these recovery views."
      />
      <OpsPanel tone="pending" className="mt-6" title="Nothing was read">
        The refusal happens before any platform data is read, so no
        investigation data was loaded for this request.
      </OpsPanel>
    </OpsPage>
  );
}
