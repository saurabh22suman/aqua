import { expect,it,vi } from "vitest";
import { ClubSelectionRequired } from "@/lib/auth/active-club";
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("@/lib/auth/server",()=>({auth:{api:{getSession:async()=>({user:{id:"synthetic"},session:{id:"synthetic",expiresAt:new Date(Date.now()+60000)}})}}}));
vi.mock("@/lib/auth/context",async original=>({...await original<typeof import("@/lib/auth/context")>(),requireDefaultCtx:async()=>{throw new ClubSelectionRequired();}}));
import { offlineSessionState } from "@/lib/offline/server-session";
it("does not mint an offline scope or throw before a club is chosen",async()=>{await expect(offlineSessionState()).resolves.toEqual({authenticated:false,identity:null});});
