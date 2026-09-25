import {APP_MANIFEST, INTERNAL_ROOT, ZIP32_LIMIT, assertArchivePath, humanSize, extOf, stem, gameDestination, detectGames, detectRiivolutionHacks, shouldStripPackageRoot, stripTop, validateManifest} from './core.js';

const encoder = new TextEncoder();
const MB = 1024 ** 2;

/** Validate before showing or merging any ZIP paths. Nothing is silently discarded. */
export function inspectZip(zip) {
  const byLower = new Map(), entries = [];
  let total = 0;
  for (const file of Object.values(zip.files)) {
    const original = file.unsafeOriginalName || file.name;
    assertArchivePath(original);
    const path = assertArchivePath(file.name);
    if (original.replace(/\/$/, '') !== path) throw new Error(`The ZIP contains a sanitized or ambiguous path: ${original}`);
    const lower = path.toLowerCase();
    if (byLower.has(lower)) throw new Error(`Case-conflicting archive paths: ${byLower.get(lower)} and ${path}. Rename them before importing.`);
    byLower.set(lower, path);
    const mode = typeof file.unixPermissions === 'number' ? file.unixPermissions : parseInt(file.unixPermissions || '0', 8);
    if ((mode & 0xf000) === 0xa000) throw new Error(`Symbolic links are not supported: ${path}`);
    if (!file.dir) {
      const size = Number(file._data?.uncompressedSize ?? 0);
      if (!Number.isSafeInteger(size) || size < 0 || size >= ZIP32_LIMIT) throw new Error(`Unsupported size for ${path}`);
      entries.push({path, size}); total += size;
    }
  }
  // Reject a file that would also need to be a directory on the SD card.
  for (const {path} of entries) {
    const parts = path.split('/');
    for (let i=1; i<parts.length; i++) {
      const prefix = parts.slice(0,i).join('/').toLowerCase();
      const actual = byLower.get(prefix);
      if (actual && zip.files[actual] && !zip.files[actual].dir) throw new Error(`A file conflicts with a folder: ${actual}`);
    }
  }
  if (Object.keys(zip.files).length >= 60000) throw new Error('This browser build supports fewer than 60,000 ZIP entries. Use a smaller archive.');
  if (total >= ZIP32_LIMIT - 16 * MB) throw new Error('This in-memory build requires an archive smaller than 4 GiB uncompressed. Use a smaller SD archive; large Wii libraries need a streaming/desktop manager.');
  return {entries, total};
}

