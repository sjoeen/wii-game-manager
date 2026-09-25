/** Bounded-memory disk I/O. No game is read with a whole-file arrayBuffer().
 * A durable journal protects the reversible write phase. Reviewed removals are
 * permanent; after the deletion checkpoint recovery finishes, rather than
 * pretending that a whole-card transaction can be atomic in a browser.
 */
import {assertArchivePath, INTERNAL_ROOT, humanSize} from './core.js';

export const COPY_CHUNK = 4 * 1024 ** 2;
export const TRANSACTIONS_ROOT = `${INTERNAL_ROOT}transactions`;
const JOURNAL_LIMIT = 16 * 1024 ** 2;
const crcTable = Uint32Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crcUpdate(crc, bytes) {
  for (let i=0;i<bytes.length;i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
export function abortCheck(signal) {
  if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
}
export function statOf(file) { return {size:file.size, lastModified:file.lastModified}; }
export function sameStat(a,b) { return !!a && !!b && a.size===b.size && a.lastModified===b.lastModified; }
export function diskMessage(error) {
  if (error?.name==='QuotaExceededError') return 'Not enough free space. Free space in your file manager, or apply removals separately before additions.';
  if (error?.name==='NotAllowedError' || error?.name==='SecurityError') return 'Folder permission was denied or revoked. Reopen the folder and allow access.';
  if (error?.name==='NotFoundError') return 'A file or the selected drive is no longer available. Check the connection and reopen the folder.';
  if (error?.name==='AbortError') return 'Operation cancelled.';
  return error?.message || String(error);
}
export function sourceFromFile(file) { return {size:file.size, getBlob:async()=>file}; }
export function sourceFromHandle(handle, stat) {
  return {size:stat.size, async getBlob() {
    const file=await handle.getFile();
    if (!sameStat(stat,file)) throw new Error(`Source changed since selection: ${handle.name}. Reopen it before applying changes.`);
    return file;
  }};
}
export function sliceSource(source,start,end) {
  return {size:end-start, async getBlob() { return (await source.getBlob()).slice(start,end); }};
}

// Exact path lookup, with a case-insensitive collision check on creation. Never
// allow '..' or recursively delete a game folder. The browser controls handle access.
export async function directoryAt(root,path,create=false) {
  if (!path) return root;
  assertArchivePath(path);
  let dir=root;
  for (const part of path.split('/')) {
    try { dir=await dir.getDirectoryHandle(part); }
    catch (error) {
      if (error.name!=='NotFoundError' || !create) throw error;
      for await (const child of dir.values()) if (child.name.toLowerCase()===part.toLowerCase()) throw new Error(`Conflicting folder name: ${child.name}. Refresh the library.`);
      dir=await dir.getDirectoryHandle(part,{create:true});
    }
  }
  return dir;
}
export async function fileAt(root,path,create=false) {
  assertArchivePath(path);
  const parts=path.split('/'),name=parts.pop();
  const dir=await directoryAt(root,parts.join('/'),create);
  try { return await dir.getFileHandle(name); }
  catch(error) {
    if(error.name!=='NotFoundError'||!create)throw error;
    for await (const child of dir.values()) if(child.name.toLowerCase()===name.toLowerCase()) throw new Error(`Conflicting file name: ${child.name}. Refresh the library.`);
    return dir.getFileHandle(name,{create:true});
  }
}
export async function maybeFile(root,path) {
  try { return await fileAt(root,path); } catch(error) { if(error.name==='NotFoundError')return null; throw error; }
}
export async function removeFile(root,path) {
  assertArchivePath(path);
  const parts=path.split('/'),name=parts.pop();
  const parent=await directoryAt(root,parts.join('/'));
  // Guard against a file turning into a directory since the review.
  await parent.getFileHandle(name);
  await parent.removeEntry(name); // deliberately NOT recursive
}
export async function checksumBlob(blob,{signal,onProgress=()=>{},chunkSize=COPY_CHUNK}={}) {
  let crc=0xffffffff;
  for(let offset=0;offset<blob.size;offset+=chunkSize) {
    abortCheck(signal);
    const bytes=new Uint8Array(await blob.slice(offset,Math.min(offset+chunkSize,blob.size)).arrayBuffer());
    crc=crcUpdate(crc,bytes); onProgress(Math.min(offset+bytes.length,blob.size));
  }
  abortCheck(signal);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function streamCopy(source,destination,{signal,onProgress=()=>{},beforeClose=async()=>{},afterClose=async()=>{},chunkSize=COPY_CHUNK}={}) {
  if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>COPY_CHUNK)throw new Error('Invalid copy buffer size.');
  abortCheck(signal);
  const blob=await source.getBlob();
  if(blob.size!==source.size)throw new Error('The selected source has changed size.');
  const stream=await destination.createWritable({keepExistingData:false});
  let crc=0xffffffff;
  try {
    for(let offset=0;offset<blob.size;offset+=chunkSize) {
      abortCheck(signal);
      const bytes=new Uint8Array(await blob.slice(offset,Math.min(offset+chunkSize,blob.size)).arrayBuffer());
      crc=crcUpdate(crc,bytes);
      await stream.write(bytes); // await applies backpressure: one chunk at a time
      onProgress(Math.min(offset+bytes.length,blob.size),'copy');
    }
    abortCheck(signal);
    const checksum=(crc ^ 0xffffffff) >>> 0;
    await beforeClose(checksum);
    abortCheck(signal);
    await stream.close();
    const written=await destination.getFile();
    await afterClose(statOf(written));
    if(written.size!==source.size)throw new Error(`Write verification failed for ${destination.name}: wrong size.`);
    const actual=await checksumBlob(written,{signal,chunkSize,onProgress:n=>onProgress(n,'verify')});
    if(actual!==checksum)throw new Error(`Write verification failed for ${destination.name}: checksum mismatch.`);
    return {...statOf(written), checksum};
  } catch(error) {
    try { await stream.abort(); } catch { /* already committed or device lost */ }
    throw error;
  }
}
async function writeJSON(root,path,data) {
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  if(bytes.length>JOURNAL_LIMIT)throw new Error('Too many pending changes for one safe operation. Apply a smaller batch.');
  const handle=await fileAt(root,path,true),stream=await handle.createWritable({keepExistingData:false});
  try { await stream.write(bytes); await stream.close(); }
  catch(error) { try{await stream.abort();}catch{} throw error; }
}
function validateStat(stat) {
  return stat && Number.isSafeInteger(stat.size) && stat.size>=0 && Number.isFinite(stat.lastModified);
}
export function validateJournal(journal,id) {
  const fail=()=>{throw new Error('Recovery journal is invalid. Do not delete any game files; inspect the manager recovery folder with your backup.');};
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!journal||journal.version!==1||journal.id!==id||!['writing','rolling-back','deleting','complete','rolled-back'].includes(journal.phase)||!Array.isArray(journal.writes)||!Array.isArray(journal.deletes)||journal.writes.length+journal.deletes.length>50000)fail();
  const paths=new Set();
  const validatePath=path=>{
    assertArchivePath(path);
    if(path.toLowerCase().startsWith(`${TRANSACTIONS_ROOT}/`)||path.toLowerCase()===TRANSACTIONS_ROOT||paths.has(path.toLowerCase()))fail();
    paths.add(path.toLowerCase());
  };
  for(const [i,op] of journal.writes.entries()) {
    validatePath(op.path);
    if(!Number.isSafeInteger(op.size)||op.size<0||!['planned','backed-up','writing','written','verified','restored'].includes(op.status))fail();
    if(op.before!==null&&!validateStat(op.before))fail();
    if(op.backupPath!==`${TRANSACTIONS_ROOT}/${id}/old/${i}.bin`)fail();
    if(op.backup && (!validateStat(op.backup)||!Number.isInteger(op.backup.checksum)))fail();
    if(op.output && !validateStat(op.output))fail();
    if(op.placeholder && !validateStat(op.placeholder))fail();
    if(op.checksum!==null && !Number.isInteger(op.checksum))fail();
  }
  for(const op of journal.deletes) {
    validatePath(op.path);
    if(!validateStat(op.before)||!['planned','removing','removed'].includes(op.status))fail();
  }
  return journal;
}
export async function findRecoveries(root) {
  let dir;try{dir=await directoryAt(root,TRANSACTIONS_ROOT);}catch(error){if(error.name==='NotFoundError')return [];throw error;}
  const result=[];
  for await(const entry of dir.values()) {
    if(entry.kind!=='directory')continue;
    const handle=await maybeFile(root,`${TRANSACTIONS_ROOT}/${entry.name}/journal.json`);
    if(!handle)throw new Error(`An incomplete recovery folder has no journal: ${TRANSACTIONS_ROOT}/${entry.name}. Inspect it against your backup before removing that recovery folder manually.`);
    const file=await handle.getFile();
    if(file.size>JOURNAL_LIMIT)throw new Error('Recovery journal is too large.');
    let data;try{data=JSON.parse(await file.text());}catch{throw new Error('Could not read recovery journal. Keep your backup and inspect the recovery folder.');}
    result.push(validateJournal(data,entry.name));
  }
  return result;
}
async function cleanupTransaction(root,journal) {
  const dir=await directoryAt(root,TRANSACTIONS_ROOT);
  // Only the unique manager-owned transaction directory, never arbitrary paths.
  await dir.removeEntry(journal.id,{recursive:true});
}
async function assertUnchanged(root,path,expected) {
  const handle=await maybeFile(root,path),file=handle?await handle.getFile():null;
  if(expected ? !sameStat(expected,file) : !!file)throw new Error(`File changed since review: ${path}. No further files will be changed. Refresh or resolve recovery first.`);
  return handle;
}
function journalSaver(root,journal) {
  return ()=>writeJSON(root,`${TRANSACTIONS_ROOT}/${journal.id}/journal.json`,journal);
}
async function isContent(handle,size,checksum) {
  const file=await handle.getFile();
  return file.size===size && checksum!==null && (await checksumBlob(file))===checksum;
}
async function rollbackWrites(root,journal,onProgress=()=>{}) {
  journal.phase='rolling-back';const save=journalSaver(root,journal);await save();
  for(let i=journal.writes.length-1;i>=0;i--) {
    const op=journal.writes[i];
    if(['planned','backed-up','restored'].includes(op.status))continue;
    onProgress({phase:'rollback',path:op.path,done:journal.writes.length-1-i,total:journal.writes.length});
    const current=await maybeFile(root,op.path),file=current?await current.getFile():null;
    if(op.before) {
      if(!op.backup)throw new Error(`Cannot restore ${op.path}: its rollback backup is missing. Keep the recovery folder.`);
      const back=await fileAt(root,op.backupPath);
      if(!(await isContent(back,op.backup.size,op.backup.checksum)))throw new Error(`Rollback backup failed verification: ${op.path}. Keep your original backup.`);
      const alreadyOriginal=current && (sameStat(file,op.before)||await isContent(current,op.backup.size,op.backup.checksum));
      if(!alreadyOriginal) {
        const ours=current && (sameStat(file,op.output)||await isContent(current,op.size,op.checksum));
        if(!ours)throw new Error(`Recovery stopped: ${op.path} was changed outside this operation. Resolve it against your backup.`);
        await streamCopy(sourceFromHandle(back,statOf(await back.getFile())),current);
      }
    } else if(current) {
      const ours=sameStat(file,op.placeholder)||sameStat(file,op.output)||await isContent(current,op.size,op.checksum);
      if(!ours)throw new Error(`Recovery stopped: unexpected contents at ${op.path}. No unrelated file was deleted.`);
      await removeFile(root,op.path);
    }
    op.status='restored';await save();
  }
  journal.phase='rolled-back';await save();await cleanupTransaction(root,journal);
}
async function finishDeletes(root,journal,{signal,onProgress=()=>{},verifyWrites=true}={}) {
  const save=journalSaver(root,journal);
  // Verify committed writes before continuing permanent removals after a crash.
  for(const op of verifyWrites?journal.writes:[]) {
    const handle=await fileAt(root,op.path);
    if(!(await isContent(handle,op.size,op.checksum)))throw new Error(`Recovery stopped: written file has changed: ${op.path}. No more removals were made.`);
  }
  for(let i=0;i<journal.deletes.length;i++) {
    const op=journal.deletes[i];if(op.status==='removed')continue;
    abortCheck(signal);
    const handle=await maybeFile(root,op.path);
    if(!handle) {
      if(op.status!=='removing')throw new Error(`File disappeared before removal: ${op.path}. Review recovery before continuing.`);
    } else {
      await assertUnchanged(root,op.path,op.before);
      op.status='removing';await save();
      onProgress({phase:'remove',path:op.path,done:i,total:journal.deletes.length});
      await removeFile(root,op.path);
    }
    op.status='removed';await save();
  }
  journal.phase='complete';await save();await cleanupTransaction(root,journal);
}
export async function recoverTransaction(root,journal,options={}) {
  validateJournal(journal,journal.id);
  if(['complete','rolled-back'].includes(journal.phase)){await cleanupTransaction(root,journal);return {status:'cleaned'};}
  if(journal.phase==='deleting'){await finishDeletes(root,journal,options);return {status:'completed'};}
  await rollbackWrites(root,journal,options.onProgress);return {status:'rolled-back'};
}

/** Called only after UI review + explicit write permission. */
export async function applyDiskPlan(root,plan,{signal,onProgress=()=>{},preflight=async()=>{}}={}) {
  if(!plan.writes.length&&!plan.deletes.length)return {status:'unchanged'};
  if((await findRecoveries(root)).length)throw new Error('Resolve the previous interrupted operation before applying new changes.');
  abortCheck(signal);await preflight();
  for(const op of [...plan.writes,...plan.deletes])await assertUnchanged(root,op.path,op.before);
  abortCheck(signal);
  const id=`txn-${Date.now().toString(36)}-${globalThis.crypto.randomUUID()}`;
  const journal={version:1,id,phase:'writing',createdAt:new Date().toISOString(),
    writes:plan.writes.map((op,i)=>({path:op.path,size:op.size,before:op.before,backupPath:`${TRANSACTIONS_ROOT}/${id}/old/${i}.bin`,backup:null,placeholder:null,output:null,checksum:null,status:'planned'})),
    deletes:plan.deletes.map(op=>({path:op.path,before:op.before,status:'planned'}))};
  validateJournal(journal,id);
  const save=journalSaver(root,journal);
  // No library write occurs until a complete journal exists on disk.
  try { await save(); }
  catch(error) {
    try{await cleanupTransaction(root,journal);}catch{}
    throw new Error(`Could not create recovery journal. No library files were changed. ${diskMessage(error)}`);
  }
  try {
    // Back up replacements first. New files and permanent deletions need no
    // same-size rollback copy; removing games from a full card stays practical.
    for(let i=0;i<journal.writes.length;i++) {
      const op=journal.writes[i];abortCheck(signal);
      if(op.before) {
        const original=await assertUnchanged(root,op.path,op.before);
        const backup=await fileAt(root,op.backupPath,true);
        op.backup=await streamCopy(sourceFromHandle(original,op.before),backup,{signal,onProgress:(done,step)=>onProgress({phase:`backup-${step}`,path:op.path,done,total:op.before.size})});
      }
      op.status='backed-up';await save();
    }
    for(let i=0;i<journal.writes.length;i++) {
      const op=journal.writes[i],input=plan.writes[i];abortCheck(signal);
      await assertUnchanged(root,op.path,op.before);
      // Resolve source before creating the target, so unavailable files cannot
      // leave an unexpected empty game behind.
      const blob=await input.source.getBlob();
      op.status='writing';await save();
      const handle=await fileAt(root,op.path,true);
      if(!op.before){op.placeholder=statOf(await handle.getFile());await save();}
      const result=await streamCopy(sourceFromFile(blob),handle,{signal,
        onProgress:(done,step)=>onProgress({phase:step,path:op.path,done,total:op.size,index:i+1,count:journal.writes.length}),
        beforeClose:async checksum=>{op.checksum=checksum;await save();},
        afterClose:async stat=>{op.output=stat;op.status='written';await save();}});
      op.output=statOf(result);op.status='verified';await save();
    }
    // Last cancellation point before the irreversible deletion checkpoint.
    abortCheck(signal);
    // Recheck EVERY deletion before committing any. Deletes then run without
    // cancellation, avoiding an unnecessary halfway stop on a healthy drive.
    for(const op of journal.deletes)await assertUnchanged(root,op.path,op.before);
    journal.phase='deleting';await save();
    onProgress({phase:'commit',path:'Finishing reviewed changes',done:0,total:1});
    await finishDeletes(root,journal,{onProgress,verifyWrites:false});
    return {status:'completed',written:journal.writes.length,removed:journal.deletes.length};
  } catch(error) {
    if(journal.phase==='writing'||journal.phase==='rolling-back') {
      try {
        await rollbackWrites(root,journal,onProgress);
        return {status:error.name==='AbortError'?'cancelled':'rolled-back',message:`${diskMessage(error)} The write phase was rolled back; no reviewed removals were started.`,written:0,removed:0};
      } catch(rollbackError) {
        return {status:'recovery-needed',message:`${diskMessage(error)} Automatic recovery could not finish: ${diskMessage(rollbackError)} Reconnect the drive, reopen this folder, and use Review recovery.`,journal};
      }
    }
    return {status:'recovery-needed',message:`Some reviewed changes may already be applied. ${diskMessage(error)} Reopen this folder and use Review recovery to finish the recorded operation; do not delete its recovery files.`,journal};
  }
}
