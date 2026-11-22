import { pool } from "@/db/client";
import type { Pool, PoolClient, QueryConfig } from "pg";

// Control statement completion while retaining real PostgreSQL transactions.
// The competing query either finishes (old unprotected implementation) or
// PostgreSQL reports it waiting for our lock. No fixed race-winning delay.
export function holdFirstRead(pattern: RegExp, competition: RegExp = pattern) {
  let ready!:()=>void, resume!:()=>void;
  const reached=new Promise<void>(resolve=>{ready=resolve;});
  const released=new Promise<void>(resolve=>{resume=resolve;});
  let claimed=false, competingPid:number|undefined;
  const restores:Array<()=>void>=[];
  const wrapped=new WeakSet<PoolClient>();
  function acquire(client:PoolClient) {
    if(wrapped.has(client)) return;wrapped.add(client);
    const original=client.query;
    const bound=original.bind(client);
    client.query=((...args:Parameters<PoolClient["query"]>)=>{
      const first:unknown=args[0];
      const text=typeof first==="string"?first:(first as QueryConfig)?.text??"";
      const matches=pattern.test(text);
      const firstMatch=matches&&!claimed;
      if(firstMatch) claimed=true;
      else if(competition.test(text)) competingPid=(client as PoolClient&{processID:number}).processID;
      const result=bound(...args);
      return firstMatch ? Promise.resolve(result).then(async row=>{ready();await released;return row;}) : result;
    }) as PoolClient["query"];
    restores.push(()=>{client.query=original;});
  }
  pool.on("acquire",acquire);
  return {
    reached,
    release:resume,
    async waitForCompetition(admin:Pool, operation:Promise<unknown>) {
      let completed=false;void operation.finally(()=>{completed=true;});
      for(let attempt=0;attempt<500;attempt++) {
        if(completed) return;
        if(competingPid) {
          const {rows:[row]}=await admin.query("select cardinality(pg_blocking_pids($1))>0 as blocked",[competingPid]);
          if(row?.blocked) return;
        }
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error("Competing database operation neither completed nor waited for the held lock");
    },
    close(){resume();pool.removeListener("acquire",acquire);for(const restore of restores) restore();},
  };
}
