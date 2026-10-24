<?php
require dirname(__DIR__).'/api/mail.php'; require_admin();
$id=filter_var($_GET['id']??'',FILTER_VALIDATE_INT);
$m=$id? (rows(run('SELECT * FROM messages WHERE id=?',[$id]))[0]??null):null;
if(!$m){http_response_code(404);exit('Message not found');}
$sender=enquiry_sender($m['category']);
$error=''; $body=post('body');
if($_SERVER['REQUEST_METHOD']==='POST') {
    require_post();check_csrf(); $action=post('action');
    $key=post('request_key');
    if(!preg_match('/^[a-f0-9]{32}$/D',$key)) {http_response_code(422);$error='Reload the page and try again.';}
    elseif(scalar(run('SELECT id FROM activity WHERE request_key=?',[$key]))) redirect('/manage/message.php?id='.$id);
    elseif($action==='status' && in_array(post('status'),['new','in progress','closed','spam'],true)) {
        db()->exec('BEGIN IMMEDIATE');
        try {run('UPDATE messages SET status=? WHERE id=?',[post('status'),$id]);run('INSERT INTO activity(message_id,created_at,kind,body,request_key) VALUES(?,?,?,?,?)',[$id,date('c'),'status','Status changed to '.post('status'),$key]);db()->exec('COMMIT');}catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
        redirect('/manage/message.php?id='.$id.'&saved=1');
    } elseif(in_array($action,['note','reply'],true) && strlen($body)>=2 && strlen($body)<=6000) {
        if($action==='reply' && !filter_var($m['contact'],FILTER_VALIDATE_EMAIL)) {http_response_code(422);$error='This enquiry has a phone number. Use the WhatsApp link and record an internal note.';}
        elseif($action==='reply' && limited('outgoing',20,3600)) {http_response_code(429);$error='The hourly reply limit has been reached. Your draft is below; please try later.';}
        else {
            run('INSERT OR IGNORE INTO activity(message_id,created_at,kind,body,delivery,request_key) VALUES(?,?,?,?,?,?)',[$id,date('c'),$action,$body,$action==='reply'?'sending':'',$key]);
            if(db()->changes()===0) redirect('/manage/message.php?id='.$id);
            if($action==='reply') {
                $accepted=false;
                try {$accepted=send_email($m['contact'],'Mwein enquiry '.$m['reference'],"Hello ".$m['name'].",\n\n".$body."\n\nMwein Medical Services\nExceptional care close to you.\nWebsite enquiries: https://mweinmedical.co.ke/contact.html#send-message\nWhatsApp messages only: +254 707 711 888\n\nReference: ".$m['reference']."\nReply to this email to reach our team at ".$sender.". Do not email medical records or identification documents.",$sender);}catch(Throwable $e){error_log('Mwein reply transport failure');}
                run('UPDATE activity SET delivery=? WHERE request_key=?',[$accepted?'accepted':'failed',$key]);
                if($accepted) run("UPDATE messages SET status='in progress' WHERE id=? AND status='new'",[$id]);
                else $error='The mail server did not accept your reply. It is saved below as failed. You can copy it into a new reply to try again.';
            }
            if(!$error) redirect('/manage/message.php?id='.$id.'&saved=1');
        }
    } else {http_response_code(422);$error='Check the action and enter between 2 and 6,000 characters.';}
}
$history=rows(run('SELECT * FROM activity WHERE message_id=? ORDER BY id',[$id]));
layout_start('Enquiry '.$m['reference']); ?>
<p><a href="/manage/#inbox">← Back to inbox</a></p><div class="admin-title"><div><p class="eyebrow"><?= h($m['category']) ?> · <?= h($m['reference']) ?></p><h1><?= h($m['name']) ?></h1><p><?= h(date('j M Y, H:i',strtotime($m['created_at']))) ?> · <?= h($m['status']) ?></p></div></div>
<?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php elseif(isset($_GET['saved'])): ?><p class="notice" role="status">Saved. Email replies show their delivery status in the history below.</p><?php endif ?>
<div class="activity-grid"><section><h2>Conversation</h2><article class="contact-card"><p class="eyebrow">WEBSITE ENQUIRY</p><p class="message-text"><?= h($m['message']) ?></p><p>Contact: <?php if(filter_var($m['contact'],FILTER_VALIDATE_EMAIL)): ?><a href="mailto:<?= h($m['contact']) ?>"><?= h($m['contact']) ?></a><?php else: ?><a href="https://wa.me/<?= h(whatsapp_contact($m['contact'])) ?>"><?= h($m['contact']) ?></a><?php endif ?></p></article>
<?php foreach($history as $entry): ?><article class="contact-card history-item"><p class="eyebrow"><?= h(['note'=>'INTERNAL NOTE','reply'=>'EMAIL REPLY','status'=>'STATUS UPDATE'][$entry['kind']]??$entry['kind']) ?> · <?= h(date('j M, H:i',strtotime($entry['created_at']))) ?></p><p class="message-text"><?= h($entry['body']) ?></p><?php if($entry['delivery']): ?><p class="badge"><?= h(['accepted'=>'Accepted by mail server — delivery not confirmed','failed'=>'Failed — not accepted by mail server','sending'=>'Delivery uncertain — check Sent/mail logs before retrying'][$entry['delivery']]??'Unknown delivery') ?></p><?php endif ?></article><?php endforeach ?>
</section><section><h2>Follow up</h2><form method="post" class="contact-card"><?= csrf() ?><input type="hidden" name="request_key" value="<?= bin2hex(random_bytes(16)) ?>"><input type="hidden" name="action" value="status"><label>Status<select name="status"><?php foreach(['new','in progress','closed','spam'] as $status): ?><option value="<?= h($status) ?>" <?= $m['status']===$status?'selected':'' ?>><?= h(ucfirst($status)) ?></option><?php endforeach ?></select></label><button class="button secondary">Update status</button></form>
<?php if(filter_var($m['contact'],FILTER_VALIDATE_EMAIL)): ?><form method="post" class="contact-card history-item"><?= csrf() ?><input type="hidden" name="request_key" value="<?= bin2hex(random_bytes(16)) ?>"><input type="hidden" name="action" value="reply"><h3>Reply by email</h3><p>To <?= h($m['contact']) ?><br>From <?= h($sender) ?></p><label>Your reply<textarea name="body" rows="7" minlength="2" maxlength="6000" required><?= h(post('action')==='reply'?$body:'') ?></textarea></label><button class="button">Send email reply</button><p class="small">Replies from visitors arrive at <?= h($sender) ?>. This dashboard records outgoing replies, not incoming email.</p></form><?php else: ?><div class="contact-card history-item"><h3>Respond on WhatsApp</h3><p>This visitor supplied a WhatsApp number. <a href="https://wa.me/<?= h(whatsapp_contact($m['contact'])) ?>">Message <?= h($m['contact']) ?> on WhatsApp</a>, then record the outcome below.</p></div><?php endif ?>
<form method="post" class="contact-card history-item"><?= csrf() ?><input type="hidden" name="request_key" value="<?= bin2hex(random_bytes(16)) ?>"><input type="hidden" name="action" value="note"><h3>Internal note</h3><label>Note<textarea name="body" rows="4" minlength="2" maxlength="6000" required><?= h(post('action')==='note'?$body:'') ?></textarea></label><p class="small">Visible only to website administrators. Notes are not sent to the visitor. Keep clinical records in the EMR.</p><button class="button secondary">Save note</button></form></section></div>
<?php layout_end(); ?>
