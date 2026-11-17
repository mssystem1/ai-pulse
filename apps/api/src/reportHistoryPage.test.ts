import test from 'node:test';
import assert from 'node:assert/strict';
import {reportHistoryPage,type ReportHistoryRow} from './reportHistoryPage.js';
import type {ArchivedReport} from './recoveredReportArchive.js';
test('pages the complete archive by scope and keeps live reports without duplicate archive rows',()=>{
 const live:ReportHistoryRow[]=[{id:'job',reportId:'r0',mode:'spot',tier:'premium',stage:'completed',label:'BTC',createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z',ready:true}];
 const archive=Array.from({length:85},(_,i)=>({id:'archive:'+i,reportId:'r'+i,mode:i===84?'risk':'spot',tier:'premium',label:'Saved '+i,createdAt:new Date(Date.UTC(2026,10,1,0,i)).toISOString(),networkKey:null} as unknown as ArchivedReport));
 const pages=[0,30,60].map(offset=>reportHistoryPage(live,archive,'spot',offset));
 assert.deepEqual(pages.map(page=>page.reports.length),[30,30,24]);assert.equal(pages[0].total,84);assert.equal(pages[2].nextOffset,null);
 const all=pages.flatMap(page=>page.reports);assert.equal(new Set(all.map(row=>row.id)).size,84);assert.equal(all[0].id,'job');assert(!all.some(row=>row.id==='archive:0'));
 assert(all.filter(row=>row.archived).every(row=>row.ready&&row.networkUnknown));
 assert.equal(reportHistoryPage(live,archive,'risk').reports.length,1);
});
