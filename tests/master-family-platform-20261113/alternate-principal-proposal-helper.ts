import * as ts from "typescript";

// Each template pins the complete action, including parse, denial branches,
// authority resolution, service order and result handling. Any action change
// fails closed for review rather than granting a name-based exemption.
const contracts: Record<string, { action: string; code: string; imports: Record<string, string[]>; schema?: string }> = {
  "lib/actions/announcements.ts": {
    action: "markNotificationReadAction",
    code: `export async function markNotificationReadAction(notificationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const parsed = notificationInput.safeParse({ notificationId });
      if (!parsed.success) return { ok: false, error: "Notification not found." };
      const ctx = await requireDefaultCtx();
      return markNotificationRead(ctx, parsed.data.notificationId);
    }`,
    imports: { "@/lib/auth/context": ["requireDefaultCtx"], "@/lib/services/announcements": ["markNotificationRead"], zod: ["z"] },
    schema: `const notificationInput = z.object({ notificationId: z.string().uuid() });`,
  },
  "lib/actions/self-notifications.ts": {
    action: "markSelfNotificationAction",
    code: `export async function markSelfNotificationAction(audience: "member" | "guardian", form: FormData) {
      const parsed = z.object({ audience: z.enum(["member", "guardian"]), notificationId: z.string().uuid() }).safeParse({ audience, notificationId: form.get("notificationId") });
      if (!parsed.success) notFound();
      const resolver = await resolveSelfScope(parsed.data.audience, null);
      if (!resolver) notFound();
      const result = await resolver.read((tx, scope) => markSelfNotificationReadInTx(tx, scope, parsed.data.notificationId));
      if (!result.ok) notFound();
      revalidatePath(parsed.data.audience === "member" ? "/member/announcements" : "/family/announcements");
    }`,
    imports: { zod: ["z"], "next/navigation": ["notFound"], "next/cache": ["revalidatePath"], "@/lib/auth/self-scope": ["resolveSelfScope"], "@/lib/services/announcements": ["markSelfNotificationReadInTx"] },
  },
  "lib/actions/club-selection.ts": {
    action: "selectClubAction",
    code: `export async function selectClubAction(raw: unknown): Promise<{ kind: "ok"; path: string } | { error: string }> {
      const input = z.object({ tenantId: z.string().uuid() }).safeParse(raw);
      if (!input.success) return { error: "Choose an available club." };
      const h = await headers();
      const session = await withPlatform(() => auth.api.getSession({ headers: h }));
      if (!session?.user) return { error: "Sign in again to choose a club." };
      const choices = await listClubChoices(session.user.id,new Date(session.session.createdAt));
      const selected = choices.find(club => club.tenantId === input.data.tenantId);
      if (!selected) return { error: "This club is no longer available. Refresh and choose again." };
      const store = await cookies();
      store.set(ACTIVE_CLUB_COOKIE,selected.tenantId,{ httpOnly: true,secure: process.env.NODE_ENV === "production",
        sameSite: "lax",path: "/",maxAge: 30*24*60*60 });
      store.delete(FACILITY_COOKIE);
      return { kind: "ok", path: selected.homePath };
    }`,
    imports: { zod: ["z"], "next/headers": ["headers", "cookies"], "@/lib/auth/server": ["auth"], "@/db/scope": ["withPlatform"], "@/db/club-selection": ["listClubChoices"], "@/lib/auth/active-club": ["ACTIVE_CLUB_COOKIE"], "@/lib/facility": ["FACILITY_COOKIE"] },
  },
};

const readContracts: Record<string, { action: string; code: string; imports: Record<string, string[]>; schema?: string }> = {
  "lib/actions/branding.ts#getBrandingAction": { action: "getBrandingAction", code: `export async function getBrandingAction(): Promise<BrandingData> {
    const ctx = await requireDefaultCtx(); return getBranding({ tenantId: ctx.tenantId });
  }`, imports: { "@/lib/auth/context": ["requireDefaultCtx"], "@/lib/services/branding": ["getBranding"] } },
  "lib/actions/terminology.ts#getTerminologyAction": { action: "getTerminologyAction", code: `export async function getTerminologyAction(): Promise<GetTerminologyResult> {
    const ctx = await requireDefaultCtx(); return getTerminology({ tenantId: ctx.tenantId });
  }`, imports: { "@/lib/auth/context": ["requireDefaultCtx"], "@/lib/services/terminology": ["getTerminology"] } },
  "lib/actions/announcements.ts#listMyNotificationsAction": { action: "listMyNotificationsAction", code: `export async function listMyNotificationsAction(): Promise<NotificationRow[]> {
    const ctx = await requireDefaultCtx(); return listMyNotifications(ctx);
  }`, imports: { "@/lib/auth/context": ["requireDefaultCtx"], "@/lib/services/announcements": ["listMyNotifications"] } },
};

const printer = ts.createPrinter({ removeComments: true });
function canonical(node: ts.Node, source: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, source);
}

export function checkedAlternatePrincipal(path: string, action: string, source: string): boolean {
  const contract = readContracts[`${path}#${action}`] ?? contracts[path];
  if (!contract || action !== contract.action) return false;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const expected = ts.createSourceFile("expected.ts", contract.code, ts.ScriptTarget.Latest, true);
  const declarations = file.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === action);
  if (declarations.length !== 1 || !expected.statements[0] || canonical(declarations[0]!, file) !== canonical(expected.statements[0], expected)) return false;
  for (const [module, names] of Object.entries(contract.imports)) {
    const imports = file.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === module);
    for (const name of names) {
      const matching = imports.flatMap((s) => {
        const named = s.importClause?.namedBindings;
        if (s.importClause?.isTypeOnly || !named || !ts.isNamedImports(named)) return [];
        return named.elements.filter((element) => !element.isTypeOnly && element.name.text === name && (!element.propertyName || element.propertyName.text === name));
      });
      if (matching.length !== 1) return false;
    }
  }
  if (contract.schema) {
    const schema = ts.createSourceFile("schema.ts", contract.schema, ts.ScriptTarget.Latest, true);
    const statements = file.statements.filter((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === "notificationInput"));
    if (statements.length !== 1 || !schema.statements[0] || canonical(statements[0]!, file) !== canonical(schema.statements[0], schema)) return false;
  }
  return true;
}
