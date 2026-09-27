(() => {
  const pages = ['/', '/index.html', '/services.html', '/insurers.html', '/blog.html', '/blog.php', '/partners.html', '/contact.html', '/privacy-policy.html'];
  if (!pages.includes(location.pathname)) return;
  const privacy = navigator.doNotTrack === '1' || navigator.globalPrivacyControl;
  const key = 'mwein_analytics_choice';
  const read = () => { try { const c=JSON.parse(localStorage.getItem(key));return c&&c.expires>Date.now()?c.value:null; } catch { return null; } };
  const write = value => { try { localStorage.setItem(key,JSON.stringify({value,expires:Date.now()+90*86400000})); } catch {} };
  const send = data => fetch('/api/visit.php',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)}).catch(()=>{});
  let recorded=false,consentedRecorded=false;
  const record = (identifyOnly=false) => { if(privacy||(identifyOnly?consentedRecorded:recorded))return;if(!identifyOnly)recorded=true;const consent=read()==='yes';if(consent)consentedRecorded=true;let referrer='';try { referrer=new URL(document.referrer).origin; } catch {} const id=new URLSearchParams(location.search).get('id');const path=location.pathname==='/blog.php'&&/^[1-9][0-9]{0,8}$/.test(id||'')?'post:'+id:location.pathname;send({path,consent:consent?'yes':'no',referrer,identify_only:identifyOnly?'yes':'no'}); };
  const panel=document.createElement('section');panel.className='wrap contact-card';panel.setAttribute('aria-label','Analytics preferences');
  const render = () => {
    panel.replaceChildren();
    const p=document.createElement('p');p.textContent=privacy?'Your browser privacy preference is respected. Optional visitor analytics are off.':'Optional visitor analytics help us understand new and returning browsers, traffic sources, device types and approximate countries. Allow a first-party identifier for up to 90 days? You can change this choice here.';panel.append(p);
    const status=document.createElement('p');status.textContent='Current choice: '+(privacy?'off':read()==='yes'?'allowed':read()==='no'?'declined':'not chosen');panel.append(status);
    if(!privacy)for(const [label,value] of [['Allow visitor analytics','yes'],['Decline / turn off','no']]) {
      const b=document.createElement('button');b.className='button secondary';b.textContent=label;b.type='button';b.addEventListener('click',()=>{write(value);if(value==='no')send({forget:'yes'});else record(recorded);render();});panel.append(b);
    }
    const a=document.createElement('a');a.href='/privacy-policy.html';a.textContent=' Read our privacy notice';panel.append(a);
  };
  render();document.querySelector('footer')?.before(panel);
  if(privacy){send({forget:'yes'});return;}
  if(document.visibilityState==='visible')record();else document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')record();});
})();
