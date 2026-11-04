import CollectionsPage from "@/app/(owner)/owner/reports/collections/page";

type Assert<T extends true> = T;
type FirstArgumentIsRequired = Assert<undefined extends Parameters<typeof CollectionsPage>[0] ? false : true>;
type FirstArg<T> = T extends (...args: [infer A, never]) => unknown ? A : never;
type PageProps = { params?: Promise<Record<string, string | string[] | undefined>>; searchParams?: Promise<unknown> };
type Check<T extends PageProps> = T;
export type CollectionsPagePropsContract = [FirstArgumentIsRequired, Check<FirstArg<typeof CollectionsPage>>];
