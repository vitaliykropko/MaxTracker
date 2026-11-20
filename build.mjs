import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({entryPoints:{'max-bridge':'src/max-bridge.js',content:'src/content.js',background:'src/background.js',options:'src/options.js'},outdir:'extension',bundle:true,format:'iife',target:'chrome120',legalComments:'none',sourcemap:false,loader:{'.css':'text'}});
for(const size of [48,128])await copyFile(`assets/icon${size}.png`,`extension/icon${size}.png`);
