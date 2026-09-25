import {humanSize, prettyTitleFromName, safeSegment, LARGE_ARCHIVE, shouldStripPackageRoot} from './core.js';
import {ArchiveModel, makeDemo} from './model.js';
import {UPLOAD_SPECS, validateUploadSelection} from './upload-specs.js';
import {FolderModel, hasWiiLayout, MAX_HACK_PACKAGE} from './folder-model.js';
import {recoverTransaction, findRecoveries, diskMessage} from './disk-io.js';

const $ = id => {
  const el=document.getElementById(id);
  if (!el) throw new Error(`Missing interface element: ${id}`);
  return el;
};
const state={model:null,undo:null,tab:'games',page:0,busy:false,pendingHack:null,downloadURL:null,helpKind:'folder',cancelController:null,lastOperation:null,reviewModel:null};
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
let toastTimer;
function toast(message) {
  $('toast').textContent=message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);
}
function openDialog(id) {
  const d=$(id); if (!d.open) d.showModal();
}
function closeDialog(id, result='cancel') { if ($(id).open) $(id).close(result); }
function showProgress(title,text='Please keep this tab open.',percent=0) {
  $('cancelCopyBtn').hidden=true; $('cancelCopyBtn').disabled=false;
  $('progressTitle').textContent=title; setProgress(percent,text); openDialog('progressDialog');
}
function setProgress(percent,text) {
  $('progressBar').value=Math.max(0,Math.min(100,percent));
  if(text!==undefined) $('progressText').textContent=text;
}
function showError(error) {
  $('errorSafetyNote').textContent=state.model?.kind==='folder'?'Check the folder status and any recovery notice before continuing. Keep a separate backup.':'Your original ZIP has not been changed.';
  closeDialog('progressDialog'); $('errorText').textContent=error?.message||String(error); openDialog('errorDialog');
}
async function task(action) {
  if(state.busy)return;
  state.busy=true; document.body.setAttribute('aria-busy','true');
  try { await action(); }
  catch(error) { showError(error); }
  finally { closeDialog('progressDialog'); state.busy=false; document.body.removeAttribute('aria-busy'); }
}
function ask({title,text,paths=[],buttons=[{value:'confirm',text:'Continue',style:'blue'}]}) {
  $('confirmTitle').textContent=title; $('confirmText').textContent=text;
  $('confirmPaths').innerHTML=paths.map(p=>`<code>${escapeHtml(p)}</code>`).join('');
  $('confirmActions').replaceChildren();
  for(const choice of [{value:'cancel',text:'Cancel'},...buttons]) {
    const button=document.createElement('button'); button.type='button'; button.className=`wii-pill ${choice.style||''}`;
    button.textContent=choice.text; button.addEventListener('click',()=>closeDialog('confirmDialog',choice.value));
    $('confirmActions').append(button);
  }
  return new Promise(resolve=>{
    $('confirmDialog').addEventListener('close',()=>resolve($('confirmDialog').returnValue||'cancel'),{once:true});
    $('confirmDialog').returnValue='cancel'; openDialog('confirmDialog');
  });
}
function revokeDownload() {
  if(state.downloadURL) { URL.revokeObjectURL(state.downloadURL); state.downloadURL=null; }
  $('downloadLink').removeAttribute('href');
}
function showMenu() {
  $('managerView').hidden=true; $('dropView').hidden=false;
  document.body.className='landing-mode'; setPage(0); updateClock();
  window.scrollTo(0,0);
}
function adoptModel(model,undo=null) {
  state.model=model;state.undo=undo;
  $('dropView').hidden=true; $('managerView').hidden=false;
  document.body.className='manager-mode'; render(); window.scrollTo(0,0);
}
function setPage(page) {
  state.page=Math.max(0,Math.min(3,page));
  document.querySelectorAll('.channel-page').forEach((el,i)=>el.hidden=i!==state.page);
  $('previousPage').hidden=state.page===0; $('nextPage').hidden=state.page===3;
  document.querySelectorAll('[data-page]').forEach(el=>{
    if(Number(el.dataset.page)===state.page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  $('pageAnnouncement').textContent=`Menu page ${state.page+1} of 4`;
}
function updateClock() {
  const now=new Date(), digits=`${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  // Original vector seven-segment digits; no downloaded or bundled font files.
  const shapes=[
    '8,0 40,0 46,5 40,10 8,10 2,5',
    '42,8 48,14 48,36 43,41 38,36 38,14',
    '43,43 48,48 48,70 42,77 38,70 38,49',
    '8,75 40,75 46,80 40,85 8,85 2,80',
    '5,43 10,49 10,70 5,77 0,70 0,48',
    '5,8 10,14 10,36 5,41 0,36 0,14',
    '9,38 39,38 44,43 39,48 9,48 4,43'
  ];
  const segments=['012345','12','01346','01236','1256','02356','023456','012','0123456','012356'];
  const offsets=[0,59,138,197];
  let svg='<svg viewBox="0 0 245 85" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor">';
  [...digits].forEach((d,i)=>{svg+=`<g transform="translate(${offsets[i]},0)">`+[...segments[Number(d)]].map(n=>`<polygon points="${shapes[Number(n)]}"/>`).join('')+'</g>';});
  svg+='<circle cx="122" cy="29" r="4.5"/><circle cx="122" cy="58" r="4.5"/></svg>';
  $('landingTime').innerHTML=svg;
  $('landingTime').setAttribute('aria-label',now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false}));
  $('landingDate').textContent=`${new Intl.DateTimeFormat('en',{weekday:'short'}).format(now)} ${now.getMonth()+1}/${now.getDate()}`;
}
function openInfo() {
  if(state.busy)return;
  $('infoMenuBtn').textContent=state.model?'Back to manager':'Wii Menu';
  $('demoBtn').disabled=!!state.model;
  $('demoBtn').title=state.model?'Return to the Wii Menu before loading the demo.':'';
  openDialog('infoDialog');
}
// Render the same requirements in contextual help and Important Information.
function renderUploadSpecs(active = '', prefix = 'upload') {
  const kinds = active ? [active, ...Object.keys(UPLOAD_SPECS).filter(kind => kind !== active)] : Object.keys(UPLOAD_SPECS);
  return kinds.map(kind => {
    const spec = UPLOAD_SPECS[kind];
    return `<details class="upload-spec" data-upload-kind="${kind}" id="${prefix}-${kind}"${kind === active ? ' open' : ''}><summary><span>${escapeHtml(spec.label)}</span><span class="format-badge">${escapeHtml(spec.formats)}</span></summary><div class="upload-spec-body"><p class="upload-spec-summary">${escapeHtml(spec.summary)}</p>${spec.paragraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}<p class="example-caption">${escapeHtml(spec.exampleTitle)}</p><pre class="folder-example"><code>${escapeHtml(spec.example)}</code></pre><p class="fine-print">${escapeHtml(spec.after)}</p></div></details>`;
  }).join('');
}
function openUploadHelp(kind) {
  if (state.busy || !UPLOAD_SPECS[kind]) return;
  state.helpKind = kind;
  const spec = UPLOAD_SPECS[kind];
  $('uploadHelpTitle').textContent = `${spec.label}: accepted files`;
  $('uploadHelpSections').innerHTML = renderUploadSpecs(kind, 'help');
  $('uploadHelpChooseBtn').textContent = spec.choose;
  $('uploadHelpChooseBtn').disabled = (kind === 'sd' || kind === 'folder') ? !!state.model : !state.model;
  openDialog('uploadHelpDialog');
  $('uploadHelpDialog').querySelector('.dialog-body').scrollTop = 0;
}
function render() {
  if(!state.model)return;
  const {files,games,hacks,total}=state.model.summary(), query=$('searchInput').value.trim().toLowerCase();
  $('archiveName').textContent=state.model.name;
  const folder=state.model.kind==='folder', recovering=folder&&state.model.recoveries.length>0;
  $('archiveStats').textContent=`${files.length.toLocaleString()} files · ${humanSize(total)} ${folder?'in selected library':'uncompressed'}`;
  $('dirtyBadge').textContent=folder?'Pending · not applied':'Not exported';
  $('exportBtn').textContent=folder?'Apply changes':'Export ZIP';
  $('exportBtn').disabled=folder&&(!state.model.dirty||recovering);
  $('managerFootnote').textContent=folder?'Folder mode: changes are staged until Apply. Applied removals are permanent; keep a separate backup. No games are uploaded.':'ZIP mode: your original archive and physical card are unchanged. Export a separate edited copy.';
  $('folderStatus').hidden=!folder;
  $('pendingPanel').hidden=!folder||!state.model.dirty||recovering;
  $('recoveryPanel').hidden=!recovering;
  if(folder) {
    const plan=state.model.plan();
    $('folderStatusText').textContent=state.model.dirty?'The library below previews your staged edits. Disk files are unchanged until Apply.':'Connected to an existing folder. Additions and removals will be staged for review.';
    $('pendingSummary').textContent=`${plan.writes.length} file write(s) · ${humanSize(plan.copyBytes)} to copy; ${plan.deletes.length} removal(s) · ${humanSize(plan.deleteBytes)}. Nothing applied yet.`;
    $('discardEditsBtn').disabled=!state.model.dirty||recovering;
    $('recoverySummary').textContent=recovering?`${state.model.recoveries.length} recorded operation(s) need recovery. Normal edits are blocked until you review them.`:'';
  }
  $('gameCount').textContent=games.length; $('hackCount').textContent=hacks.length; $('fileCount').textContent=files.length;
  $('dirtyBadge').hidden=!state.model.dirty; $('undoBtn').disabled=!state.undo; $('demoNotice').hidden=!state.model.isDemo;
  const warnings=[];
  if(!folder&&total>LARGE_ARCHIVE) warnings.push('Large archive: this in-memory editor can need several times the archive size in RAM. Export may fail on devices with limited memory. Keep the original.');
  if(!folder&&!state.model.crcChecked) warnings.push('Only ZIP structure and paths were checked at import; a full data-integrity check was skipped for this large archive.');
  if(state.model.outerFolder()) warnings.push(`Your files are inside “${state.model.outerFolder()}/”. Detection expects /wbfs and /riivolution at the root. Reopen the ZIP and choose “Use folder contents” to remove that wrapper.`);
  if(folder){warnings.push(...state.model.notes);if(state.model.skipped.length)warnings.push(`Operating-system folders left untouched: ${state.model.skipped.join(', ')}.`);}
  $('warningBox').hidden=!warnings.length; $('warningBox').textContent=warnings.join(' ');
  document.querySelectorAll('[data-tab]').forEach(el=>{
    const active=el.dataset.tab===state.tab;
    el.classList.toggle('active',active); el.setAttribute('aria-selected',String(active)); el.tabIndex=active?0:-1;
  });
  $('content').setAttribute('aria-labelledby',`${state.tab}Tab`);
  $('addBtn').disabled=!!recovering;
  $('addBtn').textContent=state.tab==='hacks'?'+ Add ROM hack':'+ Add game'; $('addBtn').hidden=state.tab==='files';
  const uploadKind = state.tab === 'hacks' ? 'hack' : 'game';
  $('libraryUploadGuide').hidden = state.tab === 'files';
  $('uploadGuideTitle').textContent = `${UPLOAD_SPECS[uploadKind].label} · ${UPLOAD_SPECS[uploadKind].formats}`;
  $('libraryUploadHint').textContent = UPLOAD_SPECS[uploadKind].hint;

  if(state.tab==='files') {
    const filtered=files.filter(f=>f.path.toLowerCase().includes(query)).sort((a,b)=>a.path.localeCompare(b.path));
    $('content').innerHTML='<div class="section-head"><h2>All files</h2><p>Read-only inventory. Only explicitly removed or replaced files change.</p></div>'+(filtered.length?`<div class="file-table">${filtered.slice(0,2000).map(f=>`<div class="file-row"><code>${escapeHtml(f.path)}</code><span>${humanSize(f.size)}</span></div>`).join('')}</div>${filtered.length>2000?'<p class="muted">Showing the first 2,000 matches. Narrow the search to see other files.</p>':''}`:renderEmptyState('files',query,files.length));
  } else {
    const isGames=state.tab==='games';
    const list=(isGames?games:hacks).filter(item=>`${item.title} ${item.id||''} ${item.root||''} ${item.source||''} ${item.format||''}`.toLowerCase().includes(query));
    $('content').innerHTML=`<div class="section-head"><h2>${isGames?'Wii games':'ROM hacks'}</h2><p>${isGames?'Games detected in <code>/wbfs</code>. Select all parts together when adding a split WBFS.':'Riivolution XML files and tracked SD-ready packages. Untracked patch files outside a matching folder are left alone.'}</p></div>`+renderCards(list,isGames,query,files.length);
  }
  if(recovering)$('content').querySelectorAll('button[data-remove],button[data-library-action]').forEach(button=>button.disabled=true);
}
function renderEmptyState(section,query,fileCount) {
  // Zero detected games is a usable library, not an import failure.
  // A no-match search is different: offer an explicit way to remove the filter.
  if(query)return '<div class="empty"><p>No results. Try a different search.</p><button type="button" class="wii-pill" data-library-action="clear-search">Clear search</button></div>';
  const title=section==='games'?'No games yet':section==='hacks'?'No ROM hacks yet':'No files to display';
  const description=section==='games'
    ? (fileCount?'No Wii games were detected under /wbfs. You can add your first game now; the other files in this library are kept.':'No game files are currently listed. This tool manages existing Wii setups; it does not install homebrew.')
    : section==='hacks'?'You can add an SD-ready ROM-hack ZIP even with zero games here. The hack may still need its base game or disc to run on your Wii.'
    : 'No files are listed in this view. Use an existing Wii card or backup, not a blank-card installation workflow.';
  const firstIsHack = section === 'hacks';
  const gameButton = `<div class="empty-upload-action"><button type="button" class="wii-pill ${firstIsHack ? '' : 'blue'}" data-library-action="add-game" aria-describedby="emptyGameHint">${firstIsHack ? '+ Add game' : '+ Add first game'}</button><small id="emptyGameHint">Wii .wbfs or .iso; select all split parts.</small></div>`;
  const hackButton = `<div class="empty-upload-action"><button type="button" class="wii-pill ${firstIsHack ? 'blue' : ''}" data-library-action="add-hack" aria-describedby="emptyHackHint">+ Add ROM hack</button><small id="emptyHackHint">One SD-ready .zip package.</small></div>`;
  const buttons = firstIsHack ? hackButton + gameButton : gameButton + hackButton;
  return `<div class="empty empty-library" data-empty-state="${section}"><svg aria-hidden="true"><use href="#sdArt"/></svg><h3>${title}</h3><p>${description}</p><div class="empty-actions">${buttons}</div></div>`;
}
function renderCards(items,isGames,query,fileCount) {
  if(!items.length)return renderEmptyState(isGames?'games':'hacks',query,fileCount);
  return `<div class="grid">${items.map(item=>`<article class="card" data-key="${escapeHtml(item.key)}"><div class="card-banner">${isGames?`<span class="card-icon" aria-hidden="true">${escapeHtml(item.title.split(/\s+/).slice(0,2).map(w=>w[0]).join(''))}</span>`:'<svg aria-hidden="true"><use href="#infoArt"/></svg>'}</div><div class="card-details"><h3>${escapeHtml(item.title)}</h3><div class="meta">${isGames?`${escapeHtml(item.id||'No ID in filename')} · ${escapeHtml(item.format)}`:escapeHtml(item.source)}</div><div class="card-path">${escapeHtml(item.root||item.paths[0])}</div><div class="card-foot"><span class="meta">${item.paths.length} file${item.paths.length===1?'':'s'} · ${humanSize(item.size)}</span><button type="button" class="remove-btn" data-remove="${escapeHtml(item.key)}" data-type="${isGames?'game':'hack'}" aria-label="Remove ${escapeHtml(item.title)}">Remove</button></div></div></article>`).join('')}</div>`;
}
async function loadZip(file) {
  if(!file)return;
  await task(async()=>{
    validateUploadSelection('sd', [file]);
    showProgress('Opening SD archive…',file.name,5); await tick();
    let model=await ArchiveModel.load(file,file.name);
    const top=model.outerFolder();
    if(top) {
      closeDialog('progressDialog');
      const decision=await ask({title:'Use the SD-card contents?',text:`This ZIP wraps the card inside “${top}/”. Using the folder contents moves /wbfs, /apps and other SD folders to the ZIP root. This change is included in the export.`,buttons:[{value:'keep',text:'Keep folder'},{value:'strip',text:'Use folder contents',style:'blue'}]});
      if(decision==='cancel')return;
      if(decision==='strip')model=await model.stripOuterFolder(top);
    }
    if(!hasWiiLayout([...Object.keys(model.zip.files)].map(path=>top&&path.startsWith(`${top}/`)?path.slice(top.length+1):path)))throw new Error('Select a ZIP of an existing Wii card with apps, wbfs, or loader folders. The blank-card creation workflow is not part of this manager.');
    revokeDownload(); state.tab='games'; $('searchInput').value=''; adoptModel(model);
    const summary=model.summary();
    toast(summary.games.length?`Opened ${summary.files.length} files. Your original ZIP is untouched.`:'Archive ready with 0 games. Use Add game or Add ROM hack to get started.');
  });
  $('zipInput').value=''; setDrag(false);
}
async function loadDemo() {
  closeDialog('infoDialog');
  await task(async()=>{
    showProgress('Opening demo…','Creating safe placeholder files.',10); await tick();
    const model=await makeDemo(); revokeDownload(); state.tab='games'; $('searchInput').value=''; adoptModel(model);
    toast('Demo ready. These are non-playable placeholders.');
  });
}
async function removeItem(key,type) {
  if(!state.model||state.busy)return;
  // Own the transaction while confirmation is open as well as during mutation.
  // Native dialog "close" is dispatched later; leaving a busy-state gap here
  // allowed a quick Add action to win the race and silently skip the removal.
  await task(async()=>{
    const summary=state.model.summary(), item=(type==='game'?summary.games:summary.hacks).find(x=>x.key===key);
    if(!item)return;
    const backups=item.manifestId?state.model.manifest.hacks.find(h=>h.id===item.manifestId)?.backups||[]:[];
    const result=await ask({title:`Remove ${item.title}?`,text:`These ${item.paths.length} file(s) ${state.model.kind==='folder'?'will be staged for permanent removal from the selected folder after Apply.':'will be removed from the edited ZIP only.'} ${backups.length?`${backups.length} original file(s) will be restored from this package’s backups. `:''}${type==='hack'&&!item.manifestId?'Only the XML and an obvious matching Riivolution folder are included; other patch files are left untouched. ':''}Review the paths before continuing.`,paths:[...item.paths,...backups.map(b=>`Restore original: ${b.path}`)],buttons:[{value:'confirm',text:'Remove',style:'danger'}]});
    if(result!=='confirm')return;
    showProgress('Removing files…','Preparing the edited copy.',10); await tick();
    const before=state.model, next=await before.removeItem(item); adoptModel(next,before); toast(state.model.kind==='folder'?`${item.title}: removal staged. Apply is required.`:`${item.title} removed. Undo is available.`);
  });
}
async function addGames(files) {
  if(!state.model||!files.length)return;
  await task(async()=>{
    validateUploadSelection('game', files);
    showProgress('Staging games…','No disk writes; preparing game destinations.',20); await tick();
    const before=state.model, next=await before.addGames(files);
    // A stale search must not hide the first game the user just added.
    // Reset only after a successful import; cancel/errors leave the view alone.
    state.tab='games'; $('searchInput').value=''; adoptModel(next,before);
    toast(state.model.kind==='folder'?'Game files staged. Review & apply to copy them.':'Game files added. Export ZIP to save the edited copy.');
  });
  $('gameInput').value='';
}
async function prepareHack(file) {
  if(!file||!state.model)return;
  await task(async()=>{
    validateUploadSelection('hack', [file]);
    showProgress('Reading ROM hack…',file.name,10); await tick();
    if(state.model.kind==='folder'&&file.size>MAX_HACK_PACKAGE)throw new Error('For folder mode, select a ROM-hack ZIP no larger than 256 MiB. Use Add Game for large patched .wbfs/.iso games.');
    const model=await ArchiveModel.load(file,file.name);
    if(state.model.kind==='folder'&&model.summary().total>MAX_HACK_PACKAGE)throw new Error('This mod ZIP exceeds the 256 MiB uncompressed package limit. Add large patched games through Add Game instead.');
    state.pendingHack=model;
    $('hackName').value=safeSegment(prettyTitleFromName(file.name),'ROM Hack');
    $('stripRoot').checked=!!model.outerFolder(); $('stripRoot').disabled=!model.outerFolder();
    $('hackSummary').textContent=`${model.entries().length} files · ${humanSize(model.summary().total)} uncompressed`;
    updateHackPreview(); closeDialog('progressDialog'); openDialog('hackDialog');
  });
  $('hackInput').value='';
}
function updateHackPreview() {
  if(!state.pendingHack)return;
  try {
    const plan=state.model.packagePlan(state.pendingHack,$('stripRoot').checked);
    $('hackPreview').innerHTML=plan.map(p=>`<code class="${p.existing?'replace':''}">${p.existing?'Replace + back up':'Add'}: ${escapeHtml(p.dest)}</code>`).join('');
    const replacements=plan.filter(p=>p.existing).length;
    $('hackPlanNote').textContent=replacements?`${replacements} existing file(s) will be backed up and replaced. Review them below.`:'No existing files will be replaced.';
    $('hackPlanNote').className=replacements?'notice warning':'notice'; $('confirmHack').disabled=false;
  }catch(error) {
    $('hackPreview').textContent=''; $('hackPlanNote').textContent=error.message; $('hackPlanNote').className='notice warning'; $('confirmHack').disabled=true;
  }
}
async function commitHack() {
  const pending=state.pendingHack; if(!pending||!state.model)return;
  const name=$('hackName').value,strip=$('stripRoot').checked;
  closeDialog('hackDialog','confirm');
  await task(async()=>{
    showProgress('Adding ROM hack…','Preparing files and backups.',0); await tick();
    const before=state.model,next=await before.addHack(pending,name,strip,pct=>setProgress(pct));
    state.tab='hacks';$('searchInput').value='';adoptModel(next,before);toast(state.model.kind==='folder'?'ROM hack staged. Review & apply to save it.':'ROM hack added. Export ZIP to save your changes.');
  });
  state.pendingHack=null;
}
async function exportZip() {
  if(!state.model)return;
  await task(async()=>{
    showProgress('Building edited ZIP…','Please keep this tab open.',0);await tick();
    const blob=await state.model.exportBlob((pct,path)=>setProgress(pct,`${Math.round(pct)}% · ${path||'Finalizing archive'}`));
    revokeDownload();state.downloadURL=URL.createObjectURL(blob);
    const name=`${state.model.name.replace(/(?:-edited)?\.zip$/i,'')}-edited.zip`;
    $('downloadLink').href=state.downloadURL;$('downloadLink').download=name;
    $('exportDescription').textContent=`${name} · ${humanSize(blob.size)}. This is a new archive; your original is unchanged.`;
    state.model.dirty=false; state.undo=null; render();
    closeDialog('progressDialog');openDialog('exportDialog');
    $('downloadLink').click();
  });
}
async function closeArchive() {
  if(state.busy)return;
  await task(async()=>{
    if(state.model?.dirty) {
      const result=await ask({title:state.model.kind==='folder'?'Discard staged changes?':'Leave without exporting?',text:state.model.kind==='folder'?'Returning to the menu discards the pending plan. No disk changes have been applied.':'Your edits only exist in this tab. Returning to the Wii Menu will discard them. Your original ZIP will remain unchanged.',buttons:[{value:'discard',text:'Discard edits',style:'danger'}]});
      if(result!=='discard')return;
    }
    revokeDownload(); state.model=null;state.undo=null;state.pendingHack=null;state.tab='games';$('searchInput').value='';$('content').replaceChildren();showMenu();$('dropZone').focus({preventScroll:true});
  });
}
function setDrag(on) { $('dragOverlay').hidden=!on; }

function folderSupported() { return !!(window.isSecureContext&&window.showDirectoryPicker&&navigator.locks); }
function openFolder() {
  if(state.busy||state.model)return;
  if(!folderSupported()) {
    showError(new Error('Direct folder access is unavailable in this browser or preview. Open the published HTTPS website in a supported browser, such as desktop Chrome or Edge. For small archives only, use Open small ZIP instead.'));
    return;
  }
  // Picker starts within the original click, before any asynchronous work.
  let selection;
  try { selection=window.showDirectoryPicker({id:'wii-card-root',mode:'read'}); }
  catch(error){showError(error);return;}
  task(async()=>{
    let root;try{root=await selection;}catch(error){if(error.name==='AbortError')return;throw error;}
    showProgress('Reading existing Wii folder…','Listing names and sizes, not loading games into RAM.');
    const model=await FolderModel.open(root,{onProgress:info=>setProgress(0,`Reading file metadata · ${info.count.toLocaleString()} entries`)});
    revokeDownload();state.tab='games';$('searchInput').value='';adoptModel(model);
    toast(model.recoveries.length?'Folder opened with a recovery notice. Review it before editing.':`${model.summary().games.length} game(s) found. No disk files changed.`);
  });
}
async function refreshFolder() {
  if(state.busy||state.model?.kind!=='folder')return;
  await task(async()=>{
    if(state.model.dirty) {
      const answer=await ask({title:'Discard staged edits and refresh?',text:'This discards only the pending plan. Files on disk are not changed.',buttons:[{value:'refresh',text:'Discard & refresh',style:'blue'}]});
      if(answer!=='refresh')return;
    }
    showProgress('Refreshing folder…','Reading the current file inventory.');
    const model=await FolderModel.open(state.model.root);adoptModel(model);toast('Folder refreshed.');
  });
}
function reviewChanges() {
  const model=state.model;
  if(state.busy||model?.kind!=='folder'||!model.dirty||model.recoveries.length)return;
  const plan=model.plan();state.reviewModel=model;
  $('applyLocation').textContent=`Selected folder: ${model.name}. Paths below are relative to this folder.`;
  $('applyTotals').textContent=`${plan.writes.length} file write(s), ${humanSize(plan.copyBytes)} copied; ${plan.deletes.length} permanent removal(s), ${humanSize(plan.deleteBytes)} removed.`;
  $('applyPaths').innerHTML=[...plan.writes.map(op=>`${op.before?'Replace':'Add'} · ${humanSize(op.size)} · ${op.path}`),...plan.deletes.map(op=>`Remove · ${humanSize(op.size)} · ${op.path}`)].map(text=>`<code>${escapeHtml(text)}</code>`).join('');
  $('applySpace').textContent=plan.writes.length?`Conservative extra-free-space allowance: about ${humanSize(plan.extraSpaceEstimate)} (copies, rollback backups, native temporary files, and journal). This is an estimate—not a measurement of your card. Check free space in your file manager.`:'Removal-only operation: no whole-game backup copies are made. A small recovery journal still needs free space. Removed games cannot be restored by this app.';
  $('applyAcknowledge').checked=false;$('applyConfirmBtn').disabled=true;
  openDialog('applyDialog');
}
function folderProgress(info) {
  const names={copy:'Copying',verify:'Verifying copy','backup-copy':'Backing up replacement','backup-verify':'Verifying rollback backup',rollback:'Rolling back',commit:'Committing reviewed changes',remove:'Removing'};
  const pct=info.total?100*info.done/info.total:0;
  const detail=['copy','verify','backup-copy','backup-verify'].includes(info.phase)?`${humanSize(info.done)} / ${humanSize(info.total)}`:`${info.done} / ${info.total}`;
  setProgress(pct,`${names[info.phase]||info.phase} · ${info.path}${info.total?` · ${detail}`:''}`);
  if(['commit','remove','rollback'].includes(info.phase)){$('cancelCopyBtn').disabled=true;$('cancelCopyBtn').hidden=true;}
}
async function withFolderLock(action) {
  if(!navigator.locks)throw new Error('This browser cannot safely coordinate folder operations. Use a supported browser.');
  return navigator.locks.request('wii-game-manager-disk-operation',{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab of this manager is applying changes. Wait for it to finish, then refresh this library.');
    return action();
  });
}
function applyReviewedChanges() {
  const model=state.reviewModel;
  if(state.busy||!$('applyAcknowledge').checked||model!==state.model||model?.kind!=='folder')return;
  // Permission request must be on this click, not after scan/copy/confirmation awaits.
  let permission;
  try { permission=model.root.requestPermission({mode:'readwrite'}); }
  catch(error){showError(error);return;}
  closeDialog('applyDialog','confirm');
  task(async()=>{
    if(await permission!=='granted')throw new Error('Write permission was not granted. Pending edits remain staged; no files were changed.');
    state.cancelController=new AbortController();
    showProgress('Applying reviewed changes…','Preflight: checking files have not changed since selection.');
    $('cancelCopyBtn').hidden=false;
    const reviewedPlan=model.plan();
    let result;
    try { result=await withFolderLock(()=>model.apply({signal:state.cancelController.signal,onProgress:folderProgress})); }
    finally { state.cancelController=null;$('cancelCopyBtn').hidden=true; }
    state.lastOperation={time:new Date().toISOString(),folder:model.name,result:{...result,journal:result.journal?{id:result.journal.id,phase:result.journal.phase}:undefined},reviewed:{writes:reviewedPlan.writes.map(p=>({path:p.path,size:p.size})),removes:reviewedPlan.deletes.map(p=>({path:p.path,size:p.size}))}};
    // The source handles may now be stale. Always rebuild the live inventory.
    try { adoptModel(await FolderModel.open(model.root)); }
    catch(error) {
      model.recoveries=result.journal?[result.journal]:[{id:'unreadable',phase:'unknown'}];
      model.dirty=false;adoptModel(model);
      throw new Error(`${result.message||'The disk operation finished, but the folder could not be refreshed.'} ${diskMessage(error)} Reconnect and reopen the folder. Do not assume the library view is current.`);
    }
    closeDialog('progressDialog');
    $('operationTitle').textContent=result.status==='completed'?'Reviewed changes applied':result.status==='cancelled'?'Copy cancelled and rolled back':result.status==='rolled-back'?'Write failed and was rolled back':'Recovery required';
    $('operationText').textContent=result.status==='completed'?`${result.written} file(s) written and verified; ${result.removed} file(s) removed. Unrelated files were left alone. The pending plan is now cleared. Applied removals cannot be undone here.`:result.message;
    openDialog('operationDialog');
  });
}
function reviewRecovery() {
  if(state.busy||state.model?.kind!=='folder'||!state.model.recoveries.length)return;
  const jobs=state.model.recoveries;
  if(jobs.some(j=>j.phase==='unknown')){showError(new Error('The folder is unavailable. Reconnect it and use Refresh or reopen the folder from the menu.'));return;}
  $('recoveryExplanation').textContent=jobs.map(j=>j.phase==='deleting'?`Operation ${j.id}: copies were completed; finish only the already-reviewed removals. Removed files cannot be restored.`:['complete','rolled-back'].includes(j.phase)?`Operation ${j.id}: changes/recovery finished; clean up its remaining journal.`:`Operation ${j.id}: roll back its unfinished write phase. No removal phase was started.`).join(' ');
  $('recoveryPaths').innerHTML=jobs.flatMap(j=>[...j.writes.map(op=>`Write phase · ${op.path}`),...j.deletes.map(op=>`Reviewed removal · ${op.path}`)]).map(text=>`<code>${escapeHtml(text)}</code>`).join('');
  openDialog('recoveryDialog');
}
function runRecovery() {
  const model=state.model;if(state.busy||model?.kind!=='folder'||!model.recoveries.length)return;
  let permission;try{permission=model.root.requestPermission({mode:'readwrite'});}catch(error){showError(error);return;}
  closeDialog('recoveryDialog');
  task(async()=>{
    if(await permission!=='granted')throw new Error('Write permission is required for recovery. No recovery action was started.');
    showProgress('Recovering recorded operation…','Do not unplug the drive.');
    await withFolderLock(async()=>{for(const job of await findRecoveries(model.root))await recoverTransaction(model.root,job,{onProgress:folderProgress});});
    adoptModel(await FolderModel.open(model.root));toast('Recorded recovery finished. The folder has been refreshed.');
  });
}
function initializeFolderUI() {
  $('folderSupportNote').textContent=folderSupported()?'Direct folder access is available in this browser. You will choose the folder and grant access.':'This browser or preview does not expose direct folder access. Open the published HTTPS site in a supported browser such as desktop Chrome or Edge. Small-ZIP fallback is available.';
  $('reviewChangesBtn').addEventListener('click',reviewChanges);
  $('applyAcknowledge').addEventListener('change',()=>{$('applyConfirmBtn').disabled=!$('applyAcknowledge').checked;});
  $('applyConfirmBtn').addEventListener('click',applyReviewedChanges);
  $('refreshFolderBtn').addEventListener('click',refreshFolder);$('discardEditsBtn').addEventListener('click',refreshFolder);
  $('cancelCopyBtn').addEventListener('click',()=>{state.cancelController?.abort();$('cancelCopyBtn').disabled=true;});
  $('recoveryBtn').addEventListener('click',reviewRecovery);$('recoveryConfirmBtn').addEventListener('click',runRecovery);
  $('saveOperationBtn').addEventListener('click',()=>{
    if(!state.lastOperation)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(state.lastOperation,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='wii-manager-operation-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
}
function initialize() {
  for (const spec of Object.values(UPLOAD_SPECS)) {
    if(!spec.input)continue;
    $(spec.input).accept = spec.accept;
    $(spec.input).multiple = spec.multiple;
  }
  $('infoUploadSpecs').innerHTML = renderUploadSpecs('', 'info-files');
  $('landingUploadHelp').addEventListener('click', () => openUploadHelp('folder'));
  $('libraryUploadHelp').addEventListener('click', () => openUploadHelp(state.tab === 'hacks' ? 'hack' : 'game'));
  $('uploadHelpChooseBtn').addEventListener('click', () => {
    if (state.busy || $('uploadHelpChooseBtn').disabled) return;
    const input = UPLOAD_SPECS[state.helpKind].input;
    closeDialog('uploadHelpDialog');
    if(state.helpKind==='folder'){openFolder();return;}
    // Keep the file-picker call synchronous with the click/user gesture.
    $(input).click();
  });
  // One explicit close path for every dialog, scoped by its target. No implicit form submissions.
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-close]');
    if(button)closeDialog(button.dataset.close,'cancel');
  });
  document.querySelectorAll('dialog:not(#progressDialog)').forEach(dialog=>{
    let beganOutside=false;
    const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',event=>beganOutside=event.target===dialog&&outside(event));
    dialog.addEventListener('click',event=>{if(beganOutside&&event.target===dialog&&outside(event))dialog.close('cancel');beganOutside=false;});
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('cancel');});
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focusable=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')]
        .filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
      if(!focusable.length){event.preventDefault();return;}
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(event.shiftKey&&(active===first||!focusable.includes(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
    });
  });
  $('progressDialog').addEventListener('cancel',event=>event.preventDefault());
  for(const id of ['infoChannel','mailButton','previewInfo','managerInfoBtn'])$(id).addEventListener('click',openInfo);
  for(const id of ['dropZone','sdButton','previewOpen'])$(id).addEventListener('click',openFolder);
  $('openSmallZipBtn').addEventListener('click',()=>{if(!state.busy)$('zipInput').click();});
  $('zipInput').addEventListener('change',event=>loadZip(event.target.files[0]));
  $('demoBtn').addEventListener('click',loadDemo);
  $('nextPage').addEventListener('click',()=>setPage(state.page+1));$('previousPage').addEventListener('click',()=>setPage(state.page-1));
  $('wiiMenuButton').addEventListener('click',()=>{setPage(0);$('dropZone').focus({preventScroll:true});});
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>setPage(Number(button.dataset.page))));
  $('gameInput').addEventListener('change',event=>addGames([...event.target.files]));
  $('hackInput').addEventListener('change',event=>prepareHack(event.target.files[0]));
  $('addBtn').addEventListener('click',()=>state.tab==='hacks'?$('hackInput').click():$('gameInput').click());
  $('stripRoot').addEventListener('change',updateHackPreview);$('confirmHack').addEventListener('click',commitHack);
  $('hackDialog').addEventListener('close',()=>{if($('hackDialog').returnValue!=='confirm')state.pendingHack=null;});
  $('searchInput').addEventListener('input',render);
  const tabs=[...document.querySelectorAll('[data-tab]')];
  function selectTab(tab){state.tab=tab.dataset.tab;render();}
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>selectTab(tab));
    tab.addEventListener('keydown',event=>{
      let n=null;
      if(event.key==='ArrowRight')n=(i+1)%tabs.length;if(event.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;
      if(event.key==='Home')n=0;if(event.key==='End')n=tabs.length-1;
      if(n!==null){event.preventDefault();selectTab(tabs[n]);tabs[n].focus();}
    });
  });
  $('content').addEventListener('click',event=>{
    if(state.busy)return;
    const action=event.target.closest('[data-library-action]')?.dataset.libraryAction;
    if(action==='add-game')$('gameInput').click();
    else if(action==='add-hack')$('hackInput').click();
    else if(action==='clear-search'){$('searchInput').value='';render();$('searchInput').focus();}
    const button=event.target.closest('[data-remove]');
    if(button)removeItem(button.dataset.remove,button.dataset.type);
  });
  $('undoBtn').addEventListener('click',()=>{if(!state.busy&&state.undo){const previous=state.undo;adoptModel(previous);toast('Last edit undone.');}});
  $('exportBtn').addEventListener('click',()=>state.model?.kind==='folder'?reviewChanges():exportZip());$('newArchiveBtn').addEventListener('click',closeArchive);
  let dragDepth=0;
  window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  window.addEventListener('drop',event=>event.preventDefault());
  $('dropView').addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;if(!state.busy)setDrag(true);}});
  $('dropView').addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';});
  $('dropView').addEventListener('dragleave',event=>{event.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)setDrag(false);});
  $('dropView').addEventListener('drop',event=>{
    event.preventDefault();dragDepth=0;setDrag(false);if(state.busy)return;
    const files=[...(event.dataTransfer?.files||[])];
    if(files.length!==1){showError(new Error('Drop one SD-card ZIP at a time.'));return;}
    loadZip(files[0]);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){dragDepth=0;setDrag(false);}
    if(!state.model&&!document.querySelector('dialog[open]')&&!event.ctrlKey&&!event.metaKey) {
      if(event.key==='ArrowRight'){event.preventDefault();setPage(state.page+1);}
      if(event.key==='ArrowLeft'){event.preventDefault();setPage(state.page-1);}
    }
  });
  window.addEventListener('beforeunload',event=>{if(state.model?.dirty||state.busy){event.preventDefault();event.returnValue='';}});
  initializeFolderUI();
  updateClock();setInterval(updateClock,15000);showMenu();
  document.documentElement.dataset.ready='true';
}
try { initialize(); } catch(error) { const target=document.getElementById('fatalError');if(target){target.hidden=false;target.textContent=`The interface could not start: ${error.message}. Reload this page in a current browser, or open the downloaded Wii-SD-Manager.html offline.`;} throw error; }
