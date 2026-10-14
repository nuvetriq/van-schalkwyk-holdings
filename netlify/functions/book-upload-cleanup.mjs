import { openVSHStore } from "../lib/catalogue-store.mjs";

// Automatically remove ABANDONED upload chunks after the 7-day resume window.
// Never delete published books, sealed manifests or completed sessions.
// Bounded per execution to respect the 30-second scheduled-function limit.
export default async function handler() {
  const sessions=openVSHStore("vsh-book-upload-sessions");
  const chunks=openVSHStore("vsh-private-book-parts");
  const pdfs=openVSHStore("vsh-private-recipe-pdfs");
  let deleted=0,visited=0;
  const {blobs}=await sessions.list();
  for(const entry of blobs) {
    if(deleted>=80 || visited>=20)break;
    const session=await sessions.get(entry.key,{type:"json"});
    if(!session || session.status!=="uploading" ||
       !Number.isFinite(Date.parse(session.expires_at)) ||
       Date.parse(session.expires_at)>Date.now())continue;
    if(!["grannys","clever-cubs"].includes(session.business) ||
       !/^[0-9a-f-]{36}$/i.test(session.id))continue;
    visited++;
    // A crash immediately after finalization could leave the session marked
    // uploading. In that case the sealed book manifest wins; NEVER delete it.
    if(await pdfs.getMetadata(session.business+"/"+session.id+".manifest.json"))continue;
    const prefix=session.business+"/"+session.id+"/part/";
    const parts=(await chunks.list({prefix})).blobs.slice(0,80-deleted);
    for(const part of parts) {
      await chunks.delete(part.key);
      deleted++;
    }
    if(parts.length===0 || !(await chunks.list({prefix})).blobs.length) {
      await sessions.delete(entry.key);
    }
  }
  console.log("Expired private PDF parts removed:",deleted);
}
export const config={schedule:"0 2 * * *"};
