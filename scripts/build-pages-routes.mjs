import { cp, mkdir, readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
const index=new URL("pages-dist/index.html",root);
const evidence=new URL("pages-dist/evidence/",root);
await mkdir(evidence,{recursive:true});
await cp(index,new URL("index.html",evidence));

const payload=JSON.parse(await readFile(new URL("public/evidence_data/index.json",root),"utf8"));
for(const document of payload.documents){
  const directory=new URL(`pages-dist/510k/${document.k_number}/`,root);
  await mkdir(directory,{recursive:true});
  await cp(index,new URL("index.html",directory));
}

