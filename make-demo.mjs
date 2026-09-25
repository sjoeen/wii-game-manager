import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeDemo} from './model.js';
const require=createRequire(import.meta.url), JSZip=require('./vendor/jszip.min.js');
const folder=new URL('./demo/',import.meta.url);await mkdir(folder,{recursive:true});
const demo=await makeDemo(JSZip);await writeFile(new URL('Demo-SD-card.zip',folder),await demo.exportBlob(()=>{},'nodebuffer'));
const add=new JSZip();
add.file('Demo-addon/config/keep-me.txt','DEMO: this add-on replaces the original configuration. Remove the add-on to restore it.\n',{createFolders:false});
add.file('Demo-addon/riivolution/Moonlight.xml','<wiidisc version="1"><options/></wiidisc>\n',{createFolders:false});
add.file('Demo-addon/riivolution/Moonlight/palette.txt','DEMO ONLY. Not a usable patch.\n',{createFolders:false});
await writeFile(new URL('Demo-add-on.zip',folder),await add.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
await writeFile(new URL('New-Game [DEME03].wbfs',folder),'DEMO ONLY: a non-playable placeholder for testing the Add game button.\n');
await writeFile(new URL('New-Game [DEME03].wbf1',folder),'DEMO ONLY: pretend split companion. Select this together with the .wbfs.\n');
await writeFile(new URL('README.txt',folder),'DEMO FILES ONLY — DO NOT PUT THESE ON A WII.\n\nImport Demo-SD-card.zip or use the built-in demo.\nOn ROM Hacks, add Demo-add-on.zip (strip the outer folder). It replaces config/keep-me.txt with a backup. Remove the add-on to restore the original.\nOn Games, select BOTH New-Game files to test split-game import.\nAll game and patch files here are tiny text placeholders, not copyrighted game content or playable software.\n');
console.log('Created small, non-playable test fixtures in demo/.');

