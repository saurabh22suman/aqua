import { consumePinAddressBudget } from "@/db/pin-login-budget";
import { pool } from "@/db/client";
const address=process.argv[2];
if (!address) throw new Error("Synthetic address argument required");
try {
  let allowed=0;
  for(let i=0;i<8;i++) if(await consumePinAddressBudget(new Headers({"x-real-ip":address}))) allowed++;
  process.stdout.write(JSON.stringify({allowed}));
} finally {await pool.end();}
