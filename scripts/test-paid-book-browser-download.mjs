import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
 tokenFromFragment,fetchPaidBookPart,savePaidBook,PART_BYTES,MAX_BYTES,ENDPOINT
} from "../assets/book-download-core.js";

const token="T".repeat(43);
const first=new Uint8Array(PART_BYTES);first.set(new TextEncoder().encode("%PDF-1.7"));
const last=new Uint8Array(171);last.set(new TextEncoder().encode("%%EOF"),166);
const small=new TextEncoder().encode("%PDF-1.7 example small book %%EOF");

function network(parts=[small],{status=200,corrupt={},onCall=()=>{}}={}){
 const total=parts.reduce((sum,p)=>sum+p.byteLength,0);
 const calls=[];
 const transport=async(url,options)=>{
   calls.push({url,options});
   onCall(url,options);
   const parsed=JSON.parse(options.body);
   const index=parsed.part;
   if(!Number.isInteger(index) || index<0 || index>=parts.length)
     throw Error("Unexpected part request");
   const bytes=parts[index];
   const responseHeaders={
     "Content-Type":"application/octet-stream",
     "Content-Length":String(bytes.byteLength),
     "X-Book-Part-Index":String(index),
     "X-Book-Part-Count":String(parts.length),
     "X-Book-Total-Bytes":String(total),
     ...(corrupt[index]||{})
   };
   return new Response(bytes,{status,headers:responseHeaders});
 };
 return {calls,transport};
}
function writer(){
 const chunks=[];let closed=false,aborted=false;
 return {
   chunks,
   get closed(){return closed},
   get aborted(){return aborted},
   async write(bytes){chunks.push(Uint8Array.from(bytes))},
   async close(){closed=true},
   async abort(){aborted=true}
 };
}
test("Link token stays only in fragment and is never sent in page URL",()=>{
 assert.equal(tokenFromFragment("#token="+token),token);
 assert.equal(tokenFromFragment("#token="+token+"&part=1"),null);
 assert.equal(tokenFromFragment("#token=bad"),null);
 assert.equal(tokenFromFragment("?token="+token),null);
 assert.equal(tokenFromFragment("#anythingElse="+token),null);
});
test("Fetch exactly one PDF part over POST with bearer header and no URL secret",async()=>{
 const net=network();
 const got=await fetchPaidBookPart(token,0,{transport:net.transport});
 assert.equal(got.length,small.length);
 assert.deepEqual(got.bytes,small);
 assert.equal(net.calls[0].url,ENDPOINT);
 assert.ok(!net.calls[0].url.includes(token));
 assert.equal(net.calls[0].options.method,"POST");
 assert.equal(net.calls[0].options.headers.Authorization,"Bearer "+token);
 assert.equal(net.calls[0].options.cache,"no-store");
 assert.equal(net.calls[0].options.credentials,"omit");
 assert.equal(net.calls[0].options.referrerPolicy,"no-referrer");
 assert.equal(net.calls[0].options.redirect,"error");
 assert.equal(net.calls[0].options.mode,"same-origin");
 assert.deepEqual(JSON.parse(net.calls[0].options.body),{part:0});
});
test("Single small book uses bounded Blob fallback if disk picker unavailable",async()=>{
 const net=network();
 const blobs=[];
 const outcome=await savePaidBook(token,{
   transport:net.transport,saveSmall:async b=>blobs.push(b),
   onProgress:()=>{}
 });
 assert.deepEqual(outcome,{bytes:small.byteLength,parts:1});
 assert.equal(blobs.length,1);
 assert.deepEqual(blobs[0],small);
 assert.equal(net.calls.length,1);
});
test("Large book writes its parts sequentially to disk and reports progress",async()=>{
 const w=writer(),net=network([first,last]),progress=[];
 const outcome=await savePaidBook(token,{
   transport:net.transport,writer:w,onProgress:x=>progress.push(x)
 });
 assert.deepEqual(outcome,{bytes:PART_BYTES+171,parts:2});
 assert.equal(w.closed,true);
 assert.equal(w.aborted,false);
 assert.equal(w.chunks.length,2);
 assert.deepEqual(w.chunks[0],first);
 assert.deepEqual(w.chunks[1],last);
 assert.deepEqual(progress.map(p=>p.part),[1,2]);
 assert.deepEqual(progress.map(p=>p.saved),[PART_BYTES,PART_BYTES+171]);
 assert.equal(net.calls.length,2);
 assert.ok(net.calls.every(call=>call.url===ENDPOINT));
});
test("No disk writer refuses large files BEFORE buffering or downloading every part",async()=>{
 const net=network([first,last]),blobs=[];
 await assert.rejects(savePaidBook(token,{
   transport:net.transport,
   saveSmall:async bytes=>blobs.push(bytes)
 }),/desktop browser/);
 assert.equal(net.calls.length,1);
 assert.deepEqual(blobs,[]);
});
test("Wrong part metadata, content length and totals abort disk file safely",async()=>{
 for(const corrupt of [
   {1:{"X-Book-Part-Index":"0"}},
   {1:{"X-Book-Part-Count":"3"}},
   {1:{"X-Book-Total-Bytes":String(PART_BYTES+300)}},
   {1:{"Content-Length":"172"}},
   {1:{"Content-Type":"text/html"}}
 ]){
   const w=writer(),net=network([first,last],{corrupt});
   await assert.rejects(savePaidBook(token,{transport:net.transport,writer:w}));
   assert.equal(w.aborted,true);
   assert.equal(w.closed,false);
 }
});
test("Bad PDF signature or missing final EOF cannot save bytes",async()=>{
 const badHeader=Uint8Array.from(small);badHeader[0]=88;
 const badEOF=Uint8Array.from(small);badEOF.fill(88,badEOF.length-5);
 for(const part of [badHeader,badEOF]){
   const w=writer(),net=network([part]);
   await assert.rejects(savePaidBook(token,{transport:net.transport,writer:w}));
   assert.equal(w.aborted,true);
   assert.deepEqual(w.chunks,[]);
 }
});
test("Expired token or cancelled transfer aborts without completing the file",async()=>{
 const w=writer(),net=network([first,last],{status:404});
 await assert.rejects(savePaidBook(token,{transport:net.transport,writer:w}));
 assert.equal(w.aborted,true);
 const q=writer(),controller=new AbortController();
 const local=network([first,last],{
   onCall(url,opts){
     if(JSON.parse(opts.body).part===1)controller.abort();
   }
 });
 await assert.rejects(savePaidBook(token,{
   writer:q,transport:local.transport,signal:controller.signal
 }));
 assert.equal(q.aborted,true);
});
test("Preflight refuses malformed token/part and oversized or inconsistent lengths",async()=>{
 const net=network();
 for(const [t,index] of [["bad",0],[token,-1],[token,10000],[token,"0"]])
   await assert.rejects(fetchPaidBookPart(t,index,{transport:net.transport}));
 assert.equal(net.calls.length,0);
 const huge=network([first],{corrupt:{0:{"X-Book-Total-Bytes":String(MAX_BYTES+1)}}});
 await assert.rejects(fetchPaidBookPart(token,0,{transport:huge.transport}));
 const invalid=network([small],{corrupt:{0:{"X-Book-Part-Count":"2"}}});
 await assert.rejects(fetchPaidBookPart(token,0,{transport:invalid.transport}));
});
test("Only same-origin private download page is built; no activation in shops",async()=>{
 const html=await readFile("book-download.html","utf8");
 const js=await readFile("assets/book-download.js","utf8");
 const core=await readFile("assets/book-download-core.js","utf8");
 const email=await readFile("netlify/lib/mixed-book-email-templates.mjs","utf8");
 assert.match(html,/name="referrer" content="no-referrer"/);
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/assets\/book-download\.js/);
 assert.match(js,/history\.replaceState/);
 assert.match(js,/showSaveFilePicker/);
 assert.match(js,/savePaidBook/);
 assert.match(core,/credentials:"omit"/);
 assert.match(email,/book-download\.html/);
 assert.doesNotMatch(email,/\/\.netlify\/functions\/paid-book-download"/);
 for(const page of ["grannys-little-bakery.html","clever-cubs-learning.html"]){
   const html=await readFile(page,"utf8");
   assert.doesNotMatch(html,/book-download\.html/);
 }
});
