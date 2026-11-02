/* Private paid-book page: only first-party source, no analytics/third-party JS.
 * Link secret is in URL fragment only; remove it from the address bar before
 * fetching anything and retain only in this tab's memory. NEVER localStorage.
 */
import {tokenFromFragment,savePaidBook} from "./book-download-core.js";

const status=document.getElementById("state");
const details=document.getElementById("detail");
const progress=document.getElementById("progress");
const save=document.getElementById("save");
const cancel=document.getElementById("cancel");
const token=tokenFromFragment(window.location.hash);
// Scrub the fragment even if invalid, including browser history and reload URL.
history.replaceState(null,"",window.location.pathname);
const setStatus=text=>{status.textContent=text};
let active=false;
let abortController=null;

if(token){
  setStatus("Your download link is ready. Choose Save my PDF to begin.");
  save.disabled=false;
}else{
  setStatus("No valid private book link was found. Please reopen your email link.");
}
cancel.addEventListener("click",()=>abortController?.abort());

async function saveSmall(bytes){
  // The only in-memory fallback is one <=3 MiB piece, never a full large PDF.
  const blob=new Blob([bytes],{type:"application/pdf"});
  const url=URL.createObjectURL(blob);
  try{
    const anchor=document.createElement("a");
    anchor.href=url;
    anchor.download="Purchased-book.pdf";
    anchor.rel="noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }finally{
    // Chrome/Firefox defer URL consumption until the click handler returns.
    window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
}
save.addEventListener("click",async()=>{
  if(!token || active)return;
  active=true;
  save.disabled=true;
  cancel.hidden=false;
  cancel.disabled=false;
  abortController=new AbortController();
  progress.hidden=false;
  progress.value=0;
  setStatus("Preparing your PDF…");
  let writable=null;
  try{
    if(typeof window.showSaveFilePicker==="function"){
      // MUST be invoked synchronously in the user-click handler before an
      // await (otherwise browsers reject it for lack of user activation).
      const handle=await window.showSaveFilePicker({
        suggestedName:"Purchased-book.pdf",
        types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]
      });
      writable=await handle.createWritable();
    }
    const outcome=await savePaidBook(token,{
      writer:writable,
      saveSmall,
      signal:abortController.signal,
      onProgress({saved,total,part,partCount}){
        progress.max=total;
        progress.value=saved;
        details.textContent=part+" of "+partCount+" parts · "+
          Math.round(saved/1024/1024)+" MB of "+Math.round(total/1024/1024)+" MB";
        setStatus("Saving your purchased book securely…");
      }
    });
    setStatus("Your PDF has been saved.");
    details.textContent=outcome.parts+" verified part(s) downloaded.";
  }catch(error){
    if(error?.name==="AbortError" || abortController?.signal.aborted)
      setStatus("The download was cancelled.");
    else
      setStatus(error instanceof Error?error.message:"Your book could not be downloaded.");
    details.textContent="You can try again while your private link remains valid.";
  }finally{
    active=false;
    abortController=null;
    cancel.hidden=true;
    save.disabled=false;
  }
});
