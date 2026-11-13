import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Exact reviewed sources and their authority/caller graph. This is a
// change detector, not a substitute for per-query security review.
const DIGESTS: Record<string, string> = {
  "lib/services/member-link-authority.ts": "599ed6c9fe2e219cd9509ac43a46e90660034b25a240ba0b771b6385d5cb4c04",
  "lib/services/facility-scope.ts": "924378b4d4ecb6000478a59a31aa61c14254209bb318c3ef4fe569eb183c7781",
  "db/self-service-account.ts": "d3c15313369666c07ef7e837bfaf4db5bea999ea558cc676275bdd9521415d0f",
  "lib/branding/asset-reference.ts": "35e5ec8c907a194cb8ab092afe8946c2560a13b6dd7e3f2b4cb336b82d5163a4",
  "lib/services/showcase/link-token.ts": "5e2a501e6d3d5b4da12b42aa97843953e505482e145f0f8b8a9146dfa12a4991",
  "lib/services/showcase/public-view.ts": "a134f3bd2f1beb7f8aceb38735abb9187b574271f6b7842d7cbcc8c9791b528c",
  "lib/services/self-service-link-facts.ts": "a2af003747fdaca1890dd4271c0fbc13e4046fe1ca22e56f588f22e0caf04bcf",
  "lib/services/self-service-session.ts": "8b5d04426dab6585ef9d328b6ff043c286ac4908e4bb293fa62162a6652fdc22",
  "lib/auth/self-scope.ts": "a144ecff923d4594bde3ae67f4fbb4aca3dbaca6331e0fcca15104d06e7e640e",
  "lib/actions/guardian-authorization.ts": "36df71b6b138a784318fa4043c58ae60744899a9e83d2a8a8a2d756ff49f5721",
  "lib/actions/member-link-binding.ts": "deaa23b4032aa6cdb0024cce15df23b930a5337f2d46907d6a517fafb568f05c",
  "lib/services/member-link-binding.ts": "ee47973c1717b1cb0a857d8c619a206f0237dbfe33fdcc331d0e9964281f1a9e",
  "app/(owner)/owner/members/[memberId]/access/page.tsx": "c55aa36250d35e81a32673f6a9757cd718328bcb18e676e0f724cd7297bae918",
  "app/(self)/member/page.tsx": "aecf00c4eacfc829a63be6399a4cf3301a1b6b403e334e3dc2d1ff1daa2c90c7",
  "app/(self)/family/page.tsx": "b005164fc2070c974d2aa9ea877a3b084d5d38ff1e72ba44287371c86b0f3b46",
  "app/(self)/member/billing/page.tsx": "72ba2d9fb75094b5ecb596888cc970089488763a149b69cae6482457aabd43f7",
  "app/(self)/family/billing/[memberId]/page.tsx": "3ea6e74f3c26f5d9b08d561727a2dafa5699c7491fdf930693cb5ea03fc9d004",
  "app/(self)/family/showcase/[memberId]/page.tsx": "0f968809106096db2154e2a9f8295526d9da81b65cb0a838ae6d7a186f44280f",
  "app/(self)/member/showcase/page.tsx": "b61aa15c7bddc110bdcf82caa050c1572e4cc7b71dd282e5fa3b4c9b6c1de9e6",
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
  "lib/services/guardian-authorization.ts": { source: ["b39499c3a81e5d953b491162f4f05b453818323972655ceda83654fd01f748a4"], dependencies: [...staff, "lib/actions/guardian-authorization.ts"], reason: "live staff authority, write grant and every child facility checked" },
  "lib/services/member-access-enrollment.ts": { source: ["b16452ab25eb0d36c17dc6d522978147f3781a3e1f521a3083ef209189439cd0"], dependencies: [...staff, "lib/services/member-link-binding.ts", "lib/actions/member-link-binding.ts"], reason: "live staff grant and subject facility before account lookup and provisioning" },
  "lib/services/member-link-binding.ts": { source: ["ee47973c1717b1cb0a857d8c619a206f0237dbfe33fdcc331d0e9964281f1a9e"], dependencies: [...staff, "lib/services/self-service-link-facts.ts", "lib/actions/member-link-binding.ts"], reason: "live staff facility authority and current subject link facts" },
  "lib/services/member-link-readmodel.ts": { source: ["3f9b180b693cf75d11f1162759083cf3854387070c444427c7d31473b08669ab"], dependencies: [...staff, "lib/services/self-service-link-facts.ts", "app/(owner)/owner/members/[memberId]/access/page.tsx"], reason: "one member with live staff grant and facility authority" },
  "lib/services/self-billing.ts": { source: ["c6ccd733978d4727092bb637f8f47c51cbc6211bb94b2fcbc996d7d86b9eb7a3"], dependencies: [...self, "db/self-service-account.ts", "app/(self)/member/billing/page.tsx", "app/(self)/family/billing/[memberId]/page.tsx"], reason: "resolver-scoped member or guardian link and subject rechecked" },
  "lib/services/self-home.ts": { source: ["762c88b9eeaa6b37150e8356c6af682461360bf546084e8a32c332fa8efacf05"], dependencies: [...self, "lib/branding/asset-reference.ts", "app/(self)/member/page.tsx", "app/(self)/family/page.tsx", "app/(self)/family/billing/[memberId]/page.tsx", "app/(self)/family/showcase/[memberId]/page.tsx"], reason: "resolver-scoped member or linked children only" },
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
