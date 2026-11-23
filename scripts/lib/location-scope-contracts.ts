import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Exact reviewed sources and their authority/caller graph. This is a
// change detector, not a substitute for per-query security review.
const DIGESTS: Record<string, string> = {
  "components/onboarding/guide-preference-key.ts": "75d00a90aefa7bec6d5bb76ff79141453991604aa09cd8655f0c07d9bb55ef90",
  "lib/services/member-link-authority.ts": "599ed6c9fe2e219cd9509ac43a46e90660034b25a240ba0b771b6385d5cb4c04",
  "lib/services/facility-scope.ts": "924378b4d4ecb6000478a59a31aa61c14254209bb318c3ef4fe569eb183c7781",
  "db/self-service-account.ts": "8e1f210a86752e8711b7b29c4c0a1287c5045e60fd10e372c4553428ec1d5eb2",
  "lib/branding/asset-reference.ts": "35e5ec8c907a194cb8ab092afe8946c2560a13b6dd7e3f2b4cb336b82d5163a4",
  "lib/services/showcase/link-token.ts": "5e2a501e6d3d5b4da12b42aa97843953e505482e145f0f8b8a9146dfa12a4991",
  "lib/services/showcase/public-view.ts": "a134f3bd2f1beb7f8aceb38735abb9187b574271f6b7842d7cbcc8c9791b528c",
  "lib/services/self-service-link-facts.ts": "a2af003747fdaca1890dd4271c0fbc13e4046fe1ca22e56f588f22e0caf04bcf",
  "lib/services/self-service-session.ts": "3bd627d021a788189525a61ce94873596f57f0d15c3ea2e4f0537ad81cf58a9c",
  "lib/auth/self-scope.ts": "8c3c6b935998831546a5a4eada549392342afd25baab630a12d212626e1d3d57",
  "lib/actions/guardian-authorization.ts": "36df71b6b138a784318fa4043c58ae60744899a9e83d2a8a8a2d756ff49f5721",
  "lib/actions/member-link-binding.ts": "deaa23b4032aa6cdb0024cce15df23b930a5337f2d46907d6a517fafb568f05c",
  "lib/services/member-link-binding.ts": "a81bc3b70b7a4a737e3427a9046c9327c47452c90626a91d8d43e127e49b24ed",
  "app/(owner)/owner/members/[memberId]/access/page.tsx": "def48fe4a30346d81f7e557c9fc5859c8facbe70551e6155bfabc69406f179a6",
  "app/(self)/member/page.tsx": "978ecc3e50a8661814b9870af5ce50384e7c23c284d79aee834bf55593cde58f",
  "app/(self)/family/page.tsx": "a431d9f9f7eb3881de78e4f48eab9131b260aea418440411b7ac5ee783a7a8b8",
  "app/(self)/member/billing/page.tsx": "0b7d8226b06d8f35617be07fbc898fd5d3e38ba11f74a8362a871fd1e93a263b",
  "app/(self)/family/billing/[memberId]/page.tsx": "c7668bc388d8676baadb6aedfa4d957026f2220fa9d70294e3c9342dfb6bcc09",
  "app/(self)/family/showcase/[memberId]/page.tsx": "3eb2cf39cd8c5f639cfed056d438414dad7def8be6d8a73c5c47ed562abc8e0d",
  "app/(self)/member/showcase/page.tsx": "b1eca722dc45701f4006514f88aa602a7fbbc36b84c843b592370c822a8cba61",
  "lib/services/showcase/publication.ts": "7b7b5d94f48fa7de7e6842ac3a552bbf92c67737094c91656f36045c398b251f",
  "lib/services/showcase/visibility.ts": "83c5a0e39c5e395cd639bcc346d8d8c6cebf18c13abdcd8507ef1fb18ddd012a",
  "lib/services/showcase/eligibility.ts": "194b3e6ac71203f3536a383865b675c4e5f94287a0bee0a1f8fcd5be8d9d6709",
  "lib/services/showcase/state.ts": "7bdec39f7e53e7520ba0c86d9e95754c861d3ab55d618a063664c8c5ffcb05bd",
  "lib/services/showcase/decision.ts": "7887b6849b24b076319eb89e3483feb528c6ce03d1357b6b1e26bff831599951",
};

