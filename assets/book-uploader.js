/* Holds no secrets. Every request uses the active master-admin key from
   sessionStorage; private PDF data is sent in 3 MiB chunks to Netlify.
   An interrupted upload can resume when the SAME local file is selected. */
(() => {
  "use strict";
  const ENDPOINT="/.netlify/functions/book-upload";
  const STORAGE_PREFIX="vsh-private-pdf-upload-v1:";
  const MAX_BYTES=2*1024*1024*1024;
  const RETRIES=3;
  let currentController=null;
  const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
  const sha256=async bytes=>hex(await crypto.subtle.digest("SHA-256",bytes));
  const readItem=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const saveItem=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
  const removeItem=key=>{try{localStorage.removeItem(key)}catch{}};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function adminKey() {
    const key=sessionStorage.getItem("vsh_master_admin_key") || "";
    if(!key)throw Error("Your admin session has expired. Sign in again.");
    return key;
  }
  function abortError() {
    const e=new Error("Upload paused. Choose the same PDF and press Save product to resume.");
    e.name="AbortError";
    return e;
  }
  async function call(action, params={},opts={}) {
    const url=new URL(ENDPOINT,location.origin);
    url.searchParams.set("action",action);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    const h=new Headers(opts.headers || {});
    h.set("X-Admin-Key",adminKey());
    if(opts.body && !(opts.body instanceof ArrayBuffer)) h.set("Content-Type","application/json");
    const res=await fetch(url,{method:opts.method||"GET",headers:h,
      body:opts.body instanceof ArrayBuffer ? opts.body :
           opts.body ? JSON.stringify(opts.body) : undefined,
      signal:opts.signal,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) {
      const err=new Error(data.error || "PDF upload failed. Please retry.");
      err.status=res.status;
      throw err;
    }
    return data;
  }
  async function fingerprint(file) {
    const windowBytes=64*1024;
    const head=await file.slice(0,windowBytes).arrayBuffer();
    const tail=await file.slice(Math.max(0,file.size-windowBytes)).arrayBuffer();
    const meta=new TextEncoder().encode(file.size+":");
    const bytes=new Uint8Array(meta.length+head.byteLength+tail.byteLength);
    bytes.set(meta);
    bytes.set(new Uint8Array(head),meta.length);
    bytes.set(new Uint8Array(tail),meta.length+head.byteLength);
    return sha256(bytes);
  }
  async function partUpload(file,session,index,signal) {
    const part=file.slice(index*session.part_bytes,
      Math.min(file.size,(index+1)*session.part_bytes));
    const bytes=await part.arrayBuffer();
    if(signal.aborted)throw abortError();
    const hash=await sha256(bytes);
    if(signal.aborted)throw abortError();
    const url=new URL(ENDPOINT,location.origin);
    url.searchParams.set("action","part");
    url.searchParams.set("business",session.business);
    url.searchParams.set("id",session.id);
    url.searchParams.set("index",String(index));
    for(let attempt=0;attempt<RETRIES;attempt++) {
      if(signal.aborted)throw abortError();
      try{
        const res=await fetch(url,{
          method:"POST",cache:"no-store",signal,
          headers:{"X-Admin-Key":adminKey(),"Content-Type":"application/octet-stream",
            "X-Part-Sha256":hash},
          body:bytes
        });
        const result=await res.json().catch(()=>({}));
        if(!res.ok) {
          const err=new Error(result.error || "Part upload failed.");
          err.status=res.status;
          throw err;
        }
        return;
      }catch(err) {
        if(signal.aborted || err.name==="AbortError")throw abortError();
        if(attempt===RETRIES-1 || (err.status && ![408,429,500,502,503,504].includes(err.status)))throw err;
        await wait((attempt+1)*800);
      }
    }
  }
  function storageKey(business,file) {
    return STORAGE_PREFIX+business+":"+file.name+":"+file.size+":"+file.lastModified;
  }
  async function upload(file,business,onProgress=()=>{}) {
    if(currentController)throw Error("Finish or pause the current upload first.");
    if(!file || !/\.pdf$/i.test(file.name) || file.size<8 || file.size>MAX_BYTES)
      throw Error("Choose a PDF book up to 2 GB.");
    if(!["grannys","clever-cubs"].includes(business))throw Error("Invalid business.");
    const controller=new AbortController();
    currentController=controller;
    const signal=controller.signal;
    const key=storageKey(business,file);
    try {
      onProgress({phase:"checking",fraction:0,detail:"Checking your PDF…"});
      const fp=await fingerprint(file);
      let session=null,remembered;
      try{remembered=JSON.parse(readItem(key)||"null")}catch{}
      if(remembered?.id && remembered?.fingerprint===fp) {
        try {
          const status=await call("status",{business,id:remembered.id},{signal});
          if(status.status==="complete") {
            onProgress({phase:"complete",fraction:1,detail:"PDF already uploaded securely."});
            return {pdf_path:status.pdf_path,storageKey:key,size_bytes:file.size};
          }
          if(status.fingerprint===fp)session={...status,business,id:remembered.id};
        }catch(err) {
          if(signal.aborted)throw abortError();
          if(![404,410].includes(err.status))throw err;
          removeItem(key);
        }
      }
      if(!session) {
        session=await call("start",{},{
          method:"POST",signal,
          body:{business,filename:file.name,size_bytes:file.size,fingerprint:fp}
        });
        saveItem(key,JSON.stringify({id:session.id,fingerprint:fp}));
        session.uploaded=[];
      }
      const already=new Set(session.uploaded||[]);
      let done=already.size;
      const progress=()=>onProgress({phase:"uploading",fraction:done/session.part_count,
        detail:"Uploading PDF: "+done+" of "+session.part_count+" parts ("+
        Math.floor(done/session.part_count*100)+"%)"});
      progress();
      const pending=Array.from({length:session.part_count},(_,i)=>i)
        .filter(i=>!already.has(i));
      let cursor=0,firstError=null;
      const workers=Array.from({length:Math.min(3,pending.length)},async()=>{
        while(cursor<pending.length&&!firstError){
          const index=pending[cursor++];
          try{
            await partUpload(file,session,index,signal);
            done++;
            progress();
          }catch(error){
            if(!firstError)firstError=error;
            controller.abort();
          }
        }
      });
      await Promise.all(workers);
      if(firstError)throw firstError;
      if(signal.aborted)throw abortError();
      onProgress({phase:"finalizing",fraction:1,detail:"Verifying all parts and sealing your private PDF…"});
      const finished=await call("finalize",{business,id:session.id},{method:"POST",signal});
      onProgress({phase:"complete",fraction:1,detail:"Private PDF uploaded. Saving product…"});
      return {pdf_path:finished.pdf_path,storageKey:key,size_bytes:file.size};
    }catch(error){
      if(signal.aborted || error.name==="AbortError")throw abortError();
      throw error;
    }finally{currentController=null}
  }
  window.VSH_BOOK_UPLOADER={
    upload,
    pause(){currentController?.abort()},
    isActive(){return currentController!==null},
    clearSaved(uploadResult){if(uploadResult?.storageKey)removeItem(uploadResult.storageKey)}
  };
})();