export class ArchiveModel {
  constructor(zip, name, sizes, manifest = {version:1,hacks:[]}) {
    this.zip = zip; this.name = name; this.sizes = sizes; this.manifest = manifest;
    this.dirty = false; this.isDemo = false; this.crcChecked = false;
  }
  /** A real empty archive, not a demo or an installer. No games are required. */
  static createEmpty(name = 'New-SD-card.zip', ZIP = globalThis.JSZip) {
    if (!ZIP) throw new Error('The bundled ZIP library did not load. Reopen the standalone HTML in a browser.');
    const model = new ArchiveModel(new ZIP(), name, new Map());
    // There is no imported data to integrity-check.
    model.crcChecked = true;
    return model;
  }
  static async load(data, name = 'SD-card.zip', ZIP = globalThis.JSZip) {
    if (!ZIP) throw new Error('The bundled ZIP library did not load. Reopen the standalone HTML in a browser.');
    if (data.size >= ZIP32_LIMIT) throw new Error('This ZIP is too large for this in-memory build (4 GiB limit).');
    const zip = await ZIP.loadAsync(data, {createFolders:false, checkCRC32:false});
    const inspection = inspectZip(zip);
    // Small archives get a full CRC check after size preflight. Do not inflate multi-GB cards just to list them.
    const crcChecked = inspection.total <= 64 * MB;
    if (crcChecked) await ZIP.loadAsync(data, {createFolders:false, checkCRC32:true});
    const model = new ArchiveModel(zip, name, new Map(inspection.entries.map(f=>[f.path,f.size])));
    model.crcChecked = crcChecked;
    await model.readManifest();
    return model;
  }
  async readManifest() {
    const matching = this.entries().find(f=>f.path.toLowerCase()===APP_MANIFEST);
    if (!matching) { this.manifest = {version:1,hacks:[]}; return; }
    if (matching.path !== APP_MANIFEST) throw new Error('The manager manifest must use its original lower-case path.');
    if (matching.size > 4 * MB) throw new Error('The manager manifest is unexpectedly large.');
    let data;
    try { data = JSON.parse(await this.zip.file(APP_MANIFEST).async('string')); }
    catch { throw new Error('The manager manifest is not valid JSON. No changes were made.'); }
    this.manifest = validateManifest(data);
  }
  entries() { return Object.values(this.zip.files).filter(f=>!f.dir).map(f=>({path:f.name, size:this.sizes.get(f.name) ?? f._data?.uncompressedSize ?? 0})); }
  summary() {
    const files = this.entries();
    return {files, games:detectGames(files), hacks:detectRiivolutionHacks(files,this.manifest), total:files.reduce((n,x)=>n+x.size,0)};
  }
  clone() {
    const zip = Object.assign(Object.create(Object.getPrototypeOf(this.zip)), this.zip);
    zip.files = Object.assign(Object.create(null), this.zip.files); zip.comment = this.zip.comment;
    const next = new ArchiveModel(zip,this.name,new Map(this.sizes),JSON.parse(JSON.stringify(this.manifest)));
    next.isDemo=this.isDemo; next.crcChecked=this.crcChecked; next.dirty=this.dirty;
    return next;
  }
  put(path, data, size, options = {}) {
    assertArchivePath(path);
    this.zip.file(path,data,{createFolders:false,binary:typeof data!=='string',compression:'STORE',...options});
    this.sizes.set(path,size);
  }
  drop(path) { delete this.zip.files[path]; this.sizes.delete(path); }
  syncManifest() {
    if (this.manifest.hacks.length) {
      const text=JSON.stringify(this.manifest,null,2);
      this.put(APP_MANIFEST,text,encoder.encode(text).length,{compression:'DEFLATE'});
    } else this.drop(APP_MANIFEST);
  }
  outerFolder() {
    // Include empty directories: an SD card with no games may contain only
    // SD/apps/ and SD/wbfs/. Ignore the wrapper's own directory entry, but
    // never strip a real SD root or a ZIP containing multiple top-level roots.
    const paths = Object.values(this.zip.files).map(f=>f.name.replace(/\/$/, ''));
    const roots = new Set(paths.map(p=>p.split('/')[0]));
    if (roots.size !== 1) return '';
    const [top] = roots;
    return shouldStripPackageRoot(paths.filter(p=>p !== top));
  }
  async stripOuterFolder(top) {
    if (!top || this.outerFolder() !== top) throw new Error('The selected outer folder is not a recognized SD-card wrapper.');
    const next = this.clone(); next.zip.files=Object.create(null); next.sizes=new Map();
    for (const f of Object.values(this.zip.files)) {
      if (f.name === `${top}/`) continue;
      const path = stripTop(f.name,top);
      const copy = Object.assign(Object.create(Object.getPrototypeOf(f)),f,{name:path});
      next.zip.files[path]=copy;
      if (!f.dir) next.sizes.set(path,this.sizes.get(f.name)??f._data?.uncompressedSize??0);
    }
    await next.readManifest(); next.dirty=true; return next;
  }
  checkBudget() {
    const files=this.entries(); const count=Object.keys(this.zip.files).length;
    const estimate=files.reduce((n,f)=>n+f.size+encoder.encode(f.path).length*2+256,65536);
    if (count>=60000 || estimate>=ZIP32_LIMIT-16*MB) throw new Error('The result is too large for safe ZIP32 export in this build. Remove files or use a smaller archive.');
  }
  addGames(files) {
    if (!files.length) return this;
    const next=this.clone(), existing=this.summary().games;
    const knownIds=new Set(existing.map(g=>g.id).filter(Boolean));
    const occupied=new Map(Object.keys(next.zip.files).map(p=>[p.toLowerCase().replace(/\/$/,''),p]));
    const mains=files.filter(f=>/^(wbfs|iso)$/.test(extOf(f.name)));
    const splits=files.filter(f=>/^wbf\d+$/.test(extOf(f.name)));
    if (mains.length+splits.length!==files.length || !mains.length) throw new Error('Select .wbfs or .iso games. Split .wbf1/.wbf2 parts must be selected together with their matching .wbfs file.');
    for (const f of splits) if(!mains.some(m=>extOf(m.name)==='wbfs' && stem(m.name).toLowerCase()===stem(f.name).toLowerCase())) throw new Error(`Missing matching .wbfs file for ${f.name}. Select all parts together.`);
    for (const main of mains) {
      if (!main.size) throw new Error(`${main.name} is empty.`);
      const dest=gameDestination(main.name);
      if (dest.id && knownIds.has(dest.id)) throw new Error(`Game ${dest.id} is already in this archive or selection. Remove the existing game first; it will not be overwritten.`);
      if (dest.id) knownIds.add(dest.id);
      const companions=extOf(main.name)==='wbfs'?splits.filter(f=>stem(f.name).toLowerCase()===stem(main.name).toLowerCase()):[];
      const numbers=companions.map(f=>Number(extOf(f.name).slice(3))).sort((a,b)=>a-b);
      if (numbers.some((n,i)=>n!==i+1)) throw new Error(`Split WBFS parts for ${main.name} must start at .wbf1 with no missing or repeated numbers.`);
      const members=[main,...companions];
      for (const f of members) {
        const path=f===main?dest.path:dest.path.replace(/\.wbfs$/i,`.${extOf(f.name)}`);
        if (occupied.has(path.toLowerCase())) throw new Error(`A file already exists at ${path}. No games were added.`);
        const parts=path.split('/');
        for (let i=1;i<parts.length;i++) {
          const lower=parts.slice(0,i).join('/').toLowerCase(), actual=occupied.get(lower);
          if (actual && !next.zip.files[actual]?.dir) throw new Error(`A file blocks the destination folder: ${actual}`);
        }
        next.put(path,f,f.size,{date:new Date(f.lastModified||Date.now())});
        occupied.set(path.toLowerCase(),path);
      }
    }
    next.checkBudget(); next.dirty=true; return next;
  }
  packagePlan(packageModel, stripRoot = true) {
    const top=stripRoot?packageModel.outerFolder():'';
    const byLower=new Map(this.entries().map(f=>[f.path.toLowerCase(),f.path]));
    const dirs=new Set(Object.values(this.zip.files).filter(f=>f.dir).map(f=>f.name.toLowerCase().replace(/\/$/,'')));
    const managed=new Set(this.manifest.hacks.flatMap(h=>h.paths).map(p=>p.toLowerCase()));
    const seen=new Set();
    const plan=packageModel.entries().map(f=> {
      const dest=stripTop(f.path,top); assertArchivePath(dest);
      const lower=dest.toLowerCase();
      if (lower.startsWith(INTERNAL_ROOT) || lower===INTERNAL_ROOT.slice(0,-1)) throw new Error('Packages cannot replace the manager manifest or its backup files.');
      if (managed.has(lower)) throw new Error(`This package overlaps a tracked hack at ${dest}. Remove the existing hack first.`);
      if (seen.has(lower)) throw new Error(`Duplicate destination in package: ${dest}`); seen.add(lower);
      if (dirs.has(lower) || [...byLower.keys()].some(p=>p.startsWith(`${lower}/`))) throw new Error(`A folder already exists at ${dest}.`);
      const parts=dest.split('/');
      for (let i=1;i<parts.length;i++) if(byLower.has(parts.slice(0,i).join('/').toLowerCase())) throw new Error(`A file blocks the package folder: ${parts.slice(0,i).join('/')}`);
      return {src:f.path,dest:byLower.get(lower)||dest,size:f.size,existing:byLower.get(lower)||''};
    });
    if (!plan.length) throw new Error('This package has no files.');
    return plan;
  }
  async addHack(packageModel, name, stripRoot = true, progress = ()=>{}) {
    const plan=this.packagePlan(packageModel,stripRoot);
    const next=this.clone();
    const id=`hack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    const record={id,name:String(name||'ROM Hack').trim().slice(0,80)||'ROM Hack',paths:[],backups:[],addedAt:new Date().toISOString()};
    // All writes go to the clone. A failure leaves the original archive and manifest intact.
    for (let i=0;i<plan.length;i++) {
      const p=plan[i];
      if (p.existing) {
        const original=await this.zip.file(p.existing).async('uint8array');
        const backupPath=`${INTERNAL_ROOT}backups/${id}/${p.existing}`;
        next.put(backupPath,original,original.length);
        record.backups.push({path:p.existing,backupPath});
      }
      const bytes=await packageModel.zip.file(p.src).async('uint8array');
      if (bytes.length!==p.size) throw new Error(`Uncompressed size mismatch in ${p.src}`);
      next.put(p.dest,bytes,bytes.length,{date:packageModel.zip.file(p.src).date});
      record.paths.push(p.dest); progress((i+1)/plan.length*100);
    }
    next.manifest.hacks.push(record); next.syncManifest(); next.checkBudget(); next.dirty=true; return next;
  }
  async removeItem(item) {
    if (!item || !item.paths?.length) throw new Error('The selected item no longer exists.');
    const next=this.clone();
    // Never remove a game's paths underneath a managed package or its restoration history.
    if (item.type==='game') {
      const owned=new Set(this.manifest.hacks.flatMap(h=>h.paths).map(p=>p.toLowerCase()));
      if (item.paths.some(p=>owned.has(p.toLowerCase()))) throw new Error('A tracked ROM-hack package owns files in this game. Remove the package first.');
    }
    for (const path of item.paths) next.drop(path);
    if (item.manifestId) {
      const h=this.manifest.hacks.find(h=>h.id===item.manifestId);
      if (!h) throw new Error('The ROM-hack record is missing.');
      for (const b of h.backups||[]) {
        const f=this.zip.file(b.backupPath);
        if (!f) throw new Error(`A required backup is missing: ${b.path}. Removal was cancelled to avoid losing the original file.`);
        const bytes=await f.async('uint8array');
        next.put(b.path,bytes,bytes.length,{date:f.date}); next.drop(b.backupPath);
      }
      next.manifest.hacks=next.manifest.hacks.filter(x=>x.id!==h.id); next.syncManifest();
    }
    // Empty directories remain harmlessly; only reviewed file paths are removed.
    next.dirty=true; return next;
  }
  async exportBlob(progress = ()=>{}, type='blob') {
    this.checkBudget();
    const zip=this.clone().zip;
    // Keep each original compression method; do not decompress/recompress the entire card unnecessarily.
    for (const [name,f] of Object.entries(zip.files)) {
      const copy=Object.assign(Object.create(Object.getPrototypeOf(f)),f);
      copy.options={...f.options};
      if (f._data?.compression) copy.options.compression=f._data.compression.magic==='\x08\x00'?'DEFLATE':'STORE';
      zip.files[name]=copy;
    }
    return zip.generateAsync({type,compression:'STORE',streamFiles:true,platform:'DOS'},m=>progress(m.percent,m.currentFile||''));
  }
}

export async function makeDemo(ZIP = globalThis.JSZip) {
  const z=new ZIP();
  const files={
    'DEMO-READ-ME.txt':'DEMO ONLY. These tiny text placeholders are not playable games or real Wii software. Do not copy this demo to a Wii.\n',
    'wbfs/Orbit Racers [DEME01]/DEME01.wbfs':'DEMO game placeholder: Orbit Racers\n',
    'wbfs/Orbit Racers [DEME01]/DEME01.wbf1':'DEMO split-file companion\n',
    'wbfs/Star Garden [DEME02]/DEME02.iso':'DEMO game placeholder: Star Garden\n',
    'riivolution/Practice Pack.xml':'<wiidisc version="1"><id game="DEM"/><options/><patch id="demo"/></wiidisc>\n',
    'riivolution/Practice Pack/notes.txt':'DEMO patch placeholder\n',
    'apps/example/meta.xml':'<app><name>Example app placeholder</name></app>\n',
    'config/keep-me.txt':'This unrelated file must survive import, edits, and export.\n'
  };
  for(const [p,text] of Object.entries(files)) z.file(p,text,{createFolders:false});
  const bytes=await z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  const model=await ArchiveModel.load(bytes,'Demo-SD-card.zip',ZIP); model.isDemo=true; return model;
}