type Contract = { source: readonly string[]; dependencies: readonly string[]; reason: string };
const authority = "lib/services/member-link-authority.ts";
const staff = [authority, "lib/services/facility-scope.ts"];
const self = ["lib/auth/self-scope.ts", "lib/services/self-service-session.ts", "lib/services/self-service-link-facts.ts", authority];
export const REVIEWED_LOCATION_CONTRACTS: Readonly<Record<string, Contract>> = {
  "lib/services/guardian-authorization.ts": { source: ["08c093fe396e12aad5c42460d89ee6deff5192aa82968edec1210097b1230a97"], dependencies: [...staff, "lib/actions/guardian-authorization.ts"], reason: "live staff authority, write grant and every child facility checked" },
  "lib/services/member-access-enrollment.ts": { source: ["038bf820d39a8ba818f2ffa9b5166c2eb88d089a634f5499ba9840b8b8116d4a"], dependencies: [...staff, "lib/services/member-link-binding.ts", "lib/actions/member-link-binding.ts"], reason: "live staff grant and subject facility before account lookup and provisioning" },
  "lib/services/member-link-binding.ts": { source: ["a81bc3b70b7a4a737e3427a9046c9327c47452c90626a91d8d43e127e49b24ed"], dependencies: [...staff, "lib/services/self-service-link-facts.ts", "lib/actions/member-link-binding.ts"], reason: "live staff facility authority and current subject link facts" },
  "lib/services/member-link-readmodel.ts": { source: ["3f9b180b693cf75d11f1162759083cf3854387070c444427c7d31473b08669ab"], dependencies: [...staff, "lib/services/self-service-link-facts.ts", "app/(owner)/owner/members/[memberId]/access/page.tsx"], reason: "one member with live staff grant and facility authority" },
  "lib/services/self-billing.ts": { source: ["c6ccd733978d4727092bb637f8f47c51cbc6211bb94b2fcbc996d7d86b9eb7a3"], dependencies: [...self, "db/self-service-account.ts", "app/(self)/member/billing/page.tsx", "app/(self)/family/billing/[memberId]/page.tsx"], reason: "resolver-scoped member or guardian link and subject rechecked" },
  "lib/services/self-home.ts": { source: ["762c88b9eeaa6b37150e8356c6af682461360bf546084e8a32c332fa8efacf05"], dependencies: [...self, "components/onboarding/guide-preference-key.ts", "lib/branding/asset-reference.ts", "app/(self)/member/page.tsx", "app/(self)/family/page.tsx", "app/(self)/family/billing/[memberId]/page.tsx", "app/(self)/family/showcase/[memberId]/page.tsx"], reason: "resolver-scoped member or linked children only" },
  "lib/services/showcase/publication-query.ts": { source: ["0666306d3b4504eb1a1c70bbb606272b48e14ccfa9e412f53371bbbb7ce3f232"], dependencies: ["lib/services/showcase/publication.ts", "lib/services/showcase/visibility.ts", "lib/services/showcase/link-token.ts", "lib/services/showcase/public-view.ts", "lib/services/self-service-link-facts.ts", "lib/services/facility-scope.ts"], reason: "publication snapshot bound to tenant and current subject decision" },
  "lib/services/showcase/subject.ts": { source: ["e753fd50813ec98216d5bafe22c21de13bb19540575e5e133cb56b5e3bd77e79"], dependencies: [...self, "lib/services/showcase/state.ts", "lib/services/showcase/decision.ts", "lib/services/showcase/eligibility.ts", "app/(self)/member/showcase/page.tsx", "app/(self)/family/showcase/[memberId]/page.tsx"], reason: "live member or guardian source link and subject identity" },
};

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeBytes(root: string, path: string): Buffer | null {
  try {
    const rootReal = realpathSync(root);
    const target = realpathSync(resolve(rootReal, path));
    const rel = relative(rootReal, target);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    return readFileSync(target);
  } catch { return null; }
}

/** null means unregistered; false means registered but changed/unsafe. */
export function reviewedLocationContract(source: string, path: string, root: string): boolean | null {
  const contract = Object.hasOwn(REVIEWED_LOCATION_CONTRACTS, path) ? REVIEWED_LOCATION_CONTRACTS[path] : undefined;
  if (!contract) return null;
  const onDisk = safeBytes(root, path);
  if (!onDisk || !contract.source.includes(digest(source)) || digest(onDisk) !== digest(source)) return false;
  return contract.dependencies.every((dep) => {
    const bytes = safeBytes(root, dep);
    return bytes !== null && digest(bytes) === DIGESTS[dep];
  });
}
