/* Vian | Van Schalkwyk Holdings Intelligence Network.
   This client is deliberately loaded ONLY on index, Granny's and CleverCubs Learning.
   The OpenAI key is always server-side in the Netlify Function. */
(() => {
  "use strict";
  // Netlify uses pretty URLs on production: /grannys-little-bakery
  // and /clever-cubs-learning (often without the .html suffix).
  const path = location.pathname.replace(/\/+/g,"/").replace(/\/$/,"") || "/";
  const page = /\/grannys-little-bakery(?:\.html)?$/i.test(path) ? "grannys" :
    /\/clever-cubs-learning(?:\.html)?$/i.test(path) ? "clever-cubs" : "home";
  const isHome = page === "home";
  if(!isHome) document.body.classList.add("vian-has-basket");
  const STORAGE_CHAT = "vsh_vian_chat_v1";
  const STORAGE_WELCOME = "vsh_vian_welcomed_v1";
  const avatar = new URL("vian-avatar.webp", document.currentScript?.src || location.href).href;
  const container = document.createElement("div");
  container.className = "vian-widget";
  container.innerHTML = `
    <div class="vian-greeting" hidden>
      <button class="vian-greeting-dismiss" type="button" aria-label="Dismiss Vian's welcome message">×</button>
      <img class="vian-greeting-face" alt="" width="68" height="68">
      <div class="vian-greeting-text"><strong>Oh, hello there! ✨</strong><p>I'm Vian, your friendly guide to the Van Schalkwyk Holdings family. Need a hand exploring?</p>
      <button class="vian-greeting-chat" type="button">Let's chat <span aria-hidden="true">→</span></button></div>
    </div>
    <button class="vian-launcher" type="button" aria-expanded="false" aria-label="Chat with Vian, Van Schalkwyk Holdings' AI assistant">
      <span class="vian-launcher-face"><img alt="" width="60" height="60"></span>
      <span class="vian-launcher-caption"><strong>Chat with Vian <span aria-hidden="true">✦</span></strong><small>Your friendly Holdings guide</small></span>
    </button>
    <section class="vian-chat" hidden aria-label="Vian — Van Schalkwyk Holdings AI chat">
      <header class="vian-chat-header"><img alt="" width="49" height="49">
        <div><strong>VIAN <span aria-hidden="true">✦</span></strong><small>Holdings Intelligence Network</small></div>
        <button class="vian-chat-reset" type="button" title="Start new conversation" aria-label="Start a new conversation">↻</button>
        <button class="vian-chat-close" type="button" aria-label="Close Vian chat">×</button>
      </header>
      <div class="vian-chat-hero">
        <img alt="Vian, the smiling white and gold robot with round glasses and a clipboard" width="94" height="94">
        <div><span class="vian-overline">YOUR FRIENDLY BUSINESS GUIDE</span><h2>Hi, I'm <em>Vian!</em> 👋</h2>
        <p>I know all five of our businesses. Let's find just what you're looking for!</p></div>
      </div>
      <div class="vian-chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat messages"></div>
      <div class="vian-suggestions" aria-label="Suggested questions"></div>
      <form class="vian-chat-form">
        <label class="vian-sr-only" for="vian-textbox">Your message to Vian</label>
        <textarea id="vian-textbox" rows="1" maxlength="1500" placeholder="Ask me anything about our businesses…" required></textarea>
        <button class="vian-send" type="submit" aria-label="Send message to Vian"><span aria-hidden="true">➤</span></button>
      </form>
      <div class="vian-disclaimer">Vian is an AI assistant and may make mistakes. Please don't share private or payment information.</div>
    </section>`;
  document.body.append(container);

  container.querySelectorAll("img").forEach(img => img.src=avatar);
  const greeting=container.querySelector(".vian-greeting");
  const launcher=container.querySelector(".vian-launcher");
  const panel=container.querySelector(".vian-chat");
  const close=container.querySelector(".vian-chat-close");
  const reset=container.querySelector(".vian-chat-reset");
  const messageList=container.querySelector(".vian-chat-messages");
  const suggestions=container.querySelector(".vian-suggestions");
  const form=container.querySelector(".vian-chat-form");
  const input=container.querySelector("textarea");
  const submit=container.querySelector(".vian-send");
  const welcomeClose=container.querySelector(".vian-greeting-dismiss");
  const welcomeChat=container.querySelector(".vian-greeting-chat");

  const getStored=(type,key)=>{try{return type.getItem(key)}catch{return null}};
  const putStored=(type,key,val)=>{try{type.setItem(key,val)}catch{}};
  const deleteStored=(type,key)=>{try{type.removeItem(key)}catch{}};
  let busy=false, history=[];
  try{
    const value=JSON.parse(getStored(sessionStorage,STORAGE_CHAT)||"[]");
    if(Array.isArray(value))history=value.filter(m=>(m?.role==="assistant"||m?.role==="user") &&
        typeof m.content==="string" && m.content.length<=1500).slice(-8);
  }catch{}
  const greetings={
    home:"Hi there! I'm Vian, the Van Schalkwyk Holdings Intelligence Network. From homemade goodies to learning, digital solutions and exciting things coming soon, I'm here to help! ✨",
    grannys:"Welcome to Granny's! I'm Vian. Looking for sweet treats, recipe books, or a way to get in touch with Granny? 🍰",
    "clever-cubs":"Welcome to CleverCubs Learning! I'm Vian. Ask me about CAPS-aligned learning resources, PDF activity books, or our other businesses. 📚"
  };
  const prompts = {
    home:[["Our businesses","Tell me about all five businesses."],["Nuvetriq","What can Nuvetriq help me with?"],["Coming soon","Which businesses are coming soon?"]],
    grannys:[["Recipe books","How do Granny's digital recipe books work?"],["Treats","What treats does Granny's offer?"],["Contact Granny","How can I contact Granny's?"]],
    "clever-cubs":[["PDF books","Tell me about CleverCubs Learning PDF activity books."],["CAPS","What does CAPS-aligned mean for CleverCubs Learning?"],["Other businesses","What else is part of Van Schalkwyk Holdings?"]]
  };

  function render(role,text,temporary=false){
    const row=document.createElement("div");row.className="vian-line "+role;
    const bubble=document.createElement("div");bubble.className="vian-message";
    bubble.textContent=text;
    if(temporary){bubble.classList.add("vian-typing");bubble.textContent="Vian is thinking";row.dataset.temporary="1";}
    row.append(bubble);messageList.append(row);
    messageList.scrollTop=messageList.scrollHeight;
    return row;
  }
  function saveChat(){putStored(sessionStorage,STORAGE_CHAT,JSON.stringify(history.slice(-8)));}
  function renderHistory(){
    messageList.replaceChildren();
    if(!history.length)render("assistant",greetings[page]);
    else history.forEach(m=>render(m.role,m.content));
  }
  function show(open){
    panel.hidden=!open;
    launcher.hidden=open;
    if(open)greeting.hidden=true;
    launcher.setAttribute("aria-expanded",String(open));
    if(open){renderHistoryIfNeeded();input.focus({preventScroll:true});}
    else launcher.focus({preventScroll:true});
  }
  let chatRendered=false;
  function renderHistoryIfNeeded(){if(!chatRendered){renderHistory();chatRendered=true;}}
  function limitInput(){
    input.style.height="auto";
    input.style.height=Math.min(98,Math.max(44,input.scrollHeight))+"px";
  }
  function setBusy(flag){busy=flag;submit.disabled=flag;input.disabled=flag;suggestions.querySelectorAll("button").forEach(b=>b.disabled=flag);}
  async function send(message){
    const text=String(message||"").trim();
    if(!text||busy)return;
    show(true);
    render("user",text);
    input.value="";limitInput();
    const prior=history.slice(-8);
    setBusy(true);
    const loading=render("assistant","",true);
    try{
      const response=await fetch("/.netlify/functions/vian-chat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:text,history:prior,sourcePage:page==="grannys" ? "/grannys-little-bakery" :
          page==="clever-cubs" ? "/clever-cubs-learning" : "/"})
      });
      const data=await response.json().catch(()=>({}));
      loading.remove();
      if(!response.ok)throw Error(data.error||"Vian couldn't answer just now.");
      const reply=String(data.reply||"I'm having trouble responding. Could you try again?").slice(0,2500);
      render("assistant",reply);
      history.push({role:"user",content:text},{role:"assistant",content:reply.slice(0,1500)});
      history=history.slice(-8);saveChat();
    }catch(error){
      loading.remove();render("assistant",error.message||"Vian is taking a little break. Please try again soon!");
    }finally{setBusy(false);input.focus({preventScroll:true});}
  }
  for (const [label,question] of prompts[page]){
    const btn=document.createElement("button");btn.type="button";btn.textContent=label;
    btn.addEventListener("click",()=>send(question));suggestions.append(btn);
  }
  launcher.addEventListener("click",()=>show(true));
  close.addEventListener("click",()=>show(false));
  reset.addEventListener("click",()=>{if(busy)return;history=[];deleteStored(sessionStorage,STORAGE_CHAT);chatRendered=false;renderHistory();chatRendered=true;input.focus();});
  form.addEventListener("submit",event=>{event.preventDefault();send(input.value);});
  input.addEventListener("input",limitInput);
  input.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();send(input.value);}
  });
  welcomeClose.addEventListener("click",()=>{greeting.hidden=true;});
  welcomeChat.addEventListener("click",()=>show(true));
  if(isHome && !getStored(sessionStorage,STORAGE_WELCOME)){
    // Show at most once per browser-tab visit, only on the Holdings homepage.
    // A new tab/visit can show the greeting again, while moving between
    // Holdings, Granny's, CleverCubs Learning and external Nuvetriq will not.
    const showFirstWelcome=()=>{
      if(document.visibilityState!=="visible" || !panel.hidden) return;
      if(getStored(sessionStorage,STORAGE_WELCOME)) return;
      greeting.hidden=false;
      putStored(sessionStorage,STORAGE_WELCOME,"yes");
      document.removeEventListener("visibilitychange",showFirstWelcome);
    };
    setTimeout(showFirstWelcome,1100);
    document.addEventListener("visibilitychange",showFirstWelcome);
  }
})();
