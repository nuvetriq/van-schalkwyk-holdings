import { mkdir, readdir, cp, rm } from "node:fs/promises";
import path from "node:path";
const root=process.cwd(), target=path.join(root,"dist");
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
for(const item of await readdir(root,{withFileTypes:true})){
  if(item.isFile() && /\.html$/i.test(item.name)){
    await cp(path.join(root,item.name),path.join(target,item.name));
  }
}
await cp(path.join(root,"assets"),path.join(target,"assets"),{recursive:true});
console.log("Built public website into dist. Private PDFs, Netlify functions, keys and source docs are excluded.");
