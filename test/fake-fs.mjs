/** Test-only File System Access adapter; never bundled in the website. */
function dom(name,message=name){return new DOMException(message,name);}
function join(a,b){return a?`${a}/${b}`:b;}
export class MemoryFS {
  constructor(entries={}) {
    this.nodes=new Map([['',{kind:'directory'}]]);this.clock=1000;this.online=true;this.permission='granted';this.hook=()=>{};
    this.readBytes=0;this.fullReads=0;this.writes=[];this.metadataReads=0;
    for(const [path,content] of Object.entries(entries))this.seed(path,content);
    this.root=this.handle('');
  }
  check(event,path,data) {
    if(!this.online)throw dom('NotFoundError','Drive disconnected');
    if(['write','close','remove','create'].includes(event)&&this.permission!=='granted')throw dom('NotAllowedError');
    this.hook(event,path,data);
  }
  seed(path,content) {
    const parts=path.split('/');
    for(let i=1;i<parts.length;i++)this.nodes.set(parts.slice(0,i).join('/'),{kind:'directory'});
    if(path.endsWith('/')){this.nodes.set(path.slice(0,-1),{kind:'directory'});return;}
    const virtual=content&&typeof content==='object'&&!ArrayBuffer.isView(content)&&!(content instanceof Blob)&&'virtualSize' in content;
    this.nodes.set(path,{kind:'file',blob:virtual?null:new Blob([content]),virtual:virtual?content:null,lastModified:++this.clock});
  }
  handle(path) {
    const fs=this,node=this.nodes.get(path);if(!node)throw dom('NotFoundError');
    const common={name:path.split('/').pop()||'Test-Wii-card',kind:node.kind,
      async queryPermission(){return fs.permission;},async requestPermission(){return fs.permission;},
      async isSameEntry(other){return other._fs===fs&&other._path===path;},_fs:fs,_path:path};
    if(node.kind==='directory')return {...common,
      async *values(){fs.check('list',path);const prefix=path?path+'/':'';for(const p of [...fs.nodes.keys()])if(p.startsWith(prefix)&&p!==path&&!p.slice(prefix.length).includes('/'))yield fs.handle(p);},
      async getDirectoryHandle(name,{create=false}={}){return child(name,'directory',create);},
      async getFileHandle(name,{create=false}={}){return child(name,'file',create);},
      async removeEntry(name,{recursive=false}={}){
        const target=join(path,name);fs.check('remove',target);const n=fs.nodes.get(target);if(!n)throw dom('NotFoundError');
        const children=[...fs.nodes.keys()].filter(p=>p.startsWith(target+'/'));
        if(n.kind==='directory'&&children.length&&!recursive)throw dom('InvalidModificationError');
        fs.nodes.delete(target);if(recursive)for(const p of children)fs.nodes.delete(p);
        fs.check('removed',target);
      }};
    return {...common,
      async getFile(){fs.check('read-metadata',path);fs.metadataReads++;const current=fs.nodes.get(path);if(!current)throw dom('NotFoundError');
        const wrap=(blob,start=0,length=blob?.size??current.virtual.virtualSize)=>({
          name:common.name,size:length,lastModified:current.lastModified,
          slice(from=0,to=length){const n=Math.max(0,Math.min(to,length)-from);if(current.virtual){return {size:n,async arrayBuffer(){fs.check('read',path);fs.readBytes+=n;if(n>16*1024**2)throw new Error('Virtual large file must not be materialized');const b=new Uint8Array(n);if(start+from===0&&current.virtual.header)b.set(new TextEncoder().encode(current.virtual.header).slice(0,n));return b.buffer;}};}return wrap(blob.slice(from,to),start+from,n);},
          async arrayBuffer(){fs.check('read',path);fs.readBytes+=length;if(length===(current.blob?.size??current.virtual.virtualSize))fs.fullReads++;if(!blob)throw new Error('Never read whole virtual file');return blob.arrayBuffer();},
          async text(){return new TextDecoder().decode(await this.arrayBuffer());}
        });return wrap(current.blob);
      },
      async createWritable(){fs.check('create-writer',path);let parts=[],closed=false;
        return {
          async write(data){if(closed)throw dom('InvalidStateError');fs.check('write',path,data);const bytes=typeof data==='string'?new TextEncoder().encode(data):data instanceof Blob?new Uint8Array(await data.arrayBuffer()):new Uint8Array(data);parts.push(bytes.slice());fs.writes.push({path,size:bytes.length});},
          async close(){if(closed)throw dom('InvalidStateError');fs.check('close',path);const blob=new Blob(parts);fs.nodes.set(path,{kind:'file',blob,lastModified:++fs.clock});closed=true;parts=[];fs.check('closed',path);},
          async abort(){parts=[];closed=true;fs.check('aborted',path);}
        };
      }};
    function child(name,kind,create) {
      fs.check('lookup',join(path,name));if(!name||name.includes('/')||name==='.'||name==='..')throw new TypeError('Unsafe segment');
      const target=join(path,name);let n=fs.nodes.get(target);
      if(!n){if(!create)throw dom('NotFoundError');fs.check('create',target);n=kind==='file'?{kind,blob:new Blob([]),lastModified:++fs.clock}:{kind};fs.nodes.set(target,n);}
      if(n.kind!==kind)throw dom('TypeMismatchError');return fs.handle(target);
    }
  }
  async text(path){return this.nodes.get(path)?.blob?.text();}
  paths(){return [...this.nodes.keys()].filter(p=>this.nodes.get(p).kind==='file'&&!p.includes('/transactions/')).sort();}
}
