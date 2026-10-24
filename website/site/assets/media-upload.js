(() => {
 const input=document.querySelector('input[name="image"]');if(!input)return;
 const button=document.querySelector('form button');
 const status=document.createElement('p');status.setAttribute('role','status');input.after(status);
 input.addEventListener('change',async()=>{
  const file=input.files[0];if(!file)return;button.disabled=true;status.textContent='Preparing image…';
  let bitmap;
  try {
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPEG, PNG or WebP image up to 5 MB.');
   bitmap=await createImageBitmap(file);
   if(bitmap.width*bitmap.height>16000000)throw Error('Use an image no larger than 16 megapixels.');
   const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
   if(!blob||blob.size>1800000)throw Error('Please use a smaller image; the hosting upload limit is 2 MB.');
   const transfer=new DataTransfer();transfer.items.add(new File([blob],'facility-photo.jpg',{type:'image/jpeg'}));input.files=transfer.files;
   status.textContent='Image ready ('+Math.ceil(blob.size/1024)+' KB).';button.disabled=false;
  } catch(error) {input.value='';status.textContent=error.message||'Could not prepare this image. Try a smaller JPEG.';button.disabled=false;}
  finally{bitmap?.close();}
 });
})();
