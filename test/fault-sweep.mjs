/** Exhaustive simulated disconnects at mutation boundaries of one mixed operation.
 * Includes failures of the journal itself. This is a test adapter, not a real
 * power-loss/fsync guarantee for browser, OS or SD-card hardware.
 */
import {strict as assert} from 'node:assert';
import {MemoryFS} from './fake-fs.mjs';
import {FolderModel} from '../folder-model.js';
import {ArchiveModel} from '../model.js';
import {findRecoveries,recoverTransaction} from '../disk-io.js';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url),JSZip=require('../vendor/jszip.min.js');
const base={
 'apps/loader/boot.dol':'EXAMPLE APP',
 'config/original.txt':'ORIGINAL SETTINGS',
 'private/save.bin':'UNRELATED SAVED DATA',
 'wbfs/Old [DEME01]/DEME01.wbfs':'WBFS OLD GAME',
 'wbfs/Old [DEME01]/DEME01.wbf1':'OLD SPLIT PART',
 'wbfs/Old [DEME01]/readme.txt':'UNRELATED GAME NOTES'
};
const packageZip=new JSZip();packageZip.file('config/original.txt','NEW SETTINGS');packageZip.file('riivolution/Test.xml','<wiidisc/>');
const bytes=await packageZip.generateAsync({type:'uint8array'});
async function prepared(){
 const fs=new MemoryFS(base);let model=await FolderModel.open(fs.root);
 model=await model.removeItem(model.summary().games[0]);
 const pack=await ArchiveModel.load(bytes,'package.zip',JSZip);
 model=await model.addHack(pack,'Test',false);
 model=await model.addGames([new File(['WBFS NEW GAME'],'New [DEME02].wbfs')]);
 return {fs,model};
}
const mutation=new Set(['create','write','close','closed','remove','removed']);
const events=[];
{ const {fs,model}=await prepared();fs.hook=(event,path)=>{if(mutation.has(event))events.push({event,path});};assert.equal((await model.apply()).status,'completed'); }
let cut=0,rolledBack=0,finished=0,untouched=0;const manual=[];
for(const target of events){
 cut++;let index=0;const {fs,model}=await prepared();
 fs.hook=(event,path)=>{if(mutation.has(event)&&++index===cut){fs.online=false;throw new DOMException('Simulated disconnect','NotFoundError');}};
 try { await model.apply(); }catch { /* pre-journal disconnect can throw */ }
 fs.online=true;fs.hook=()=>{};
 let jobs=[],mode='none';
 try {
   jobs=await findRecoveries(fs.root);
   for(const job of jobs){const result=await recoverTransaction(fs.root,job);mode=result.status;}
 }catch(error){mode='manual';manual.push({cut,event:target.event,path:target.path.replace(/txn-[^/]+/g,'txn-ID'),reason:error.message.replace(/txn-[^/]+/g,'txn-ID')});}
 assert.equal(await fs.text('private/save.bin'),base['private/save.bin'],`save at cut ${cut}`);
 assert.equal(await fs.text('apps/loader/boot.dol'),base['apps/loader/boot.dol'],`app at cut ${cut}`);
 assert.equal(await fs.text('wbfs/Old [DEME01]/readme.txt'),base['wbfs/Old [DEME01]/readme.txt'],`notes at cut ${cut}`);
 const settings=await fs.text('config/original.txt');assert.ok(['ORIGINAL SETTINGS','NEW SETTINGS'].includes(settings),`settings damaged at cut ${cut}`);
 if(mode==='rolled-back'){
   rolledBack++;
   assert.equal(settings,'ORIGINAL SETTINGS',`restore at cut ${cut}`);
   assert.equal(await fs.text('wbfs/Old [DEME01]/DEME01.wbfs'),'WBFS OLD GAME');
   assert.equal(await fs.text('wbfs/Old [DEME01]/DEME01.wbf1'),'OLD SPLIT PART');
   assert.equal(await fs.text('wbfs/New [DEME02]/DEME02.wbfs'),undefined);
 }else if(mode==='completed'){
   finished++;
   assert.equal(settings,'NEW SETTINGS');assert.equal(await fs.text('wbfs/Old [DEME01]/DEME01.wbfs'),undefined);assert.equal(await fs.text('wbfs/Old [DEME01]/DEME01.wbf1'),undefined);
   assert.equal(await fs.text('wbfs/New [DEME02]/DEME02.wbfs'),'WBFS NEW GAME');
 }else if(mode==='none'){untouched++;}
}
const report={test:'simulated-disconnect-sweep',mutationBoundaries:events.length,passed:true,rolledBack,finished,withoutRemainingJournal:untouched,manualReviewStops:manual,
 limits:'File System Access test double. A conservative manual stop is expected when a newly created file exists before its identity was durably journaled, or the initial journal was never committed. Not an OS power-loss guarantee.'};
await mkdir(new URL('../docs/test-results/',import.meta.url),{recursive:true});await writeFile(new URL('../docs/test-results/fault-sweep.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
