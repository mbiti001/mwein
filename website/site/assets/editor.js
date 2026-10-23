(() => {
 const form=document.querySelector('#post-editor');if(!form)return;
 const body=form.elements.body,status=document.querySelector('#editor-status');let dirty=false;
 const changed=()=>{dirty=true;status.textContent='Unsaved changes — save your draft before leaving.';};
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 form.addEventListener('submit',()=>{dirty=false;});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 for(const button of form.querySelectorAll('[data-format]'))button.addEventListener('click',()=>{
  const start=body.selectionStart,end=body.selectionEnd,text=body.value.slice(start,end)||'Your text';
  const format=button.dataset.format;
  const replacement=format==='bold'?'**'+text+'**':(start&&body.value[start-1]!=='\n'?'\n\n':'')+(format==='heading'?'## '+text:text.split('\n').map(x=>'- '+x).join('\n'))+'\n\n';
  body.setRangeText(replacement,start,end,'select');body.focus();changed();
 });
})();
