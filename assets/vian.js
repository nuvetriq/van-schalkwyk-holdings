/* Vian — Van Schalkwyk Holdings Intelligence Network.
   This widget exists ONLY on the Holdings website; no NUVETRIQ embed. */
(() => {
  "use strict";
  if (document.getElementById("vian-root")) return;
  const script=document.currentScript;
  const homeWelcome=script?.dataset.vianWelcome === "home";
  const avatar = new URL("vian-avatar.webp",script?.src||location.href).href;
  const seenKey="vsh_vian_home_intro_seen_v1";
  const chatKey="vsh_vian_chat_v1";
  const MAX_HISTORY=8;
  function stored(key,locationStore){
    try{return locationStore.getItem(key)}catch{return null}
  }
  function write(key,value,locationStore){
    try{locationStore.setItem(key,value);return true}catch{return false}
  }
  function remove(key,locationStore){try{locationStore.removeItem(key)}catch{}}
  let history=[];
  try {
    const saved=JSON.parse(stored(chatKey,sessionStorage)||"[]");
    if(Array.isArray(saved))history=saved.filter(m=>
      m && (m.role==="user"||m.role==="assistant") && typeof m.content==="string" && m.content.length<=1500
    ).slice(-MAX_HISTORY);
  } catch{}
  let isSending=false;
  const root=document.createElement("div");
  root.id="vian-root";
  root.innerHTML=`
    <div class="vian-welcome-pop" hidden>
      <img data-vian-image alt="" width="52" height="52">
      <div><strong>Hi there! I'm Vian! 👋</strong><p>Your little guide to the Van Schalkwyk family. Need a hand exploring?</p>
      <button type="button" class="vian-welcome-ask">Let's chat <span aria-hidden="true">→</span></button></div>
      <button type="button" class="vian-welcome-dismiss" aria-label="Dismiss Vian's introduction">×</button>
    </div>
    <button type="button" class="vian-launcher" aria-controls="vian-chat" aria-expanded="false"
      aria-label="Chat with Vian, Van Schalkwyk Holdings Intelligence Network">
      <img data-vian-image alt="" width="52" height="52">
      <span><strong>Chat with <em>Vian</em></strong><small>Your Holdings guide ✦</small></span>
      <span class="vian-launcher-spark" aria-hidden="true">✦</span>
    </button>
    <section id="vian-chat" class="vian-chat" role="dialog" aria-label="Chat with Vian" aria-hidden="true" hidden>
      <header class="vian-header">
        <img data-vian-image alt="" width="55" height="55">
        <div><strong>V I A N <span aria-hidden="true">✦</span></strong><small>Van Schalkwyk Holdings Intelligence Network</small></div>
        <button class="vian-new" type="button" aria-label="Start a new Vian conversation" title="New conversation">↻</button>
        <button class="vian-close" type="button" aria-label="Close Vian">×</button>
      </header>
      <div class="vian-intro">
        <p class="vian-intro-eyebrow">YOUR FAMILY-BUSINESS GUIDE</p>
        <h2>Hey there, I'm <em>Vian!</em> <span aria-hidden="true">✦</span></h2>
        <p>I can tell you about Granny's, Clever Cubs, Nuvetriq and our coming-soon businesses.</p>
      </div>
      <div class="vian-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="vian-quick" aria-label="Suggested questions">
        <button type="button" data-vian-prompt="What does Granny's sell?">♡ Granny's</button>
        <button type="button" data-vian-prompt="Tell me about Clever Cubs Learning and CAPS-aligned books.">✎ Clever Cubs</button>
        <button type="button" data-vian-prompt="What services does Nuvetriq offer?">✦ Nuvetriq</button>
        <button type="button" data-vian-prompt="Which businesses are coming soon?">◌ Coming soon</button>
      </div>
      <form class="vian-form">
        <label class="vian-sr-only" for="vian-question">Your question for Vian</label>
        <textarea id="vian-question" maxlength="1500" rows="1" placeholder="Ask me about our businesses…"></textarea>
        <button class="vian-send" type="submit" aria-label="Send to Vian">➤</button>
      </form>
      <p class="vian-foot">Vian is an AI assistant and can make mistakes. Please don't share passwords, payment details or personal documents.</p>
    </section>`;
  document.body.append(root);
  root.querySelectorAll("[data-vian-image]").forEach(img=>{img.src=avatar;});
  const launcher=root.querySelector(".vian-launcher");
  const panel=root.querySelector(".vian-chat");
  const popup=root.querySelector(".vian-welcome-pop");
  const messages=root.querySelector(".vian-messages");
  const form=root.querySelector(".vian-form");
  const input=root.querySelector("#vian-question");
  const sendButton=root.querySelector(".vian-send");
  const quick=root.querySelector(".vian-quick");
  function dismissPopup(){
    popup.hidden=true;
    // Works across homepage and brand pages on this same domain.
    write(seenKey,"1",localStorage);
  }
  function setOpen(value){
    panel.hidden=!value;
    panel.setAttribute("aria-hidden",String(!value));
    launcher.setAttribute("aria-expanded",String(value));
    launcher.hidden=value;
    if(value) {
      if(!popup.hidden)dismissPopup();
      input.focus({preventScroll:true});
      messages.scrollTop=messages.scrollHeight;
    }else launcher.focus({preventScroll:true});
  }
  function addMessage(role,text,typing=false){
    const row=document.createElement("div");
    row.className="vian-message-row "+role;
    const bubble=document.createElement("div");
    bubble.className="vian-message "+role+(typing?" vian-typing":"");
    if(typing)bubble.textContent="● ● ●";else bubble.textContent=text;
    row.append(bubble);
    messages.append(row);
    messages.scrollTop=messages.scrollHeight;
    return row;
  }
  function greeting(){
    if(messages.children.length>0)return;
    addMessage("assistant","Hello! 👋 I'm Vian, your Van Schalkwyk Holdings guide. I can help you discover Granny's delicious treats and recipe books, Clever Cubs learning resources, Nuvetriq's digital services, and what's coming soon. What would you like to explore?");
  }
  function displayHistory(){
    messages.replaceChildren();
    if(!history.length){greeting();return;}
    for(const h of history)addMessage(h.role,h.content);
  }
  function saveHistory(){write(chatKey,JSON.stringify(history.slice(-MAX_HISTORY)),sessionStorage);}
  function setSending(sending){
    isSending=sending;
    input.disabled=sending;sendButton.disabled=sending;
    quick.querySelectorAll("button").forEach(b=>b.disabled=sending);
    sendButton.textContent=sending?"…":"➤";
  }
  async function send(question){
    const message=String(question||"").trim();
    if(!message || isSending)return;
    setOpen(true);
    const preceding=history.slice(-MAX_HISTORY);
    input.value="";
    input.style.height="";
    addMessage("user",message);
    setSending(true);
    const typing=addMessage("assistant","",true);
    try {
      const response=await fetch("/.netlify/functions/vian-chat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message,history:preceding,sourcePage:location.pathname})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||"Vian couldn't answer that right now.");
      const reply=String(data.reply||"").trim();
      if(!reply)throw Error("Sorry, I didn't get an answer. Please try again.");
      typing.remove();addMessage("assistant",reply);
      history=[...preceding,{role:"user",content:message},{role:"assistant",content:reply}].slice(-MAX_HISTORY);
      saveHistory();
    } catch(error) {
      typing.remove();
      addMessage("assistant",error.message||"Oops, my circuits are having a moment. Please try again later.");
    } finally {
      setSending(false);
      if(!panel.hidden)input.focus({preventScroll:true});
    }
  }
  launcher.addEventListener("click",()=>setOpen(true));
  root.querySelector(".vian-close").addEventListener("click",()=>setOpen(false));
  root.querySelector(".vian-new").addEventListener("click",()=>{
    if(isSending)return;
    history=[];remove(chatKey,sessionStorage);displayHistory();input.focus();
  });
  form.addEventListener("submit",event=>{event.preventDefault();send(input.value);});
  input.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(!isSending)form.requestSubmit();}
    if(event.key==="Escape")setOpen(false);
  });
  input.addEventListener("input",()=>{
    input.style.height="auto";
    input.style.height=Math.min(input.scrollHeight,110)+"px";
  });
  quick.querySelectorAll("button[data-vian-prompt]").forEach(button=>
    button.addEventListener("click",()=>send(button.dataset.vianPrompt))
  );
  root.querySelector(".vian-welcome-dismiss").addEventListener("click",dismissPopup);
  root.querySelector(".vian-welcome-ask").addEventListener("click",()=>setOpen(true));
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!panel.hidden)setOpen(false);
  });
  displayHistory();
  // Once per visitor, on the Holdings landing page ONLY. No auto-opening the chat.
  if(homeWelcome && (location.pathname==="/"||location.pathname==="/index.html") &&
     !stored(seenKey,localStorage)) {
    setTimeout(()=>{
      if(!stored(seenKey,localStorage)&&panel.hidden) {
        popup.hidden=false;
        write(seenKey,"1",localStorage);
      }
    },1700);
  }
})();