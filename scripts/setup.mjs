import fs from 'node:fs/promises';
import {dataHome,registryFile} from './paths.mjs';

if(process.argv.length>2) throw Error('Usage: set PROGRESS_CARD_HOME, then node scripts/setup.mjs');
await fs.mkdir(dataHome(),{recursive:true});
try {
  await fs.writeFile(registryFile(),JSON.stringify({version:1,active:{},entries:[]},null,2)+'\n',{flag:'wx'});
  console.log('Created empty registry: '+registryFile());
} catch(error) {
  if(error.code!=='EEXIST') throw error;
  console.log('Existing registry preserved: '+registryFile());
}
