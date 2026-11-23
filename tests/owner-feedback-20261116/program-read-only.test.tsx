// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {Ctx} from '@/lib/auth/context';
const state=vi.hoisted(()=>({ctx:null as Ctx|null}));
vi.mock('@/lib/auth/context',()=>({ NotFoundError: class NotFoundError extends Error {},requireDefaultCtx:async()=>state.ctx}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock('@/lib/actions/terminology',()=>({getTerminologyAction:async()=>({overrides:{},locale:'en'})}));
vi.mock('@/components/programs-batches-board',()=>({ProgramsBatchesBoard:({canManage,canManageBatches}:{canManage:boolean;canManageBatches:boolean})=> <div><h1>Programs &amp; batches</h1><span>Read-only programs</span><span>{`${canManage}:${canManageBatches}`}</span></div>}));
import {fixture} from '@/tests/remediation-20261112/fixture';
import Page from '@/app/(owner)/owner/programs/page';
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{
  f=await fixture();
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where id=$2) and permission_key<>'programs.read'",[f.tenantId,f.managerMembership]);
  state.ctx={...f.context(f.managerId,'manager'),permissions:new Set(['programs.read'])};
});
afterAll(async()=>{cleanup();if(f)await f.cleanup();});
it('renders with real program actions without invoking unrelated forbidden editor reads',async()=>{
  render(await Page({searchParams:Promise.resolve({facility:f.locationA})}));
  expect(screen.getByRole('heading',{name:'Programs & batches'})).toBeTruthy();
  expect(screen.getByText('Read-only programs')).toBeTruthy();
  expect(screen.getByText('false:false')).toBeTruthy();
});
