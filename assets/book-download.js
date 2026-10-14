/* Private purchased-PDF download page. All data is retrieved from one-time
   signed expiring book links validated on the server against paid orders.
   No user credentials, PDF keys or customer records are in this script. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const token=new URLSearchParams(location.search).get("token")||"";
  const endpoint="/.netlify/functions/book-download";
  const smallLimit=75*1024*1024;
  let info=null,downloading=false;
  const status=(msg,bad=false)=>{
    $("download-status").textContent=msg;
    $("download-status").classList.toggle("error",!!bad);
  };
  const human=bytes=>bytes<1024*1024?(bytes/1024).toFixed(1)+" KB":(bytes/1024/1024).toFixed(1)+" MB";
  const uri=(action,index)=>{
    const q=new URLSearchParams({action,token});
    if(index!==undefined)q.set("index",String(index));
    return endpoint+"?"+q;
  };
  function progress(completed,total){
    const frac=total>0?completed/total:0;
    $("book-progress").value=Math.round(frac*100);
    $("progress-percent").textContent=Math.floor(frac*100)+"%";
    $("progress-label").textContent="Downloading "+completed+" of "+total+" parts";
  }
  async function fetchPart(index) {
    for(let attempt=0;attempt<3;attempt++){
      try {
        const result=await fetch(uri("part",index),{cache:"no-store",referrerPolicy:"no-referrer"});
        if(!result.ok) {
          let err="The private download is unavailable.";
          try{err=(await result.json()).error||err}catch{}
          const fail=new Error(err);
          fail.status=result.status;
          throw fail;
        }
        const bytes=await result.arrayBuffer();
        const expected=index===info.part_count-1
          ? info.size_bytes-index*info.chunk_bytes:info.chunk_bytes;
        if(bytes.byteLength!==expected)
          throw new Error("A PDF part arrived incomplete. Please retry.");
        return bytes;
      } catch(error) {
        if(error.status && ![429,500,502,503,504].includes(error.status))throw error;
        if(attempt===2)throw error;
        await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1000));
      }
    }
  }
  async function saveWithPicker(){
    // Must be called directly from a click before any async network work.
    const handle=await showSaveFilePicker({
      suggestedName:info.filename,
      types:[{description:"PDF book",accept:{"application/pdf":[".pdf"]}}]
    });
    const writable=await handle.createWritable();
    let wrote=false;
    try{
      for(let i=0;i<info.part_count;i++){
        const chunk=await fetchPart(i);
        await writable.write(chunk);
        progress(i+1,info.part_count);
      }
      await writable.close();
      wrote=true;
    } finally{
      if(!wrote)await writable.abort().catch(()=>{});
    }
  }
  async function saveSmall(){
    if(info.size_bytes>smallLimit)
      throw new Error("For this large PDF, please open your link in desktop Chrome or Edge to save it safely without filling your browser memory.");
    const chunks=[];
    for(let i=0;i<info.part_count;i++){
      chunks.push(await fetchPart(i));
      progress(i+1,info.part_count);
    }
    const file=new Blob(chunks,{type:"application/pdf"});
    const objectURL=URL.createObjectURL(file);
    try {
      const a=document.createElement("a");
      a.href=objectURL;
      a.download=info.filename;
      a.style.display="none";
      document.body.append(a);a.click();a.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(objectURL),60000)}
  }
  $("save-book").addEventListener("click",async()=>{
    if(!info || downloading)return;
    downloading=true;$("save-book").disabled=true;$("book-progress-area").hidden=false;
    progress(0,info.part_count);
    try {
      if("showSaveFilePicker" in window && window.isSecureContext)await saveWithPicker();
      else await saveSmall();
      status("Your PDF was saved. Enjoy your book! 💛");
    } catch(error){
      if(error?.name==="AbortError")status("Download cancelled. You can start again.");
      else status(error?.message||"The download failed. Please try again.",true);
    }finally{
      downloading=false;$("save-book").disabled=false;
    }
  });
  (async()=>{
    if(!token || token.length>2048){status("This book link is missing or invalid. Please check your purchase email.",true);return;}
    try{
      const resp=await fetch(uri("info"),{cache:"no-store",referrerPolicy:"no-referrer"});
      const data=await resp.json().catch(()=>({}));
      if(!resp.ok)throw new Error(data.error||"Your private link is invalid or expired.");
      if(!Number.isSafeInteger(data.size_bytes)||data.size_bytes<8||
         !Number.isSafeInteger(data.part_count)||data.part_count<1||
         !Number.isSafeInteger(data.chunk_bytes)||data.chunk_bytes<1)
        throw new Error("The book isn't ready for download yet.");
      info=data;
      $("book-title").textContent=data.title;
      $("book-size").textContent="PDF · "+human(data.size_bytes);
      $("book-expiry").textContent="Link expires: "+new Date(data.expires_at).toLocaleString();
      $("book-details").hidden=false;
      status("Your private link is ready. Choose where to save your PDF.");
    }catch(error){status(error.message||"Could not verify this link.",true)}
  })();
})();
