import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { consumePinAddressBudget, PIN_ADDRESS_LIMIT, PIN_ADDRESS_WINDOW_MS } from "@/db/pin-login-budget";
const run=promisify(execFile);
const ip=()=>`2001:db8:${randomUUID().slice(0,4)}:${randomUUID().slice(0,4)}::1`;

describe("F02 address budgets are shared and expire",()=>{
  it("shares the same cap across four independent Node processes",async()=>{
    const address=ip();
    const results=await Promise.all(Array.from({length:4},()=>run(process.execPath,["--import","tsx","tests/remediation-20261112/budget-driver.ts",address],{env:process.env})));
    expect(results.reduce((n,r)=>n+JSON.parse(r.stdout).allowed,0)).toBe(PIN_ADDRESS_LIMIT);
  },20000);
  it("starts a fresh budget at the exact expiry boundary",async()=>{
    const headers=new Headers({"x-real-ip":ip()}),now=Date.now();
    for(let i=0;i<PIN_ADDRESS_LIMIT;i++) expect(await consumePinAddressBudget(headers,now)).toBe(true);
    expect(await consumePinAddressBudget(headers,now+PIN_ADDRESS_WINDOW_MS-1)).toBe(false);
    expect(await consumePinAddressBudget(headers,now+PIN_ADDRESS_WINDOW_MS)).toBe(true);
  });
});
