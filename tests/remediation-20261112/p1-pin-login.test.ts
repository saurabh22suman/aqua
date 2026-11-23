import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ensureBaUserForPhone, setCredential, pinLogin } from "@/lib/services/credentials";
import { POST } from "@/app/api/login/pin/route";

const admin=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
afterAll(async()=>{await admin.end();});
async function account() {
  const digits=BigInt("0x"+randomUUID().replaceAll("-","").slice(0,12))%9_000_000_000n+1_000_000_000n;
  const phone=`+91${digits}`;
  const baId=await ensureBaUserForPhone(phone);await setCredential(baId,"123456");
  return {phone,baId};
}
function request(phone:string,pin:string,address:string) {
  return POST(new Request(`${process.env.BETTER_AUTH_URL}/api/login/pin`,{method:"POST",headers:{"content-type":"application/json",origin:new URL(process.env.BETTER_AUTH_URL!).origin,"x-real-ip":address},body:JSON.stringify({phone,pin})}));
}
const ip=()=>`2001:db8:${randomUUID().slice(0,4)}:${randomUUID().slice(0,4)}::1`;

describe("F02 persistent PIN attempt boundaries",()=>{
  it("admits at most five concurrent failures for one account",async()=>{
    const {phone}=await account();
    const responses=await Promise.all(Array.from({length:12},()=>pinLogin(phone,"000000")));
    expect(responses.every(r=>r.status===401)).toBe(true);
    const {rows:[row]}=await admin.query("select failed_pin_attempts,pin_locked_until from users where phone=$1",[phone]);
    expect(row.failed_pin_attempts).toBe(5);
    expect(row.pin_locked_until).not.toBeNull();
    expect((await pinLogin(phone,"123456")).status).toBe(401);
  },30000);
  it("caps successful HTTP login attempts to twenty per address per minute",async()=>{
    const {phone}=await account(),address=ip();
    const statuses=[];
    for(let n=0;n<25;n++) statuses.push((await request(phone,"123456",address)).status);
    expect(statuses.filter(s=>s===200)).toHaveLength(20);
    expect(statuses.slice(20)).toEqual([401,401,401,401,401]);
    expect((await request(phone,"123456",ip())).status).toBe(200);
  },30000);
  it("allows login after lock expiry and clears the failure state",async()=>{
    const {phone}=await account();
    await admin.query("update users set failed_pin_attempts=5,pin_locked_until=now()-interval '1 second' where phone=$1",[phone]);
    expect((await pinLogin(phone,"123456")).status).toBe(200);
    const {rows:[row]}=await admin.query("select failed_pin_attempts,pin_locked_until from users where phone=$1",[phone]);
    expect(row).toEqual({failed_pin_attempts:0,pin_locked_until:null});
  });
  it("does not create an identity for an unknown phone",async()=>{
    const phone=`+919${String(Date.now()).slice(-9)}`;
    expect((await request(phone,"123456",ip())).status).toBe(401);
    expect((await admin.query("select id from users where phone=$1",[phone])).rowCount).toBe(0);
  });
});
