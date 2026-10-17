(()=>{
  "use strict";
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const storedKey=()=>sessionStorage.getItem("vsh_master_admin_key")||"";
  const key=()=>($("sandbox-key").value||storedKey()).trim();
  const feedback=message=>{$("sandbox-feedback").textContent=message;};
  const order=params.get("order")||"";
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fixedHost=location.origin==="https://vanschalkwykholdings.com";
  const button=$("sandbox-status");
  const form=$("sandbox-checkout");
  const auth=()=>({"X-Admin-Key":key()});
  if(!fixedHost){
    feedback("This test is only available on the official production domain after explicit launch approval.");
    form.hidden=true;return;
  }
  if(uuid.test(order)){button.hidden=false;feedback("Yoco return is not payment verification. Check the signed event status.");}
  button.addEventListener("click",async()=>{
    if(!key())return feedback("Enter your master admin key first.");
    if(!uuid.test(order))return feedback("Invalid sandbox order ID.");
    button.disabled=true;feedback("Checking the signed Yoco test payment…");
    try{
      const r=await fetch("/.netlify/functions/yoco-production-sandbox-status?order="+encodeURIComponent(order),
        {headers:auth(),cache:"no-store",referrerPolicy:"no-referrer"});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(data.error||"Status request failed.");
      if(data.testOnly!==true||data.emailSent!==false||data.pdfDelivered!==false)
        throw Error("Unexpected sandbox response.");
      if(data.testPaymentVerified===true)feedback("SUCCESS: Signed Yoco TEST payment verified. No PDF or email sent.");
      else feedback("Not verified yet. Check webhook subscription, signing secret and function logs. No other payment needed.");
    }catch(e){feedback(e.message||"Unable to check status.");}
    finally{button.disabled=false;}
  });
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!key())return feedback("Enter your master admin key first.");
    const b=$("sandbox-business").value;
    if(!["grannys","clever-cubs"].includes(b))return feedback("Choose a business.");
    const submit=form.querySelector("button[type=submit]");
    submit.disabled=true;feedback("Creating the fixed R10 Yoco test checkout…");
    try{
      const r=await fetch("/.netlify/functions/yoco-production-sandbox-checkout",{
        method:"POST",headers:{"Content-Type":"application/json",...auth()},
        body:JSON.stringify({business:b}),cache:"no-store",referrerPolicy:"no-referrer"});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(data.error||"Checkout unavailable.");
      if(data.testOnly!==true||data.amount!==1000||data.currency!=="ZAR"||
         data.emailSent!==false||data.pdfDelivered!==false||
         !["pay.yoco.com","checkout.yoco.com","c.yoco.com"].includes(new URL(data.redirectUrl).hostname))
        throw Error("Unexpected checkout response.");
      location.assign(data.redirectUrl);
    }catch(e){feedback(e.message||"Unable to create checkout.");submit.disabled=false;}
  });
})();
