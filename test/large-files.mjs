/** Optional real-disk large-file test. Needs ~8 GiB temporary disk, not 8 GiB RAM.
 * Run: node --max-old-space-size=192 test/large-files.mjs
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {NativeFS} from './native-fs.mjs';
import {FolderModel} from '../folder-model.js';
import {COPY_CHUNK} from '../disk-io.js';
const GiB=1024**3,MiB=1024**2,root=await fs.mkdtemp(path.join(os.tmpdir(),'wii-real-large-'));
let peakRSS=process.memoryUsage().rss;const start=Date.now();
const sample=()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);};
const timer=setInterval(sample,20);
const hash=async paths=>{const h=createHash('sha256');for(const p of paths)for await(const b of createReadStream(p,{highWaterMark:COPY_CHUNK}))h.update(b);return h.digest('hex');};
async function sparse(file,size) {await fs.mkdir(path.dirname(file),{recursive:true});const f=await fs.open(file,'w');await f.truncate(size);await f.write(Buffer.from('WBFS'),0,4,0);await f.write(Buffer.from('TAIL'),0,4,size-4);await f.close();}
const report={test:'actual-disk-large-files',node:process.version,bufferBytes:COPY_CHUNK,heapLimitMiB:192,results:[]};
try {
 const card=path.join(root,'card');await fs.mkdir(path.join(card,'apps/loader'),{recursive:true});await fs.writeFile(path.join(card,'apps/loader/boot.dol'),'SYNTHETIC APP, NOT EXECUTABLE');
 for(let i=0;i<8;i++)await sparse(path.join(card,`wbfs/Game ${i} [GM000${i}]/GM000${i}.wbfs`),3*GiB);
 const adapter=new NativeFS(card);let model=await FolderModel.open(adapter.root);
 assert.equal(model.summary().games.length,8);assert.ok(model.summary().total>24*GiB);
 console.log('Finished test step',report.results.length+1);
 report.results.push({name:'24 GiB existing library inventory',passed:true,games:8,totalBytes:model.summary().total,note:'Eight actual sparse files; only metadata is scanned.'});
 const source=path.join(root,'Large [BIG001].wbfs'),size=2*GiB+32*MiB;await sparse(source,size);
 const input=await adapter.blob(source,path.basename(source));
 model=await model.addGames([input]);assert.equal(model.plan().writes.length,1);
 const r=await model.apply({onProgress:sample});assert.equal(r.status,'completed');
 const out=path.join(card,'wbfs/Large [BIG001]/BIG001.wbfs');assert.equal((await fs.stat(out)).size,size);assert.equal(await hash([out]),await hash([source]));
 console.log('Finished test step',report.results.length+1);
 report.results.push({name:'2.03125 GiB game copy + readback verification',passed:true,bytes:size,result:r,sha256:await hash([out])});
 // Real 5 GiB input exercises production automatic split offsets, byte-for-byte.
 const bigger=path.join(root,'Dual Layer [BIG002].wbfs'),splitSize=5*GiB;await sparse(bigger,splitSize);
 model=await FolderModel.open(adapter.root);model=await model.addGames([await adapter.blob(bigger,path.basename(bigger))]);
 assert.equal(model.plan().writes.length,3);const splitResult=await model.apply({onProgress:sample});assert.equal(splitResult.status,'completed');
 const parts=['wbfs','wbf1','wbf2'].map(ext=>path.join(card,`wbfs/Dual Layer [BIG002]/BIG002.${ext}`));
 assert.deepEqual(await Promise.all(parts.map(async p=>(await fs.stat(p)).size)),[2*GiB,2*GiB,GiB]);
 assert.equal(await hash(parts),await hash([bigger]));
 console.log('Finished test step',report.results.length+1);
 report.results.push({name:'5 GiB WBFS streamed into 2 + 2 + 1 GiB split set',passed:true,bytes:splitSize,sha256:await hash(parts)});
 assert.ok(adapter.maxChunk<=COPY_CHUNK);sample();assert.ok(peakRSS<512*MiB,`Peak RSS was ${peakRSS}`);
 report.maxObservedWriteBytes=adapter.maxChunk;report.peakProcessRSSBytes=peakRSS;report.durationSeconds=(Date.now()-start)/1000;
 report.limits='Real temporary disk files and synthetic WBFS headers/data through a Node File System Access adapter. Not physical Wii, FAT32, browser picker, or playable-game validation.';
 const results=path.resolve('docs/test-results');await fs.mkdir(results,{recursive:true});await fs.writeFile(path.join(results,'large-files.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} finally {clearInterval(timer);await fs.rm(root,{recursive:true,force:true});}
