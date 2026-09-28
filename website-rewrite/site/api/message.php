<?php
require __DIR__.'/notifications.php';
require_once __DIR__.'/enquiry-form.php';
require_post(); same_origin();
$name=post('name'); $contact=post('contact'); $category=post('category'); $message=post('message');
$errors=[];
if(strlen($name)<2 || strlen($name)>120 || !preg_match('//u',$name)) $errors['name']='Enter a name between 2 and 120 characters.';
if(strlen($contact)>254 || !(filter_var($contact,FILTER_VALIDATE_EMAIL) || (preg_match('/^\+?[0-9 ()-]{8,24}$/D',$contact) && whatsapp_contact($contact)!==''))) $errors['contact']='Enter a valid email address or WhatsApp number with country code.';
if(!in_array($category,['General enquiry','WhatsApp follow-up','Care arrangement','Insurance enquiry','Partnership or support','Official correspondence'],true)) $errors['category']='Choose the team or service your enquiry is about.';
if(strlen($message)<10 || strlen($message)>4000 || !preg_match('//u',$message)) $errors['message']='Write a message between 10 and 4,000 characters.';
if(post('consent')!=='yes') $errors['consent']='Confirm that we may use your details to reply.';
if(post('website')!=='') { limited('message',5,900); http_response_code(422); exit('Unable to submit this form.'); }
$key=post('request_key');
if($key!=='' && !preg_match('/^[A-Za-z0-9_-]{16,128}$/D',$key)) { http_response_code(422); exit('Reload the contact page and try again.'); }
if($errors) { if(limited('message',5,900)) { header('Retry-After: 900'); enquiry_error(['message'=>'Too many messages. Wait 15 minutes before retrying, or email info@mweinmedical.co.ke.'],429); } enquiry_error($errors); }
$hash=hash_hmac('sha256',json_encode([$name,$contact,$category,$message],JSON_THROW_ON_ERROR),config()['secret']);
$request=hash_hmac('sha256',$key!==''?'key:'.$key:'form:'.$hash,config()['secret']);
db()->exec('CREATE TABLE IF NOT EXISTS enquiry_receipts(request_key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,reference TEXT NOT NULL,created INTEGER NOT NULL)');
db()->exec('BEGIN IMMEDIATE');
try {
    run('DELETE FROM enquiry_receipts WHERE created<?',[time()-7*86400]);
    $existing=rows(run('SELECT * FROM enquiry_receipts WHERE request_key=?',[$request]))[0]??null;
    if($existing && ($key!=='' || (int)$existing['created']>time()-900)) {
        db()->exec('ROLLBACK');
        if(!hash_equals($existing['payload_hash'],$hash)) enquiry_error(['message'=>'This submission was already saved with different details. Start a new enquiry from the Contact page.'],409);
        redirect('/message-received.php?ref='.$existing['reference']);
    }
    if(limited('message',5,900)) { db()->exec('COMMIT'); header('Retry-After: 900'); enquiry_error(['message'=>'Too many messages. Wait 15 minutes before retrying, or email info@mweinmedical.co.ke.'],429); }
    $reference=strtoupper(bin2hex(random_bytes(6)));
    run('INSERT INTO messages(reference,created_at,name,contact,category,message) VALUES (?,?,?,?,?,?)',[$reference,date('c'),$name,$contact,$category,$message]);
    $id=(int)db()->lastInsertRowID();
    run('INSERT INTO enquiry_receipts(request_key,payload_hash,reference,created) VALUES(?,?,?,?) ON CONFLICT(request_key) DO UPDATE SET payload_hash=excluded.payload_hash,reference=excluded.reference,created=excluded.created',[$request,$hash,$reference,time()]);
    db()->exec('COMMIT');
} catch(Throwable $e) { db()->exec('ROLLBACK'); throw $e; }
try { notify_enquiry($id); } catch(Throwable $e) { error_log('Mwein enquiry alert failed; message remains saved'); }
try { require_once __DIR__.'/outcomes.php';record_enquiry_source(post('source')); } catch(Throwable $e) { error_log('Mwein aggregate enquiry count failed'); }
redirect('/message-received.php?ref='.$reference);
