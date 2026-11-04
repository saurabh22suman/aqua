import type NewMemberPage from "@/app/(owner)/owner/members/new/page";

// Mirrors the installed Next 15 types plugin's FirstArg and PageProps constraint.
type FirstArg<T> = T extends (...args: [infer A, never]) => unknown ? A : never;
type PageProps = { params?: Promise<Record<string, string | string[] | undefined>>; searchParams?: Promise<unknown> };
type Check<T extends PageProps> = T;
export type MemberPagePropsContract = Check<FirstArg<typeof NewMemberPage>>;
