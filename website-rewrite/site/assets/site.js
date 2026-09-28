(() => {
 const nav=document.querySelector('nav[aria-label="Main navigation"]');
 if(nav){const toggle=document.createElement('button');toggle.className='menu-toggle button secondary';toggle.type='button';toggle.textContent='Menu';toggle.setAttribute('aria-expanded','false');nav.id='main-navigation';toggle.setAttribute('aria-controls',nav.id);nav.before(toggle);nav.classList.add('collapsible-nav');
  const close=()=>{toggle.setAttribute('aria-expanded','false');nav.classList.remove('is-open');};
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){close();toggle.focus();}});document.addEventListener('click',e=>{if(!nav.contains(e.target)&&!toggle.contains(e.target))close();});window.addEventListener('pageshow',close);nav.addEventListener('click',e=>{if(e.target.closest('a'))close();});
 }
 for(const button of document.querySelectorAll('.video-load'))button.addEventListener('click',()=>{
  const panel=button.closest('[data-video]'),id=panel.dataset.video;if(!/^[\w-]{11}$/.test(id))return;
  const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+id;frame.title=button.dataset.title||'YouTube video';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';panel.replaceChildren(frame);
 });
 const source=()=>location.pathname==='/blog.php'&&/^\d+$/.test(new URLSearchParams(location.search).get('id')||'')?'post:'+new URLSearchParams(location.search).get('id'):location.pathname;
 for(const a of document.querySelectorAll('a[href]')){const url=new URL(a.href,location.href);if(url.origin===location.origin&&url.pathname==='/contact.html'&&url.hash==='#send-message'&&location.pathname!=='/contact.html'){url.searchParams.set('from',source());a.href=url.href;}}
 const category=document.querySelector('.enquiry-form select[name="category"]');
 const chooseCategory=value=>{if(category&&[...category.options].some(option=>option.value===value))category.value=value;};
 if(category&&!category.value)chooseCategory(new URLSearchParams(location.search).get('category'));
 for(const link of document.querySelectorAll('[data-enquiry-category]')){
  if(link.getAttribute('href').startsWith('#'))link.addEventListener('click',()=>chooseCategory(link.dataset.enquiryCategory));
  else {const url=new URL(link.href,location.href);url.searchParams.set('category',link.dataset.enquiryCategory);link.href=url.href;}
 }
 for(const form of document.querySelectorAll('.enquiry-form')){
  let hidden=form.querySelector('[name="source"]');
  if(!hidden){hidden=document.createElement('input');hidden.type='hidden';hidden.name='source';form.append(hidden);}
  if(!hidden.value)hidden.value=new URLSearchParams(location.search).get('from')||source();
  let key=form.querySelector('[name="request_key"]');
  if(!key){key=document.createElement('input');key.type='hidden';key.name='request_key';form.append(key);}
  if(!key.value&&window.crypto?.randomUUID)key.value=crypto.randomUUID();
 }
 for(const form of document.querySelectorAll('.enquiry-form,.feedback-form')){
  const button=form.querySelector('button[type="submit"]');if(!button)continue;
  let status=form.querySelector('[role="status"],.feedback-submit-status');
  if(!status){status=document.createElement('p');status.setAttribute('role','status');form.append(status);}
  let timer;
  const reset=()=>{clearTimeout(timer);button.disabled=false;form.removeAttribute('aria-busy');status.textContent='';};
  form.addEventListener('submit',e=>{
   if(button.disabled){e.preventDefault();return;}
   button.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Sending… Please wait for confirmation.';
   timer=setTimeout(()=>{button.disabled=false;form.removeAttribute('aria-busy');status.textContent='No confirmation yet. You can retry this submission; a saved submission will not be duplicated.';},15000);
  });
  window.addEventListener('pageshow',reset);
 }
 document.querySelector('.form-errors')?.focus();
 const copy=document.querySelector('[data-copy-reference]');if(copy)copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copy.dataset.copyReference);copy.textContent='Reference copied';}catch{copy.textContent='Select the reference above to copy';}});
 const latest=document.querySelector('#latest-posts');if(latest)fetch('/api/latest.php').then(r=>r.ok?r.json():Promise.reject()).then(posts=>{
  const grid=document.createElement('div');grid.className='post-grid';
  for(const post of posts){const card=document.createElement('article');card.className='contact-card';if(post.image){const img=document.createElement('img');img.src=post.image;img.alt=post.alt;img.loading='lazy';img.className='post-image';card.append(img);}const h=document.createElement('h3'),a=document.createElement('a');a.href=post.url;a.textContent=post.title;h.append(a);const p=document.createElement('p');p.textContent=post.summary;card.append(h,p);grid.append(card);}if(posts.length)latest.replaceChildren(grid);
 }).catch(()=>{});
})();
