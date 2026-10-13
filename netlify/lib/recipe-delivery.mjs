import { privatePDFStore, casOrder, ordersStore, orderKey } from "./recipe-orders.mjs";
const LEASE_MS=3*60*1000;
function safeFilename(name,index) {
  const plain=String(name).normalize("NFKD").replace(/[^A-Za-z0-9 _-]/g,"").trim().slice(0,62);
  return (plain.replace(/\s+/g,"-") || "Grannys-Recipe-Book")+"-"+(index+1)+".pdf";
}
export async function deliverRecipeOrder(id) {
  const now=Date.now();
  const token=(await import("node:crypto")).randomUUID();
  const locked=await casOrder(id,order=>{
    if(order.status!=="paid" || order.email_status==="sent") return null;
    const last=Date.parse(order.email_started_at||"");
    if(order.email_status==="sending" && Number.isFinite(last) && now-last<LEASE_MS) return null;
    return {...order,email_status:"sending",email_started_at:new Date(now).toISOString(),
      delivery_token:token,attempts:(order.attempts||0)+1,updated_at:new Date(now).toISOString()};
  });
  if(!locked || !locked.changed) return {sent:false,reason:"already_processed_or_processing"};
  const order=locked.order;
  try {
    const viaResend=Boolean(process.env.RESEND_API_KEY && process.env.VSH_RECIPE_EMAIL_FROM);
    const viaGmail=Boolean(process.env.VSH_GMAIL_USER && process.env.VSH_GMAIL_APP_PASSWORD);
    if(!viaResend && !viaGmail) throw Error("Email service not configured.");
    const pdfs=await Promise.all(order.items.map(i=>privatePDFStore().get(i.pdfPath,{type:"arrayBuffer"})));
    if(pdfs.some(p=>!p || p.byteLength<8 || p.byteLength>3*1024*1024))throw Error("A purchased PDF is missing or too large.");
    const totalSize=pdfs.reduce((n,p)=>n+p.byteLength,0);
    if(totalSize>12*1024*1024)throw Error("Attachment email size limit exceeded.");
    const attachments=pdfs.map((bytes,i)=>({
      filename:safeFilename(order.items[i].title,i),
      content:Buffer.from(bytes).toString("base64"),
      content_type:"application/pdf"
    }));
    const titles=order.items.map((it,i)=>"  "+(i+1)+". "+it.title).join("\n");
    const message="Hello "+order.name+",\n\nThank you for your purchase from Granny's! ❤️\n\n"+
      "Your recipe books are attached to this email:\n"+titles+"\n\n"+
      "Order reference: "+order.id+"\n"+
      "Paid: R"+(order.amount/100).toFixed(2)+"\n\n"+
      "Happy baking,\nGranny's — Made with Love\n\n"+
      "Need help? Reply to this email.";
    let messageId;
    if(viaResend) {
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json",
          "Idempotency-Key":"grannys-recipe-"+order.id},
        body:JSON.stringify({
          from:process.env.VSH_RECIPE_EMAIL_FROM,
          to:[order.email],
          reply_to:process.env.VSH_RECIPE_REPLY_TO || undefined,
          subject:"Your Granny's recipe books are here! ❤️",
          text:message,
          attachments
        })
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || !result.id) throw Error("Email provider rejected delivery ("+response.status+")");
      messageId=result.id;
    } else {
      const {default:nodemailer}=await import("nodemailer");
      const transport=nodemailer.createTransport({
        host:"smtp.gmail.com",port:465,secure:true,
        auth:{user:process.env.VSH_GMAIL_USER,pass:process.env.VSH_GMAIL_APP_PASSWORD}
      });
      const result=await transport.sendMail({
        from:`Granny's <${process.env.VSH_GMAIL_USER}>`,
        to:order.email,
        replyTo:process.env.VSH_RECIPE_REPLY_TO || process.env.VSH_GMAIL_USER,
        subject:"Your Granny's recipe books are here! ❤️",
        text:message,
        attachments:pdfs.map((bytes,i)=>({
          filename:safeFilename(order.items[i].title,i),
          content:Buffer.from(bytes),
          contentType:"application/pdf"
        })),
        headers:{"X-Grannys-Order-Reference":order.id}
      });
      messageId=result.messageId;
    }
    await casOrder(id,latest=>{
      if(latest.delivery_token!==token || latest.email_status==="sent")return null;
      return {...latest,email_status:"sent",email_sent_at:new Date().toISOString(),
        provider_message_id:messageId,updated_at:new Date().toISOString(),delivery_token:null};
    });
    return {sent:true};
  } catch(error) {
    await casOrder(id,latest=>{
      if(latest.delivery_token!==token || latest.email_status==="sent") return null;
      return {...latest,email_status:"failed",delivery_token:null,
        updated_at:new Date().toISOString()};
    });
    throw error;
  }
}
