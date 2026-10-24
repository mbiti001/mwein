const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let timeout,reset,submit;
const status={textContent:''},button={disabled:false},fields={};
const form={
 querySelector:s=>s==='button[type="submit"]'?button:s==='[role="status"],.feedback-submit-status'?status:fields[s],
 append:n=>{fields['[name="'+n.name+'"]']=n;},
 addEventListener:(name,fn)=>{if(name==='submit')submit=fn;},setAttribute(){},removeAttribute(){}
};
const context={
 document:{querySelector:()=>null,querySelectorAll:s=>s==='.enquiry-form'||s==='.enquiry-form,.feedback-form'?[form]:[],createElement:()=>({value:''})},
 location:{pathname:'/contact.html',search:'',href:'https://example.test/contact.html'},
 window:{crypto:{randomUUID:()=> 'test-key-00000000'},addEventListener:(name,fn)=>{if(name==='pageshow')reset=fn;}},
 crypto:{randomUUID:()=> 'test-key-00000000'},URL,URLSearchParams,
 setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{}
};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../site/assets/site.js'),'utf8'),context);
submit({preventDefault(){throw Error('first submit unexpectedly blocked');}});
assert(button.disabled);assert.match(status.textContent,/Sending/);
let prevented=false;submit({preventDefault(){prevented=true;}});assert(prevented);
timeout();assert(!button.disabled);assert.match(status.textContent,/No confirmation yet/);assert(!status.textContent.includes('success'));
assert.equal(fields['[name="request_key"]'].value,'test-key-00000000');
reset();assert.equal(status.textContent,'');assert(!button.disabled);
console.log('Interaction checks passed: busy state, double click guard, slow response recovery, stable retry key and Back navigation reset.');
