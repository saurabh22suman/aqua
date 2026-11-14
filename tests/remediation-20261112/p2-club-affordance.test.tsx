// @vitest-environment jsdom
import { render,screen } from "@testing-library/react";
import { expect,it,vi } from "vitest";
vi.mock("@/lib/actions/tenant-auth",()=>({logoutTenantAction:vi.fn()}));
vi.mock("@/lib/offline/logout",()=>({syncBeforeLogout:vi.fn()}));
vi.mock("@/lib/offline/client-session",()=>({clearOfflineData:vi.fn(),runOfflineLifecycle:vi.fn()}));
import { TenantSignOut } from "@/components/tenant-sign-out";
it("exposes club switching wherever the shared account exit appears",()=>{render(<TenantSignOut/>);expect(screen.getByRole("link",{name:"Switch club"}).getAttribute("href")).toBe("/clubs");});
