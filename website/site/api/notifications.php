<?php
require_once __DIR__.'/mail.php';
function notification_table(): void {
    db()->exec("CREATE TABLE IF NOT EXISTS notifications (message_id INTEGER PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)");
}
function notify_enquiry(int $id, bool $retry=false): void {
    notification_table();
    $m=rows(run('SELECT id,reference,category FROM messages WHERE id=?',[$id]))[0]??null;
    if (!$m) return;
    if ($retry) run("UPDATE notifications SET state='sending',updated_at=? WHERE message_id=? AND state='failed'",[date('c'),$id]);
    else run("INSERT OR IGNORE INTO notifications(message_id,state,updated_at) VALUES (?,'sending',?)",[$id,date('c')]);
    if (db()->changes()!==1) return;
    $accepted=false;
    try {
        $accepted=send_email(config()['admin_email'],'New Mwein website enquiry '.$m['reference'],"A new website enquiry is ready for review.\n\nReference: ".$m['reference']."\nOpen the private inbox: ".config()['origin'].'/manage/message.php?id='.$id."\n\nSign in to read and respond. Visitor details are available only in the inbox.",enquiry_sender($m['category']));
    } catch (Throwable $e) { error_log('Mwein enquiry notification transport failed'); }
    run('UPDATE notifications SET state=?,updated_at=? WHERE message_id=?',[$accepted?'accepted':'failed',date('c'),$id]);
}
