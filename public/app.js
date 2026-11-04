/* Pic To Link interactive preview.
 * The current version intentionally uses browser-local storage. No public
 * registration, authentication, paid checkout, or ownership verification is
 * claimed until the Cloudflare API is deployed.
 */
(() => {
  'use strict';
  const KEY = 'pic-to-link-preview-v1';
  const $ = id => document.getElementById(id);
  const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const monthKey = () => {const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');};
  const newId = () => crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now();
  const initial = {profile:'Your workspace',images:[],registerUsage:{},plan:'free'};
  let state;
  try { state = {...initial,...JSON.parse(localStorage.getItem(KEY)||'{}')}; }
  catch { state={...initial}; }
  if (!Array.isArray(state.images)) state.images=[];
  if (!state.registerUsage || typeof state.registerUsage!=='object') state.registerUsage={};
  // Never let the local demo grant itself a paid or admin subscription.
  state.plan='free';
  let lastCandidate=null, activeEditId=null, videoStream=null, scanTimer=null;
  let scanBusy=false, lastMatchAt=0, billingYearly=false, toastTimer=null;
  let uploadPurpose='scan';
  const prices=[
    {name:'Free',monthly:'0',yearly:'0',count:'1 new / month',stats:false,featured:false,description:'Always free, no card needed'},
    {name:'Starter',monthly:'3.99',yearly:'39.90',count:'10 active images',stats:false,featured:false,description:'For individual creators'},
    {name:'Creator',monthly:'9.99',yearly:'99.90',count:'50 active images',stats:true,featured:true,description:'For growing businesses'},
    {name:'Pro',monthly:'29.99',yearly:'299.90',count:'600 active images',stats:true,featured:false,description:'For serious creators and brands'}
  ];

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { toast('Local storage is full. Please use smaller image files.'); }
  }
  function toast(message) {
    const el=$('toast');
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'),3600);
  }
  function route() {
    const view=['scan','toolbox','pricing','about','admin'].includes(location.hash.slice(1))?location.hash.slice(1):'scan';
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===view));
    if(view==='toolbox')renderToolbox();
    if(view==='pricing')renderPricing();
    if(view==='scan' && !videoStream)attemptStartCamera();
    scrollTo({top:0,behavior:'instant'});
  }
  function openDialog(id) {
    $(id).hidden=false;
    document.body.style.overflow='hidden';
    const focusable=$(id).querySelector('input:not([type=checkbox]),button');
    focusable?.focus();
  }
  function closeDialog(id) {
    $(id).hidden=true;
    if(!document.querySelector('.dialog-overlay:not([hidden])')) document.body.style.overflow='';
  }
  function isSecureUrl(input) {
    try {
      const u=new URL(input.trim());
      if(u.protocol!=='https:' || !u.hostname || u.username || u.password) return false;
      if(['localhost','127.0.0.1','0.0.0.0'].includes(u.hostname))return false;
      if(/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))return false;
      const blocked=['porn','xxx','adult','casino','malware','phishing'];
      return !blocked.some(term=>u.hostname.toLowerCase().includes(term));
    } catch {return false;}
  }
  function previewUrl(input) {
    try {const u=new URL(input);return u.host+(u.pathname==='/'?'':u.pathname);}catch{return input;}
  }
  function localMonthUsage(){return Number(state.registerUsage[monthKey()]||0);}
  function canRegister(){return localMonthUsage()<1;}

  // 64-bit dHash from a normalized grayscale 9x8 image. This is intentionally
  // a lightweight MVP fingerprint, not robust arbitrary-image recognition.
  function fingerprint(img) {
    const tiny=document.createElement('canvas');tiny.width=9;tiny.height=8;
    const ctx=tiny.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,9,8);
    const d=ctx.getImageData(0,0,9,8).data;
    let bits='';
    let color=[0,0,0],lumas=[];
    for(let y=0;y<8;y++)for(let x=0;x<9;x++){
      const i=(y*9+x)*4;
      const lum=d[i]*.299+d[i+1]*.587+d[i+2]*.114;
      lumas.push(lum);color[0]+=d[i];color[1]+=d[i+1];color[2]+=d[i+2];
    }
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits+=lumas[y*9+x]>lumas[y*9+x+1]?'1':'0';
    return {hash:Array.from({length:16},(_,i)=>parseInt(bits.slice(i*4,i*4+4),2).toString(16)).join(''),color:color.map(c=>Math.round(c/72))};
  }
  function hamming(a,b) {
    if(!a || !b || a.length!==16 || b.length!==16)return 100;
    let n=0;
    for(let i=0;i<16;i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){n++;x&=x-1;}}
    return n;
  }
  function compare(a,b) {
    const shape=hamming(a.hash,b.hash);
    const colorDistance=Math.sqrt(a.color.reduce((sum,v,i)=>sum+Math.pow(v-(b.color?.[i]||0),2),0));
    return shape+colorDistance/22;
  }
  function findMatch(fp) {
    let best=null,score=1000;
    for(const item of state.images) {
      if(item.status==='paused')continue;
      const s=compare(fp,item.fingerprint);
      if(s<score){score=s;best=item;}
    }
    return score<=13?{item:best,score}:null;
  }
  function thumbnail(canvas) {
    const max=440,scale=Math.min(1,max/Math.max(canvas.width,canvas.height));
    const out=document.createElement('canvas');
    out.width=Math.max(1,Math.round(canvas.width*scale));
    out.height=Math.max(1,Math.round(canvas.height*scale));
    out.getContext('2d').drawImage(canvas,0,0,out.width,out.height);
    return out.toDataURL('image/webp',.73);
  }
  async function canvasFromFile(file) {
    if(!file?.type?.startsWith('image/'))throw Error('Choose an image file.');
    if(file.size>12*1024*1024)throw Error('Please choose an image smaller than 12 MB.');
    let bmp, objectUrl;
    if(typeof createImageBitmap==='function')bmp=await createImageBitmap(file);
    else {
      objectUrl=URL.createObjectURL(file);
      bmp=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Could not open image.'));img.src=objectUrl;});
    }
    const max=1100,scale=Math.min(1,max/Math.max(bmp.width||bmp.naturalWidth,bmp.height||bmp.naturalHeight));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round((bmp.width||bmp.naturalWidth)*scale));
    c.height=Math.max(1,Math.round((bmp.height||bmp.naturalHeight)*scale));
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    bmp.close?.();
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    return c;
  }
  function processCanvas(c,origin) {
    const fp=fingerprint(c),thumb=thumbnail(c);
    const match=findMatch(fp);
    lastCandidate={fingerprint:fp,thumbnail:thumb,origin};
    if(match){match.item.scans=(match.item.scans||0)+1;save();renderFound(match.item);}
    else renderUnregistered(thumb,origin);
  }

  function renderFound(item) {
    $('resultContent').innerHTML=`
      <div class="result-icon success">✓</div>
      <h2 id="resultTitle">Image recognized!</h2>
      <p class="muted">This artwork has a connected website.</p>
      <img class="result-image" src="${item.thumbnail}" alt="${safeText(item.title)}">
      <div class="result-detail"><small>CONNECTED DESTINATION</small><b>${safeText(previewUrl(item.url))}</b></div>
      <div class="result-actions"><a href="${safeText(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Visit website ↗</a><button class="btn btn-secondary" type="button" data-close="resultOverlay">Done</button></div>`;
    openDialog('resultOverlay');
  }
  function renderUnregistered(thumb,origin='upload') {
    $('resultContent').innerHTML=`
      <div class="result-icon">✧</div><h2 id="resultTitle">No website connected yet.</h2>
      <p class="muted">We couldn't find this design in your browser's preview registry. It might already exist in someone else's registry once the shared database is connected.</p>
      <img class="result-image" src="${thumb}" alt="Scanned artwork">
      <div class="result-actions"><button id="claimFromResult" type="button" class="btn btn-primary">Claim this image →</button><button class="btn btn-secondary" type="button" data-close="resultOverlay">Close</button></div>`;
    openDialog('resultOverlay');
    $('claimFromResult').addEventListener('click',()=>{closeDialog('resultOverlay');openRegistration();});
  }
  function openRegistration() {
    if(!canRegister()){toast('Your free registration for this month is used. New free allowance begins next month.');location.hash='pricing';return;}
    if(!lastCandidate){uploadPurpose='register';$('imageUpload').click();return;}
    $('registrationPreview').innerHTML=`<img src="${lastCandidate.thumbnail}" alt="Artwork to register">`;
    $('registerForm').reset();
    openDialog('registerOverlay');
  }
  function renderToolbox() {
    $('profileAvatar').textContent=(state.profile?.trim()?.[0]||'P').toUpperCase();
    $('profileName').textContent=state.profile||'Your workspace';
    $('currentPlanName').textContent='Free plan · 1 new/month';
    $('quotaText').textContent=localMonthUsage()+' / 1';
    $('quotaBar').style.width=Math.min(100,localMonthUsage()*100)+'%';
    $('imageCountBadge').textContent=state.images.length+' image'+(state.images.length===1?'':'s');
    const grid=$('imagesGrid');
    if(!state.images.length) {
      grid.innerHTML='<div class="empty-state"><div class="empty-icon">▣</div><h3>Your next connection starts here.</h3><p>Register your first image and link it to anywhere you want visitors to go.</p><button class="btn btn-primary" id="firstImage">+ Register your first image</button></div>';
      $('firstImage').addEventListener('click',openRegistration);
      return;
    }
    grid.innerHTML=state.images.map(item=>`
      <div class="image-card"><div class="thumb"><img src="${item.thumbnail}" alt="${safeText(item.title)}"></div><div class="card-inner">
      ${item.status==='paused'?'<div class="tag-paused">● Paused</div>':''}
      <h4 title="${safeText(item.title)}">${safeText(item.title)}</h4><div class="card-url" title="${safeText(item.url)}">${safeText(previewUrl(item.url))}</div>
      <div class="edit-row"><button type="button" class="mini-btn" data-edit="${item.id}">Edit URL</button><button type="button" class="mini-btn alt" data-activate="${item.id}">${item.status==='paused'?'Resume':'Pause'}</button></div></div></div>`).join('');
    grid.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openEdit(b.dataset.edit)));
    grid.querySelectorAll('[data-activate]').forEach(b=>b.addEventListener('click',()=>toggleActive(b.dataset.activate)));
  }
  function openEdit(id) {
    const item=state.images.find(x=>x.id===id);if(!item)return;
    activeEditId=id;$('editNameInput').value=item.title;$('editUrlInput').value=item.url;
    $('deactivateImage').textContent=item.status==='paused'?'Resume this image':'Pause this image';
    openDialog('editOverlay');
  }
  function toggleActive(id) {
    const item=state.images.find(x=>x.id===id);if(!item)return;
    item.status=item.status==='paused'?'active':'paused';save();renderToolbox();
    toast(item.status==='paused'?'Image paused. Its link no longer matches.':'Image reactivated.');
  }
  function renderPricing() {
    $('monthlyLabel').classList.toggle('billing-active',!billingYearly);
    $('yearlyLabel').classList.toggle('billing-active',billingYearly);
    $('billingToggle').classList.toggle('on',billingYearly);
    $('billingToggle').setAttribute('aria-checked',String(billingYearly));
    $('pricingGrid').innerHTML=prices.map(p=>`<article class="price-card ${p.featured?'featured':''}">
      ${p.featured?'<div class="popular-ribbon">MOST POPULAR</div>':''}
      <h3>${p.name}</h3><div class="price-line">$${billingYearly?p.yearly:p.monthly}<small> / ${billingYearly?'yr':'mo'}</small></div>
      <div class="billed">${p.name==='Free'?'Free forever':billingYearly?'Billed once annually · 2 months free':'Billed monthly · cancel anytime'}</div><div class="rule"></div>
      <ul><li><b>✓</b> ${p.count}</li><li><b>✓</b> Unlimited free scanning</li><li><b>✓</b> Editable website links</li>
      <li class="${p.stats?'':'unavailable'}"><b>${p.stats?'✓':'×'}</b> Scan statistics</li><li><b>✓</b> 30-day recovery window</li></ul>
      <button type="button" data-plan="${p.name}" class="btn ${p.featured?'btn-primary':'btn-secondary'} full">${p.name==='Free'?'Get started free':'Choose '+p.name} →</button></article>`).join('');
    $('pricingGrid').querySelectorAll('[data-plan]').forEach(b=>b.addEventListener('click',()=>{
      if(b.dataset.plan==='Free'){location.hash='toolbox';return;}
      toast('Stripe subscriptions will open when the secure Cloudflare backend is connected.');
    }));
  }

  async function startCamera() {
    if(videoStream) return true;
    if(!navigator.mediaDevices?.getUserMedia){$('cameraBadge').innerHTML='<span class="status-dot"></span> Camera unavailable';return false;}
    try {
      videoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      const v=$('cameraVideo');v.srcObject=videoStream;await v.play();
      $('scannerStage').classList.add('video-on');$('cameraPlaceholder').classList.add('hide');
      $('cameraBadge').classList.add('live');$('cameraBadge').innerHTML='<span class="status-dot"></span> Camera live';
      $('scanLine').classList.add('active');$('scanTag').innerHTML='<span class="tiny-pulse"></span> Looking for artwork...';
      if(!scanTimer)scanTimer=setInterval(()=>{if(!document.hidden&&!document.querySelector('.dialog-overlay:not([hidden])')&&(!location.hash||location.hash==='#scan'))scanFrame(false);},2600);
      return true;
    } catch(err) {
      $('cameraBadge').innerHTML='<span class="status-dot"></span> Permission needed';
      $('cameraPlaceholder').classList.remove('hide');
      $('cameraPlaceholder').querySelector('span').textContent='Allow camera access when prompted, or upload an image instead.';
      return false;
    }
  }
  async function attemptStartCamera() {
    if(!videoStream && location.hash!=='#toolbox' && !document.hidden)startCamera();
  }
  async function scanFrame(manual) {
    if(scanBusy)return;
    if(!videoStream){await startCamera();if(!videoStream)return;}
    const v=$('cameraVideo');
    if(v.readyState<2)return;
    scanBusy=true;
    try{
      const c=$('cameraCanvas'),max=720,scale=Math.min(1,max/v.videoWidth);
      c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);
      c.getContext('2d').drawImage(v,0,0,c.width,c.height);
      const fp=fingerprint(c),match=findMatch(fp);
      if(match&&Date.now()-lastMatchAt>5000){
        lastMatchAt=Date.now();lastCandidate={fingerprint:fp,thumbnail:thumbnail(c),origin:'camera'};
        match.item.scans=(match.item.scans||0)+1;save();renderFound(match.item);
      }else if(manual){lastCandidate={fingerprint:fp,thumbnail:thumbnail(c),origin:'camera'};renderUnregistered(lastCandidate.thumbnail,'camera');}
    }finally{scanBusy=false;}
  }

  // Wiring
  window.addEventListener('hashchange',route);
  $('topToolbox').addEventListener('click',()=>location.hash='toolbox');
  $('enableCamera').addEventListener('click',startCamera);
  $('scanNow').addEventListener('click',()=>scanFrame(true));
  $('uploadButton').addEventListener('click',()=>{uploadPurpose='scan';$('imageUpload').click();});
  $('newImageButton').addEventListener('click',()=>{lastCandidate=null;openRegistration();});
  $('freeToolboxButton').addEventListener('click',()=>location.hash='toolbox');
  $('billingToggle').addEventListener('click',()=>{billingYearly=!billingYearly;renderPricing();});
  $('changeProfile').addEventListener('click',()=>{$('profileInput').value=state.profile==='Your workspace'?'':state.profile;openDialog('profileOverlay');});
  $('profileForm').addEventListener('submit',e=>{e.preventDefault();state.profile=$('profileInput').value.trim();save();closeDialog('profileOverlay');renderToolbox();toast('Display name saved.');});
  $('imageUpload').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try {
      const canvas=await canvasFromFile(file);
      if(uploadPurpose==='register'){
        lastCandidate={fingerprint:fingerprint(canvas),thumbnail:thumbnail(canvas),origin:'upload'};
        openRegistration();
      }else processCanvas(canvas,'upload');
    }catch(err){toast(err.message||'Unable to read image.');}
    e.target.value='';
  });
  $('registerForm').addEventListener('submit',e=>{
    e.preventDefault();
    if(!lastCandidate){toast('Please upload an image first.');return;}
    if(!canRegister()){toast('Your free registration has been used this month.');return;}
    const title=$('imageTitleInput').value.trim(),url=$('imageUrlInput').value.trim();
    if(!title||!isSecureUrl(url)){toast('Enter a valid title and a public HTTPS website URL.');return;}
    if(!$('rightsConfirm').checked){toast('Please confirm you have the rights to register this artwork.');return;}
    if(findMatch(lastCandidate.fingerprint)){toast('An identical or similar image is already registered in this preview.');return;}
    const item={id:newId(),title,url,thumbnail:lastCandidate.thumbnail,fingerprint:lastCandidate.fingerprint,createdAt:new Date().toISOString(),registrationType:'free',status:'active',scans:0};
    state.images.push(item);state.registerUsage[monthKey()]=localMonthUsage()+1;save();
    closeDialog('registerOverlay');renderToolbox();location.hash='toolbox';lastCandidate=null;
    toast('Image registered in this browser preview.');
  });
  $('editForm').addEventListener('submit',e=>{
    e.preventDefault();
    const item=state.images.find(x=>x.id===activeEditId);if(!item)return;
    const title=$('editNameInput').value.trim(),url=$('editUrlInput').value.trim();
    if(!title||!isSecureUrl(url)){toast('Use a valid title and public HTTPS URL.');return;}
    item.title=title;item.url=url;save();closeDialog('editOverlay');renderToolbox();toast('Destination updated.');
  });
  $('deactivateImage').addEventListener('click',()=>{closeDialog('editOverlay');toggleActive(activeEditId);});
  document.addEventListener('click',e=>{
    const close=e.target.closest('[data-close]');
    if(close)closeDialog(close.dataset.close);
    if(e.target.classList.contains('dialog-overlay'))closeDialog(e.target.id);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.dialog-overlay:not([hidden])').forEach(el=>closeDialog(el.id));});
  $('adminPreviewLink').addEventListener('click',()=>location.hash='admin');
  $('vipInvite').addEventListener('click',()=>{
    const email=$('vipEmail').value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast('Enter a valid email address.');return;}
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const values=crypto.getRandomValues(new Uint8Array(19));
    const password=Array.from(values,v=>chars[v%chars.length]).join('');
    $('resultContent').innerHTML=`<div class="result-icon">✦</div><h2 id="resultTitle">Invitation preview</h2>
      <p class="muted">This shows the planned owner workflow. No real account was created, and the temporary password is not stored.</p>
      <div class="result-detail"><small>INVITED EMAIL</small>${safeText(email)}</div>
      <div class="result-detail"><small>EXAMPLE TEMPORARY PASSWORD</small><code>${safeText(password)}</code></div>
      <p class="muted">Allowance: ${safeText($('vipLimit').value)} · Expires: ${safeText($('vipExpiry').value)}.</p>
      <button type="button" class="btn btn-primary full" data-close="resultOverlay">Understood</button>`;
    openDialog('resultOverlay');
  });
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
  renderPricing();renderToolbox();route();
})();
