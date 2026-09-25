/** Test-only adapter: actual disk bytes, using bounded file-backed ranges.
 * It models the browser's close-to-commit writable semantics. This is not a
 * browser permission test or proof of physical FAT32/Wii compatibility.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
function dom(error){if(error.code==='ENOENT')return new DOMException(error.message,'NotFoundError');if(error.code==='ENOTDIR'||error.code==='EISDIR')return new DOMException(error.message,'TypeMismatchError');return error;}
export class NativeFS {
  constructor(base) { this.base=path.resolve(base);this.maxChunk=0;this.wholeReads=0;this.readBytes=0;this.writtenBytes=0;this.metadataReads=0;this.root=this.handle('', 'directory'); }
  async blob(filePath,name) {
    // Node 22 openAsBlob truncates a 5 GiB file's reported size modulo 2^32.
    // Model a browser File with actual stat size and positional slice reads.
    const baseline=await fs.stat(filePath);this.metadataReads++;
    const self=this;
    function range(offset,length) {
      return {name,size:length,lastModified:baseline.mtimeMs,
        slice(start=0,end=length){const from=Math.max(0,Math.min(start,length)),to=Math.max(from,Math.min(end,length));return range(offset+from,to-from);},
        async arrayBuffer(){
          if(length>16*1024**2)throw new Error('Whole large file read forbidden by test adapter');
          const stat=await fs.stat(filePath);if(stat.size!==baseline.size||stat.mtimeMs!==baseline.mtimeMs)throw new Error('Source file changed');
          const bytes=new Uint8Array(length),f=await fs.open(filePath,'r');let n=0;
          try{while(n<length){const r=await f.read(bytes,n,length-n,offset+n);if(!r.bytesRead)throw new Error('Unexpected end of file');n+=r.bytesRead;}}finally{await f.close();}
          self.readBytes+=length;if(offset===0&&length===baseline.size)self.wholeReads++;
          return bytes.buffer;
        },async text(){return new TextDecoder().decode(await this.arrayBuffer());}
      };
    }
    return range(0,baseline.size);
  }
  handle(relative,kind) {
    const self=this,absolute=path.join(this.base,relative),name=path.basename(absolute);
    const common={kind,name,async queryPermission(){return 'granted';},async requestPermission(){return 'granted';}};
    if(kind==='file')return {...common,
      async getFile(){try{return await self.blob(absolute,name);}catch(e){throw dom(e);}},
      async createWritable(){const temporary=absolute+'.wgm-test-temp-'+crypto.randomUUID();const f=await fs.open(temporary,'wx');let pos=0,closed=false;
        return {async write(data){if(closed)throw Error('writer closed');const bytes=typeof data==='string'?Buffer.from(data):new Uint8Array(data);self.maxChunk=Math.max(self.maxChunk,bytes.length);self.writtenBytes+=bytes.length;let n=0;while(n<bytes.length){const result=await f.write(bytes,n,bytes.length-n,pos);n+=result.bytesWritten;pos+=result.bytesWritten;}},async close(){await f.sync();await f.close();closed=true;await fs.rename(temporary,absolute);},async abort(){if(!closed)await f.close();closed=true;await fs.rm(temporary,{force:true});}};
      }};
    return {...common,
      async *values(){let entries;try{entries=await fs.readdir(absolute,{withFileTypes:true});}catch(e){throw dom(e);}for(const e of entries){if(e.isSymbolicLink())throw Error('Test adapter refuses symbolic links');yield self.handle(path.posix.join(relative,e.name),e.isDirectory()?'directory':'file');}},
      async getDirectoryHandle(child,{create=false}={}){return lookup(child,'directory',create);},async getFileHandle(child,{create=false}={}){return lookup(child,'file',create);},
      async removeEntry(child,{recursive=false}={}){const target=path.join(absolute,child);try{const s=await fs.lstat(target);if(s.isDirectory())await fs.rm(target,{recursive,force:false});else await fs.unlink(target);}catch(e){throw dom(e);}}
    };
    async function lookup(child,expected,create) {
      if(!child||child==='.'||child==='..'||/[\\/]/.test(child))throw new TypeError('bad segment');const target=path.join(absolute,child);
      try{const stat=await fs.lstat(target);if(stat.isSymbolicLink()||(expected==='directory'?!stat.isDirectory():!stat.isFile()))throw new DOMException('Wrong entry type','TypeMismatchError');}
      catch(e){if(e.code!=='ENOENT'||!create)throw dom(e);if(expected==='directory')await fs.mkdir(target);else{const f=await fs.open(target,'wx');await f.close();}}
      return self.handle(path.posix.join(relative,child),expected);
    }
  }
}
