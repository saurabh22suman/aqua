import { expect,it,vi } from "vitest";
import { ClubSelectionRequired } from "@/lib/auth/active-club";
vi.mock("@/lib/auth/context",async original=>({...await original<typeof import("@/lib/auth/context")>(),sessionExists:async()=>{throw new ClubSelectionRequired();}}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`);}}));
import CheckIn from "@/app/check-in/[token]/page";
it("direct premises QR entry sends an ambiguous session to club selection",async()=>{await expect(CheckIn({params:Promise.resolve({token:"synthetic"})})).rejects.toThrow("REDIRECT:/clubs");});
