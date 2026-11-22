// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, within, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
const createBatch=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/actions/programs',()=>({createProgramAction:vi.fn(),updateProgramAction:vi.fn(),deleteProgramAction:vi.fn(),deleteBatchAction:vi.fn(),createBatchAction:createBatch,updateBatchAction:vi.fn()}));
vi.mock('@/lib/actions/coach-conflicts',()=>({checkCoachConflictsAction:async()=>({conflicts:[]})}));
import {ProgramsBatchesBoard} from '@/components/programs-batches-board';
import type {Program} from '@/db/schema/programs';
import type {BatchWithProgramName} from '@/lib/services/programs';
const program=(id:string,name:string)=>({id,name} as Program);
const props={canManage:true,initialPrograms:[program('p1','Junior competitive'),program('p2','MP18 Court Sport')],initialBatches:[{id:'b1',programId:'p2',programName:'MP18 Court Sport',name:'Evening badminton',daysOfWeek:[1,2],startTime:'18:00',endTime:'19:00',capacity:12,locationId:'badminton',locationName:'MP18',coachId:null,coachName:null} as BatchWithProgramName],coaches:[],locations:[{id:'swimming',name:'Swimming Centre'},{id:'badminton',name:'MP18'}],terminology:{overrides:{},locale:'en' as const}};
afterEach(()=>{cleanup();createBatch.mockReset();});
it('puts a named Add batch action inside every program and preselects that program',async()=>{
  render(<ProgramsBatchesBoard {...props} canManage/>);
  const row=screen.getByRole('group',{name:'Junior competitive'});
  fireEvent.click(within(row).getByRole('button',{name:'Add batch to Junior competitive'}));
  expect(await screen.findByRole('combobox',{name:'Program'})).toHaveProperty('value','p1');
});
it('makes the edit action readable without recognizing a pencil glyph',()=>{
  render(<ProgramsBatchesBoard {...props}/>);
  const row=screen.getByRole('group',{name:'MP18 Court Sport'});
  const edit=within(row).getByRole('button',{name:'Edit MP18 Court Sport'});
  expect(edit.textContent).toContain('Edit');
  fireEvent.click(edit);
  expect(within(row).getByRole('textbox')).toHaveProperty('value','MP18 Court Sport');
});
it('explains that an empty program has no batches at the current facility',()=>{
  render(<ProgramsBatchesBoard {...props}/>);
  expect(within(screen.getByRole('group',{name:'Junior competitive'})).getByText('No batches at this club.')).toBeTruthy();
});
it('starts a new batch at the selected facility, rather than the first alphabetical facility',async()=>{
  render(<ProgramsBatchesBoard {...props} selectedFacilityId='badminton'/>);
  fireEvent.click(within(screen.getByRole('group',{name:'MP18 Court Sport'})).getByRole('button',{name:'Add batch to MP18 Court Sport'}));
  expect(await screen.findByRole('combobox',{name:'Location'})).toHaveProperty('value','badminton');
  expect(screen.getByRole('combobox',{name:'Program'})).toHaveProperty('value','p2');
});
it('does not offer write controls to a read-only caller',()=>{
  render(<ProgramsBatchesBoard {...props} canManage={false}/>);
  expect(screen.queryByRole('button',{name:/add|edit|delete/i})).toBeNull();
  expect(screen.getByRole('group',{name:'MP18 Court Sport'})).toBeTruthy();
});
it('keeps a draft intact when another contextual Add batch action is attempted',async()=>{
  render(<ProgramsBatchesBoard {...props}/>);
  fireEvent.click(within(screen.getByRole('group',{name:'Junior competitive'})).getByRole('button',{name:'Add batch to Junior competitive'}));
  fireEvent.change(await screen.findByLabelText('Batch name'),{target:{value:'Unsaved morning group'}});
  const other=within(screen.getByRole('group',{name:'MP18 Court Sport'})).getByRole('button',{name:'Add batch to MP18 Court Sport'});
  expect(other).toHaveProperty('disabled',true);
  fireEvent.click(other);
  expect(screen.getByLabelText('Batch name')).toHaveProperty('value','Unsaved morning group');
  expect(screen.getByRole('combobox',{name:'Program'})).toHaveProperty('value','p1');
});
it('does not insert a new batch from a different site into the selected facility list',async()=>{
  const other={...props.initialBatches[0]!,id:'b2',name:'Other site batch',locationId:'swimming',locationName:'Swimming Centre'};
  createBatch.mockResolvedValue({ok:true,batch:other});
  render(<ProgramsBatchesBoard {...props} selectedFacilityId='badminton'/>);
  fireEvent.click(within(screen.getByRole('group',{name:'MP18 Court Sport'})).getByRole('button',{name:'Add batch to MP18 Court Sport'}));
  fireEvent.change(await screen.findByLabelText('Batch name'),{target:{value:'Other site batch'}});
  fireEvent.change(screen.getByRole('combobox',{name:'Location'}),{target:{value:'swimming'}});
  fireEvent.click(screen.getByRole('button',{name:'Add batch'}));
  await waitFor(()=>expect(createBatch).toHaveBeenCalledOnce());
  await waitFor(()=>expect(screen.queryByLabelText('Batch name')).toBeNull());
  expect(screen.queryByRole('link',{name:'Other site batch'})).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Swimming Centre');
});
it('requires an open delete confirmation to be resolved before starting a batch draft',()=>{
  render(<ProgramsBatchesBoard {...props} initialPrograms={[props.initialPrograms[0]!]} initialBatches={[]}/>);
  const row=screen.getByRole('group',{name:'Junior competitive'});
  fireEvent.click(within(row).getByRole('button',{name:'Delete Junior competitive'}));
  expect(within(row).getByRole('button',{name:'Confirm'})).toBeTruthy();
  expect(within(row).getByRole('button',{name:'Add batch to Junior competitive'})).toHaveProperty('disabled',true);
});
