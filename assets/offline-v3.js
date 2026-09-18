document.querySelectorAll('form').forEach(form=>{
  const formName=form.getAttribute('name');
  const isConnectedForm=formName==='clever-cubs-contact'||formName==='grannys-contact';

  if(isConnectedForm){
    const status=document.createElement('p');
    status.className='netlify-form-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    form.append(status);

    form.addEventListener('submit',async e=>{
      e.preventDefault();

      if(formName==='clever-cubs-contact'){
        const phone=form.querySelector('[name="phone"]')?.value.trim();
        const email=form.querySelector('[name="email"]')?.value.trim();
        if(!phone&&!email){
          status.textContent='Please add either a phone number or an email address so we can reply.';
          status.className='netlify-form-status error';
          return;
        }
      }

      const submit=form.querySelector('[type="submit"]');
      const original=submit?.innerHTML;
      if(submit){submit.disabled=true;submit.textContent='Sending…'}
      status.textContent='Sending your message…';
      status.className='netlify-form-status';

      try{
        const response=await fetch('/',{
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams(new FormData(form)).toString()
        });
        if(!response.ok)throw new Error('Form submission failed');

        form.reset();
        status.textContent='Thank you! Your message has been sent successfully. We’ll get back to you as soon as we can.';
        status.className='netlify-form-status success';
      }catch(err){
        status.textContent='Sorry, the message could not be sent just now. Please use the WhatsApp, email or telephone details on this page.';
        status.className='netlify-form-status error';
      }finally{
        if(submit){submit.disabled=false;submit.innerHTML=original}
      }
    });
    return;
  }

  // Only genuinely unconnected forms get the fallback notice.
  const note=document.createElement('p');
  note.className='offline-form-note';
  note.textContent='Online form coming soon — please use the WhatsApp, email or telephone links for now.';
  form.prepend(note);
  form.addEventListener('submit',e=>{
    e.preventDefault();
    alert('This online form is not connected yet. Please contact the business by WhatsApp, email or phone for now.');
  });
});

document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
  if(button.type==='submit')return;
  if(button.getAttribute('aria-label')==='Open menu'){
    const nav=document.createElement('nav');
    nav.innerHTML='<a href="#categories">Categories</a> · <a href="#shop">Shop</a> · <a href="#contact">Contact</a>';
    nav.style.padding='20px';
    button.closest('header').append(nav);
    button.hidden=true;
    return;
  }
  const group=button.closest('[role="tablist"], [aria-label="Filter books"]')||button.parentElement;
  group.querySelectorAll('button').forEach(b=>b.classList.remove('offline-selected'));
  button.classList.add('offline-selected');
  if(button.getAttribute('role')==='tab'){
    group.querySelectorAll('[role="tab"]').forEach(b=>{
      b.setAttribute('aria-selected',String(b===button));
      b.dataset.state=b===button?'active':'inactive';
    });
    const empty=document.querySelector('.catalogue-empty h3');
    if(empty)empty.textContent=button.querySelector('b').textContent+' — catalogue';
  }
  if(button.textContent.includes('Explore collection'))document.querySelector('#shop')?.scrollIntoView({behavior:'smooth'});
}));