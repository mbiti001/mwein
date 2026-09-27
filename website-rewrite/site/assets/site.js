(() => {
 const nav=document.querySelector('nav[aria-label="Main navigation"]');
 if(nav){const toggle=document.createElement('button');toggle.className='menu-toggle button secondary';toggle.type='button';toggle.textContent='Menu';toggle.setAttribute('aria-expanded','false');nav.id='main-navigation';toggle.setAttribute('aria-controls',nav.id);nav.before(toggle);nav.classList.add('collapsible-nav');
  const close=()=>{toggle.setAttribute('aria-expanded','false');nav.classList.remove('is-open');};
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);});
  nav.addEventListener('keydown',e=>{if(e.key==='Escape'){close();toggle.focus();}});nav.addEventListener('click',e=>{if(e.target.closest('a'))close();});
 }
 for(const button of document.querySelectorAll('.video-load'))button.addEventListener('click',()=>{
  const panel=button.closest('[data-video]'),id=panel.dataset.video;if(!/^[\w-]{11}$/.test(id))return;
  const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+id;frame.title=button.dataset.title||'YouTube video';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';panel.replaceChildren(frame);
 });
 const source=()=>location.pathname==='/blog.php'&&/^\d+$/.test(new URLSearchParams(location.search).get('id')||'')?'post:'+new URLSearchParams(location.search).get('id'):location.pathname;
 for(const a of document.querySelectorAll('a[href]')){const url=new URL(a.href,location.href);if(url.origin===location.origin&&url.pathname==='/contact.html'&&url.hash==='#send-message'&&location.pathname!=='/contact.html'){url.searchParams.set('from',source());a.href=url.href;}}
 for(const form of document.querySelectorAll('.enquiry-form')){
  const hidden=document.createElement('input');hidden.type='hidden';hidden.name='source';hidden.value=new URLSearchParams(location.search).get('from')||source();form.append(hidden);
  const status=document.createElement('p');status.setAttribute('role','status');form.append(status);
  form.addEventListener('submit',()=>{const button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='Sending your message… Please wait for your reference.';});
  window.addEventListener('pageshow',()=>{form.querySelector('button[type="submit"]').disabled=false;status.textContent='';});
 }
 const copy=document.querySelector('[data-copy-reference]');if(copy)copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copy.dataset.copyReference);copy.textContent='Reference copied';}catch{copy.textContent='Select the reference above to copy';}});
 const latest=document.querySelector('#latest-posts');if(latest)fetch('/api/latest.php').then(r=>r.ok?r.json():Promise.reject()).then(posts=>{
  const grid=document.createElement('div');grid.className='post-grid';
  for(const post of posts){const card=document.createElement('article');card.className='contact-card';if(post.image){const img=document.createElement('img');img.src=post.image;img.alt=post.alt;img.loading='lazy';img.className='post-image';card.append(img);}const h=document.createElement('h3'),a=document.createElement('a');a.href=post.url;a.textContent=post.title;h.append(a);const p=document.createElement('p');p.textContent=post.summary;card.append(h,p);grid.append(card);}if(posts.length)latest.replaceChildren(grid);
 }).catch(()=>{});
})();
