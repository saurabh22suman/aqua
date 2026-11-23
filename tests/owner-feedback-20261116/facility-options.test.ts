import {afterAll,beforeAll,expect,it} from 'vitest';
import {fixture} from '@/tests/remediation-20261112/fixture';
import {listLocations} from '@/lib/services/people';
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{
  f=await fixture();
  // A real restricted legacy admin may see unlocated data records. Physical
  // facilities have non-null IDs and must still follow assigned locations.
  await f.admin.query("update roles set key='admin',name='Admin' where id=(select role_id from tenant_memberships where id=$1)",[f.managerMembership]);
});
afterAll(async()=>{if(f)await f.cleanup();});
it('does not interpret access to unlocated records as permission to list every facility',async()=>{
  const ctx={...f.context(f.managerId,'manager'),roleKey:'admin'};
  expect((await listLocations(ctx)).map(x=>x.id)).toEqual([f.locationA]);
});
it('keeps all facilities for a live unrestricted Owner and none for a revoked restricted actor',async()=>{
  expect(new Set((await listLocations(f.context())).map(x=>x.id))).toEqual(new Set([f.locationA,f.locationB]));
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1",[f.managerMembership]);
  expect(await listLocations({...f.context(f.managerId,'manager'),roleKey:'admin'})).toEqual([]);
});
