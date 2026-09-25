/** Existing-card manager. Inventory = metadata + handles; pending additions =
 * lazy Blob references. There is no ZIP32 limit on a folder's combined size.
 */
import {APP_MANIFEST, INTERNAL_ROOT, assertArchivePath, humanSize, extOf, stem, gameDestination, detectGames, detectRiivolutionHacks, stripTop, validateManifest} from './core.js';
import {TRANSACTIONS_ROOT, abortCheck, sourceFromFile, sourceFromHandle, sliceSource, statOf, sameStat, findRecoveries, applyDiskPlan} from './disk-io.js';

export const FAT32_FILE_LIMIT = 0xffffffff;
export const WBFS_SPLIT_SIZE = 2 * 1024 ** 3;
export const MAX_HACK_PACKAGE = 256 * 1024 ** 2;
const MB_FOLDER = 1024 ** 2;
const rootNames = new Set(['apps','wbfs','riivolution','wiiflow','usb-loader','games','codes','bootmii']);
const skippedNames = new Set(['system volume information','$recycle.bin','.trashes','.spotlight-v100','.fseventsd']);
export function hasWiiLayout(paths) {
  return paths.some(path=>rootNames.has(path.split('/')[0].toLowerCase()));
}
export function assertDiskPath(path) {
  assertArchivePath(path);
  for(const part of path.split('/')) {
    if(/[<>"|?*]/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw new Error(`Not a portable SD-card path: ${path}`);
    if(part.length>240)throw new Error(`File name is too long for safe SD-card use: ${path}`);
  }
  if(path.length>1024)throw new Error('SD-card path is too long.');
  return path;
}
export async function scanFolder(root,{signal,onProgress=()=>{}}={}) {
  const files=new Map(),dirs=new Map(),seen=new Map(),skipped=[];
  const stack=[{dir:root,prefix:''}];let count=0;
  while(stack.length) {
    abortCheck(signal);const {dir,prefix}=stack.pop();
    for await(const handle of dir.values()) {
      abortCheck(signal);
      const path=prefix+handle.name,lower=path.toLowerCase();
      if(!prefix&&skippedNames.has(lower)){skipped.push(path);continue;}
      // Recovery has its own strict parser. Never expose its files to game edits.
      if(lower===TRANSACTIONS_ROOT)continue;
      assertDiskPath(path);
      if(seen.has(lower))throw new Error(`Case-conflicting files/folders: ${seen.get(lower)} and ${path}. Rename them in your file manager first.`);
      seen.set(lower,path);
      if(++count>200000)throw new Error('This folder has over 200,000 entries. Select just the Wii card root, not a parent drive or backup collection.');
      if(handle.kind==='directory') {
        dirs.set(lower,path);stack.push({dir:handle,prefix:`${path}/`});
      } else if(handle.kind==='file') {
        const file=await handle.getFile();
        if(!Number.isSafeInteger(file.size)||file.size<0)throw new Error(`Unsupported file size: ${path}`);
        const entry={path,size:file.size,lastModified:file.lastModified,handle,source:sourceFromHandle(handle,statOf(file))};
        files.set(path,entry);
      } else throw new Error(`Unsupported filesystem entry: ${path}`);
      if(count%50===0)onProgress({count,path});
    }
  }
  onProgress({count,path:''});
  return {files,dirs,skipped};
}
function serialManifest(data) {
  return sourceFromFile(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
}
function protectItem(item,manifest) {
  if(!item?.paths?.length)throw new Error('The selected item no longer exists.');
  const allOwned=new Set(manifest.hacks.filter(h=>h.id!==item.manifestId).flatMap(h=>h.paths).map(p=>p.toLowerCase()));
  if(item.paths.some(p=>allOwned.has(p.toLowerCase())))throw new Error('A tracked ROM-hack package owns some of these files. Remove that package first.');
}

export class FolderModel {
  constructor(root,inventory,manifest={version:1,hacks:[]}) {
    this.kind='folder';this.root=root;this.name=root.name||'Selected Wii folder';
    this.original=inventory.files;this.files=new Map(inventory.files);this.dirs=inventory.dirs;
    this.skipped=inventory.skipped;this.manifest=manifest;this.dirty=false;
    this.isDemo=false;this.crcChecked=false;this.recoveries=[];this.notes=[];
    this.fat32=true;
  }
  static async open(root,options={}) {
    if(!root||root.kind!=='directory')throw new Error('Select your existing Wii SD/USB root folder.');
    const recoveries=await findRecoveries(root);
    const inventory=await scanFolder(root,options);
    if(!hasWiiLayout([...inventory.files.keys(),...inventory.dirs.values()])&&!recoveries.length) {
      throw new Error('This does not look like an existing Wii card folder. Select the root containing apps, wbfs, riivolution, or your loader folders—not an empty folder or the folder above your card. This manager does not install homebrew.');
    }
    const model=new FolderModel(root,inventory);model.recoveries=recoveries;
    const manifestEntry=[...inventory.files.values()].find(f=>f.path.toLowerCase()===APP_MANIFEST);
    if(manifestEntry) {
      if(manifestEntry.path!==APP_MANIFEST)throw new Error('The manager manifest must keep its original lower-case path.');
      if(manifestEntry.size>4*MB_FOLDER)throw new Error('The manager manifest is unexpectedly large.');
      try { model.manifest=validateManifest(JSON.parse(await (await manifestEntry.handle.getFile()).text())); }
      catch(error) { if(!recoveries.length)throw new Error(`Cannot safely read the manager manifest: ${error.message}`);model.notes.push('Manifest needs recovery before editing.'); }
    }
    return model;
  }
  clone() {
    const copy=Object.assign(Object.create(Object.getPrototypeOf(this)),this);
    copy.files=new Map(this.files);copy.manifest=structuredClone(this.manifest);copy.notes=[...this.notes];
    return copy;
  }
  entries() { return [...this.files.values()].map(f=>({path:f.path,size:f.size})); }
  summary() {
    const files=this.entries();
    return {files,games:detectGames(files),hacks:detectRiivolutionHacks(files,this.manifest),total:files.reduce((n,f)=>n+f.size,0)};
  }
  outerFolder() { return ''; }
  ensureEditable() { if(this.recoveries.length)throw new Error('Resolve the interrupted operation before making new edits.'); }
  canonicalPath(path) {
    assertDiskPath(path);const parts=path.split('/');
    for(let i=1;i<parts.length;i++) {
      const lower=parts.slice(0,i).join('/').toLowerCase();
      const actual=this.dirs.get(lower);
      if(actual)parts.splice(0,i,...actual.split('/'));
    }
    const lower=parts.join('/').toLowerCase();
    return [...this.files.keys()].find(p=>p.toLowerCase()===lower)||parts.join('/');
  }
  put(path,source) {
    this.ensureEditable();path=this.canonicalPath(path);
    const lower=path.toLowerCase();
    if(lower===TRANSACTIONS_ROOT||lower.startsWith(`${TRANSACTIONS_ROOT}/`))throw new Error('The recovery area is reserved.');
    if(this.dirs.has(lower)||[...this.files.keys()].some(p=>p.toLowerCase().startsWith(`${lower}/`)))throw new Error(`A directory blocks this file: ${path}`);
    const parts=path.split('/');
    for(let i=1;i<parts.length;i++)if([...this.files.keys()].some(p=>p.toLowerCase()===parts.slice(0,i).join('/').toLowerCase()))throw new Error(`A file blocks the folder for ${path}`);
    if(!Number.isSafeInteger(source.size)||source.size<0)throw new Error(`Invalid file size: ${path}`);
    if(this.fat32&&source.size>FAT32_FILE_LIMIT)throw new Error(`${path} is larger than FAT32 permits for one file. Use an appropriate split-WBFS game; the combined library has no 4 GiB cap.`);
    const baseline=this.original.get(path);
    this.files.set(path,baseline?.source===source?baseline:{path,size:source.size,source});
    return path;
  }
  drop(path) { this.ensureEditable();this.files.delete(path); }
  syncManifest() {
    if(this.manifest.hacks.length)this.put(APP_MANIFEST,serialManifest(this.manifest));
    else this.drop(APP_MANIFEST);
  }
  checkBudget() {
    // No combined ZIP limit here. Only valid sizes and explicit FAT32 writes.
    for(const op of this.plan().writes)if(this.fat32&&op.size>FAT32_FILE_LIMIT)throw new Error(`FAT32 per-file limit exceeded: ${op.path}`);
  }
  async addGames(files) {
    this.ensureEditable();if(!files.length)return this;
    const next=this.clone(),knownIds=new Set(this.summary().games.map(g=>g.id).filter(Boolean));
    const mains=files.filter(f=>/^(wbfs|iso)$/.test(extOf(f.name)));
    const splits=files.filter(f=>/^wbf\d+$/.test(extOf(f.name)));
    if(mains.length+splits.length!==files.length||!mains.length)throw new Error('Select .wbfs/.iso files, with every matching .wbf1/.wbf2 part for split WBFS.');
    for(const f of splits)if(!mains.some(m=>extOf(m.name)==='wbfs'&&stem(m.name).toLowerCase()===stem(f.name).toLowerCase()))throw new Error(`Missing matching .wbfs for ${f.name}. Select all parts together.`);
    for(const main of mains) {
      if(!main.size)throw new Error(`${main.name} is empty.`);
      const dest=gameDestination(main.name);
      if(dest.id&&knownIds.has(dest.id))throw new Error(`Game ${dest.id} is already in this library or selection. It will not be overwritten.`);
      if(dest.id)knownIds.add(dest.id);
      const companions=extOf(main.name)==='wbfs'?splits.filter(f=>stem(f.name).toLowerCase()===stem(main.name).toLowerCase()):[];
      const numbers=companions.map(f=>Number(extOf(f.name).slice(3))).sort((a,b)=>a-b);
      if(numbers.some((n,i)=>n!==i+1))throw new Error(`Split parts for ${main.name} must start at .wbf1 without gaps or duplicates.`);
      let members=[main,...companions].map(f=>({path:f===main?dest.path:dest.path.replace(/\.wbfs$/i,`.${extOf(f.name)}`),source:sourceFromFile(f)}));
      if(this.fat32&&main.size>FAT32_FILE_LIMIT) {
        if(extOf(main.name)==='iso')throw new Error(`${main.name} is too large for one FAT32 file. Convert your own disc image to WBFS with a suitable tool first, then add the .wbfs and all split parts. This manager does not convert ISO to WBFS.`);
        if(companions.length)throw new Error('One of the pre-split WBFS files is still too large. Create a correctly sized split set before adding it.');
        const header=new Uint8Array(await main.slice(0,4).arrayBuffer());
        if(String.fromCharCode(...header)!=='WBFS')throw new Error('The oversized file does not have a WBFS header. Renaming an ISO to .wbfs does not convert it.');
        if(main.size>32*1024**3)throw new Error('This does not appear to be a single Wii WBFS game (over 32 GiB). Check the source file.');
        const src=sourceFromFile(main);members=[];
        for(let start=0,index=0;start<main.size;start+=WBFS_SPLIT_SIZE,index++)members.push({path:index?dest.path.replace(/\.wbfs$/i,`.wbf${index}`):dest.path,source:sliceSource(src,start,Math.min(start+WBFS_SPLIT_SIZE,main.size))});
        next.notes.push(`${main.name} will be copied as ${members.length} byte-contiguous WBFS parts of at most 2 GiB each. The source is unchanged.`);
      }
      for(const member of members) {
        const path=next.canonicalPath(member.path),lower=path.toLowerCase();
        if([...next.files.keys()].some(p=>p.toLowerCase()===lower))throw new Error(`A file already exists at ${path}. No games were staged.`);
        if([...this.original.keys()].some(p=>p.toLowerCase()===lower))throw new Error(`Apply the removal of ${path} first, then add its replacement in a separate operation.`);
        next.put(path,member.source);
      }
    }
    next.checkBudget();next.dirty=!!(next.plan().writes.length+next.plan().deletes.length);return next;
  }
  packagePlan(packageModel,stripRoot=true) {
    this.ensureEditable();
    if(packageModel.summary().total>MAX_HACK_PACKAGE)throw new Error('ROM-hack ZIP mode is limited to 256 MiB uncompressed per package. It is not the route for multi-gigabyte patched games; add their .wbfs/.iso files with Add game.');
    const top=stripRoot?packageModel.outerFolder():'';
    const managed=new Set(this.manifest.hacks.flatMap(h=>h.paths).map(p=>p.toLowerCase()));
    const byLower=new Map([...this.files.keys()].map(p=>[p.toLowerCase(),p]));const seen=new Set();
    const plan=packageModel.entries().map(f=>{
      const dest=this.canonicalPath(stripTop(f.path,top));assertDiskPath(dest);const lower=dest.toLowerCase();
      if(lower.startsWith(INTERNAL_ROOT)||lower===INTERNAL_ROOT.slice(0,-1))throw new Error('Packages cannot replace manager metadata or recovery files.');
      if(managed.has(lower))throw new Error(`A tracked package already owns ${dest}. Remove that package first.`);
      if(seen.has(lower))throw new Error(`Duplicate package destination: ${dest}`);seen.add(lower);
      if(this.dirs.has(lower)||[...byLower.keys()].some(p=>p.startsWith(`${lower}/`)))throw new Error(`A folder already exists at ${dest}.`);
      const parts=dest.split('/');
      for(let i=1;i<parts.length;i++)if(byLower.has(parts.slice(0,i).join('/').toLowerCase()))throw new Error(`A file blocks the folder for ${dest}`);
      return {src:f.path,dest,size:f.size,existing:byLower.get(lower)||''};
    });
    if(!plan.length)throw new Error('This package has no files.');return plan;
  }
  async addHack(packageModel,name,stripRoot=true,progress=()=>{}) {
    const plan=this.packagePlan(packageModel,stripRoot),next=this.clone();
    const id=`hack-${globalThis.crypto.randomUUID()}`;
    const record={id,name:String(name||'ROM Hack').trim().slice(0,80)||'ROM Hack',paths:[],backups:[],addedAt:new Date().toISOString()};
    for(const [i,p] of plan.entries()) {
      if(p.existing) {
        const original=this.files.get(p.existing),backupPath=`${INTERNAL_ROOT}backups/${id}/${p.existing}`;
        next.put(backupPath,original.source);record.backups.push({path:p.existing,backupPath});
      }
      // At most one bounded package entry is decompressed when it is copied.
      // The 256 MiB package budget is independent of the card/library size.
      const zipFile=packageModel.zip.file(p.src);
      next.put(p.dest,{size:p.size,async getBlob(){const blob=await zipFile.async('blob');if(blob.size!==p.size)throw new Error(`Package size mismatch: ${p.src}`);return blob;}});
      record.paths.push(p.dest);progress((i+1)/plan.length*100);
    }
    next.manifest.hacks.push(record);next.syncManifest();next.checkBudget();next.dirty=true;return next;
  }
  async removeItem(item) {
    this.ensureEditable();protectItem(item,this.manifest);const next=this.clone();
    for(const path of item.paths)next.drop(path);
    if(item.manifestId) {
      const h=this.manifest.hacks.find(h=>h.id===item.manifestId);
      if(!h)throw new Error('The ROM-hack record is missing.');
      for(const backup of h.backups||[]) {
        const original=this.files.get(backup.backupPath);
        if(!original)throw new Error(`A required backup is missing: ${backup.path}. Removal was not staged.`);
        next.put(backup.path,original.source);next.drop(backup.backupPath);
      }
      next.manifest.hacks=next.manifest.hacks.filter(h=>h.id!==item.manifestId);next.syncManifest();
    }
    next.dirty=!!(next.plan().writes.length+next.plan().deletes.length);return next;
  }
  plan() {
    const writes=[],deletes=[];
    for(const [path,entry] of this.files)if(this.original.get(path)!==entry)writes.push({path,size:entry.size,source:entry.source,before:this.original.has(path)?statOf(this.original.get(path)):null});
    for(const [path,entry] of this.original)if(!this.files.has(path))deletes.push({path,size:entry.size,before:statOf(entry)});
    // Preserve package originals before overwriting their source paths. The
    // manifest is committed after the package data; removals are always last.
    const rank=op=>op.path.startsWith(`${INTERNAL_ROOT}backups/`)?0:op.path===APP_MANIFEST?2:1;
    writes.sort((a,b)=>rank(a)-rank(b)||a.path.localeCompare(b.path));
    deletes.sort((a,b)=>Number(a.path.startsWith(INTERNAL_ROOT))-Number(b.path.startsWith(INTERNAL_ROOT))||a.path.localeCompare(b.path));
    const copyBytes=writes.reduce((n,p)=>n+p.size,0),backupBytes=writes.reduce((n,p)=>n+(p.before?.size||0),0),deleteBytes=deletes.reduce((n,p)=>n+p.size,0);
    return {writes,deletes,copyBytes,backupBytes,deleteBytes,extraSpaceEstimate:copyBytes+backupBytes+writes.reduce((n,p)=>Math.max(n,p.size),0)+4*MB_FOLDER};
  }
  async apply(options={}) {
    this.ensureEditable();this.checkBudget();const plan=this.plan();
    return applyDiskPlan(this.root,plan,{...options,preflight:async()=>{
      const current=await scanFolder(this.root,{signal:options.signal});
      if(current.files.size!==this.original.size)throw new Error('The folder changed since it was opened. Discard pending edits and refresh before applying.');
      for(const [path,original] of this.original)if(!sameStat(original,current.files.get(path)))throw new Error(`Folder contents changed: ${path}. Refresh the library before applying.`);
      for(const op of plan.writes) {
        const lower=op.path.toLowerCase();
        if(current.dirs.has(lower))throw new Error(`A folder appeared at ${op.path}. Refresh before applying.`);
      }
    }});
  }
}
