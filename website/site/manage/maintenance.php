<?php
require dirname(__DIR__).'/api/backup.php';
require_once dirname(__DIR__).'/api/notifications.php';
require_admin(); notification_table(); $notice='';
if ($_SERVER['REQUEST_METHOD']==='POST') {
    require_post();check_csrf();
    if(post('action')==='backup') {
        if(limited('backup',3,3600)) {http_response_code(429);$notice='Backup limit reached. Try again later.';}
        else {backup_website(); redirect('/manage/maintenance.php?saved=backup');}
    } elseif(post('action')==='retry') {
        if(limited('notification-retry',3,3600)) {http_response_code(429);$notice='Retry limit reached.';}
        else {foreach(rows(run("SELECT message_id FROM notifications WHERE state='failed' LIMIT 10")) as $n) notify_enquiry((int)$n['message_id'],true);redirect('/manage/maintenance.php?saved=alerts');}
    } else {http_response_code(422);$notice='Unknown action.';}
}
$path=config()['data_dir'].'/backup-status.json';
$last=is_file($path)?json_decode(file_get_contents($path),true):null;
$states=rows(run('SELECT state,COUNT(*) AS total FROM notifications GROUP BY state'));
layout_start('Backups and alerts'); ?>
<p><a href="/manage/">← Dashboard</a></p><h1>Backups & alerts</h1>
<?php if($notice): ?><p role="alert"><?= h($notice) ?></p><?php elseif(isset($_GET['saved'])): ?><p class="notice">Operation completed. Check the results below.</p><?php endif ?>
<section class="contact-card"><h2>Private inbox backup</h2>
<?php if($last): ?><p>Last snapshot: <?= h($last['created_at']) ?> · Restore check: <?= h($last['restore_check']) ?></p><p>Snapshot: <?= h($last['snapshot']) ?></p><p>Saved messages: <?= (int)$last['counts']['messages'] ?> · Activity entries: <?= (int)$last['counts']['activity'] ?></p><?php else: ?><p>No verified snapshot recorded yet.</p><?php endif ?>
<p>Snapshots include the database and account configuration, stored privately on this hosting account. Each database snapshot is restored separately and checked. Off-site recovery still depends on hosting backups. Snapshots are not automatically deleted.</p>
<form method="post"><?= csrf() ?><input type="hidden" name="action" value="backup"><button class="button">Create and verify backup</button></form></section>
<section class="contact-card"><h2>New enquiry email alerts</h2><p>Alerts go to <?= h(config()['admin_email']) ?> and contain a reference and sign-in link, without visitor details. General enquiries use info@mweinmedical.co.ke; official enquiries use admin@mweinmedical.co.ke.</p>
<?php foreach($states as $s): ?><p><?= h(['accepted'=>'Accepted by mail server (delivery not confirmed)','failed'=>'Failed — safe to retry','sending'=>'Uncertain — check mail logs before retrying'][$s['state']]??$s['state']) ?>: <?= (int)$s['total'] ?></p><?php endforeach ?>
<form method="post"><?= csrf() ?><input type="hidden" name="action" value="retry"><button class="button secondary">Retry failed alerts</button></form><p>Only explicitly failed alerts are retried. Earlier enquiries do not trigger retrospective alerts. WhatsApp automation is awaiting Business Platform setup.</p></section>
<p>Runtime: PHP <?= h(PHP_VERSION) ?> · SQLite <?= h(SQLite3::version()['versionString']) ?></p>
<?php layout_end(); ?>
