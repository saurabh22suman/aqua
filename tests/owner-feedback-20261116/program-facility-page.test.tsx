// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({allowed:false,canWrite:true,cookie:undefined as string|undefined,listPrograms:vi.fn(async()=>[]),board:vi.fn()}));
vi.mock('@/lib/auth/surface-guard',()=>({requireOwner:async()=>({permissions:new Set(['programs.read',...(state.canWrite?['programs.write']:[])])}),requirePagePermission:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>state.cookie===undefined?undefined:{value:state.cookie}})}));
vi.mock('@/lib/services/selected-facility-access',()=>({canSelectFacility:async()=>state.allowed}));
vi.mock('@/lib/actions/programs',()=>({listProgramsAction:state.listPrograms,listBatchesAction:async()=>[],listCoachesAction:async()=>[]}));
vi.mock('@/lib/actions/people',()=>({listLocationsAction:async()=>[{id:'site',name:'Authorized site'}]}));
vi.mock('@/lib/actions/terminology',()=>({getTerminologyAction:async()=>({overrides:{},locale:'en'})}));
vi.mock('@/components/programs-batches-board',()=>({ProgramsBatchesBoard:(props:unknown)=>{state.board(props);return <div>Programs board</div>;}}));
import Page from '@/app/(owner)/owner/programs/page';
afterEach(()=>{cleanup();state.allowed=false;state.canWrite=true;state.cookie=undefined;state.listPrograms.mockClear();state.board.mockClear();});
it('refuses an unavailable facility before offering an editor at a substitute site',async()=>{
  render(await Page({searchParams:Promise.resolve({facility:'11111111-1111-4111-8111-111111111111'})}));
  expect(screen.getByRole('heading',{name:'Club unavailable'})).toBeTruthy();
  expect(screen.getByRole('link',{name:'View available clubs'}).getAttribute('href')).toBe('/owner/programs?facility=all');
  expect(state.listPrograms).not.toHaveBeenCalled();
  expect(state.board).not.toHaveBeenCalled();
});
it('passes the selected scope and actual write permission to the board',async()=>{
  state.allowed=true;state.canWrite=false;
  render(await Page({searchParams:Promise.resolve({facility:'11111111-1111-4111-8111-111111111111'})}));
  expect(state.board).toHaveBeenCalledWith(expect.objectContaining({selectedFacilityId:'11111111-1111-4111-8111-111111111111',canManage:false}));
});
it('preserves program writing without unrelated coach and member read grants',async()=>{
  state.allowed=true;
  render(await Page({searchParams:Promise.resolve({facility:'all'})}));
  expect(state.board).toHaveBeenCalledWith(expect.objectContaining({canManage:true,canManageBatches:false,coaches:[],locations:[]}));
});
it.each([undefined,'11111111-1111-4111-8111-111111111111'])('rejects a malformed explicit facility instead of falling back to cookie %s',async(cookie)=>{
  state.allowed=true;state.cookie=cookie;
  render(await Page({searchParams:Promise.resolve({facility:'not-a-uuid'})}));
  expect(screen.getByRole('heading',{name:'Club unavailable'})).toBeTruthy();
  expect(state.board).not.toHaveBeenCalled();
});
