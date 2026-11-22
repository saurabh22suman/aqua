// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
const state=vi.hoisted(()=>({owners:[{membershipId:'self',fullName:'Signed-in owner',phone:'+919000006100'}]}));
vi.mock('@/lib/auth/surface-guard',()=>({requireOwner:async()=>({membershipId:'self',permissions:new Set(['staff.read','staff.write','staff.invite','settings.read'])}),requirePagePermission:vi.fn()}));
vi.mock('@/lib/auth/owner-settings-page-guard',()=>({isLiveOwnerForSettings:async()=>true}));
vi.mock('@/lib/auth/permission',()=>({hasPermission:(ctx:{permissions:Set<string>},key:string)=>ctx.permissions.has(key),hasFeature:()=>false}));
vi.mock('@/lib/actions/staff',()=>({listStaffAction:async()=>[]}));
vi.mock('@/lib/actions/tenant-owner-reset',()=>({listOwnerMembershipsAction:async()=>state.owners,issueTenantOwnerResetLinkAction:vi.fn()}));
vi.mock('@/components/staff-board',()=>({StaffBoard:()=>null}));
import StaffPage from '@/app/(owner)/owner/staff/page';
afterEach(()=>{cleanup();state.owners=[{membershipId:'self',fullName:'Signed-in owner',phone:'+919000006100'}];});
it('does not offer the signed-in sole owner a link to help themselves as another owner',async()=>{
  render(await StaffPage());
  expect(screen.queryByText('Owner access recovery')).toBeNull();
  expect(screen.queryByRole('button',{name:'Create reset link'})).toBeNull();
});
it('offers recovery only for a different active owner supplied by the authorized read',async()=>{
  state.owners.push({membershipId:'other',fullName:'Other owner',phone:'+919000006101'});
  render(await StaffPage());
  expect(screen.getByText('Owner access recovery')).toBeTruthy();
  expect(screen.getByText('Other owner')).toBeTruthy();
  expect(screen.queryByText('Signed-in owner')).toBeNull();
  expect(screen.getAllByRole('button',{name:'Create reset link'})).toHaveLength(1);
});
