// Archive detection is deliberately conservative. It is not a Wii installer.
export const APP_MANIFEST = '.wii-game-manager/manifest.json';
export const INTERNAL_ROOT = '.wii-game-manager/';
export const GAME_EXTS = new Set(['wbfs', 'iso']);
export const ZIP32_LIMIT = 0xffffffff;
export const LARGE_ARCHIVE = 512 * 1024 ** 2;

export function normalizePath(input) {
  if (typeof input !== 'string' || /[\x00-\x1f\x7f]/.test(input)) return null;
  const parts = input.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (parts.some(p => p.trim() === '..' || p.includes(':'))) return null;
  return parts.filter(p => p && p !== '.').join('/');
}

// Use the ORIGINAL name supplied by the ZIP, before JSZip's sanitization.
export function assertArchivePath(raw) {
  if (typeof raw !== 'string' || !raw || /^[\/\\]/.test(raw) || /[\\\x00-\x1f\x7f:]/.test(raw)) {
    throw new Error(`Unsafe archive path: ${String(raw).slice(0, 120)}`);
  }
  const parts = raw.replace(/\/$/, '').split('/');
  if (parts.some(p => !p || p === '.' || p.trim() === '..' || /[. ]$/.test(p))) {
    throw new Error(`Unsafe or ambiguous archive path: ${raw.slice(0, 120)}`);
  }
  return raw.replace(/\/$/, '');
}
export function baseName(path = '') { return path.replace(/\/$/, '').split('/').pop() || ''; }
export function extOf(path = '') { const b = baseName(path); return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1).toLowerCase() : ''; }
export function stem(path = '') { const b = baseName(path); return b.lastIndexOf('.') > 0 ? b.slice(0, b.lastIndexOf('.')) : b; }
export function humanSize(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 100 ? 1 : 0)} ${units[i]}`;
}
export function safeSegment(value, fallback = 'Untitled') {
  const s = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s || fallback;
}
export function extractGameId(text = '') {
  const bracketed = String(text).match(/\[([a-z0-9]{6})\]|\(([a-z0-9]{6})\)/i);
  if (bracketed) return (bracketed[1] || bracketed[2]).toUpperCase();
  // Do not mistake six-letter words such as "Galaxy" for an ID.
  const tokens = String(text).match(/(?:^|[^A-Z0-9])([A-Z0-9]{6})(?=[^A-Z0-9]|$)/g) || [];
  for (const token of tokens) {
    const value = token.replace(/^[^A-Z0-9]/, '');
    if (/\d/.test(value)) return value;
  }
  return '';
}
export function prettyTitleFromName(name, removeExtension = true) {
  let s = removeExtension ? stem(name) : name;
  s = s.replace(/\[[A-Z0-9]{6}\]|\([A-Z0-9]{6}\)/ig, '');
  const id = extractGameId(s);
  if (id) s = s.replace(new RegExp(`^${id}[-_ ]+`), '');
  return s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
export function gameDestination(fileName) {
  const file = safeSegment(baseName(fileName), 'game.wbfs');
  const ext = extOf(file), id = extractGameId(file);
  let title = safeSegment(prettyTitleFromName(file), 'Game');
  if (title === id) title = 'Game';
  return {path: id ? `wbfs/${title} [${id}]/${id}.${ext}` : `wbfs/${title}/${file}`, title, id};
}
export function commonTopFolder(paths) {
  if (!paths.length) return '';
  const top = paths[0].split('/')[0];
  return paths.every(p => p.includes('/') && p.split('/')[0] === top) ? top : '';
}
export function shouldStripPackageRoot(paths) {
  const top = commonTopFolder(paths); if (!top) return '';
  const known = new Set(['apps', 'wbfs', 'riivolution', 'private', 'codes', 'config', 'wiiflow', 'usb-loader', 'games', '.wii-game-manager']);
  // Never strip an actual SD root folder such as apps or wbfs.
  if (known.has(top.toLowerCase())) return '';
  return paths.some(p => known.has(p.split('/')[1]?.toLowerCase())) ? top : '';
}
export function stripTop(path, top) { return top && path.startsWith(`${top}/`) ? path.slice(top.length + 1) : path; }

export function detectGames(files) {
  const seeds = files.filter(f => /^wbfs\//i.test(f.path) && GAME_EXTS.has(extOf(f.path)));
  const groups = new Map();
  for (const f of seeds) {
    const parts = f.path.split('/');
    const folder = parts.length > 2 ? parts.slice(0, 2).join('/') : '';
    const siblings = seeds.filter(x => x.path.slice(0,x.path.lastIndexOf('/')) === f.path.slice(0,f.path.lastIndexOf('/')));
    const key = (folder && siblings.length === 1 ? folder : f.path).toLowerCase();
    if (groups.has(key)) continue;
    const parent = f.path.slice(0, f.path.lastIndexOf('/')).toLowerCase();
    const members = files.filter(x => x.path === f.path || (extOf(f.path) === 'wbfs' &&
      x.path.slice(0, x.path.lastIndexOf('/')).toLowerCase() === parent &&
      stem(x.path).toLowerCase() === stem(f.path).toLowerCase() && /^wbf\d+$/i.test(extOf(x.path))));
    const label = folder ? parts[1] : baseName(f.path);
    const id = extractGameId(label) || extractGameId(baseName(f.path));
    let title = prettyTitleFromName(label, !folder);
    if (title === id || title === 'Game') title = id ? `Game ${id}` : title;
    groups.set(key, {type:'game', key, title, id, root: folder || f.path, paths:members.map(x=>x.path), size:members.reduce((n,x)=>n+x.size,0), format:extOf(f.path).toUpperCase()});
  }
  return [...groups.values()].sort((a,b)=>a.title.localeCompare(b.title));
}

export function detectRiivolutionHacks(files, manifest = {hacks:[]}) {
  const byPath = new Map(files.map(f=>[f.path.toLowerCase(),f]));
  const used = new Set(), result = [];
  for (const h of manifest.hacks || []) {
    const paths = h.paths.map(p=>byPath.get(p.toLowerCase())?.path).filter(Boolean);
    if (!paths.length) continue;
    paths.forEach(p=>used.add(p.toLowerCase()));
    result.push({type:'hack',key:`manifest:${h.id}`,manifestId:h.id,title:h.name,source:'Tracked package',paths,size:paths.reduce((n,p)=>n+byPath.get(p.toLowerCase()).size,0)});
  }
  // Saved settings inside riivolution/config are NOT installed hacks.
  for (const f of files) {
    if (!/^riivolution\/[^/]+\.xml$/i.test(f.path) || used.has(f.path.toLowerCase())) continue;
    const prefix = `riivolution/${stem(f.path)}/`.toLowerCase();
    const members = files.filter(x=>!used.has(x.path.toLowerCase()) && (x.path === f.path || x.path.toLowerCase().startsWith(prefix)));
    members.forEach(x=>used.add(x.path.toLowerCase()));
    result.push({type:'hack',key:`riivo:${f.path.toLowerCase()}`,title:prettyTitleFromName(f.path),source:'Riivolution · untracked',paths:members.map(x=>x.path),size:members.reduce((n,x)=>n+x.size,0)});
  }
  return result.sort((a,b)=>a.title.localeCompare(b.title));
}

export function validateManifest(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.hacks) || data.hacks.length > 2000) throw new Error('The manager manifest is invalid or from an unsupported version. Your ZIP has not been changed.');
  const ids = new Set(), allPaths = new Set();
  for (const h of data.hacks) {
    if (!h || typeof h.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(h.id) || ids.has(h.id) || typeof h.name !== 'string' || !Array.isArray(h.paths)) throw new Error('Invalid ROM-hack record in manager manifest.');
    ids.add(h.id);
    for (const path of h.paths) {
      assertArchivePath(path);
      const lower = path.toLowerCase();
      if (lower.startsWith(INTERNAL_ROOT) || allPaths.has(lower)) throw new Error('Overlapping or reserved paths in manager manifest.');
      allPaths.add(lower);
    }
    if (h.backups !== undefined && !Array.isArray(h.backups)) throw new Error('Invalid backup list in manager manifest.');
    for (const b of h.backups || []) {
      assertArchivePath(b.path); assertArchivePath(b.backupPath);
      if (!b.backupPath.startsWith(`${INTERNAL_ROOT}backups/${h.id}/`) || !h.paths.some(p=>p.toLowerCase()===b.path.toLowerCase())) throw new Error('Invalid backup path in manager manifest.');
    }
  }
  return data;
}
