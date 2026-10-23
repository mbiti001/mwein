<?php
require dirname(__DIR__).'/api/mail.php';require_admin();
$error='';$notice='';$state=admin_security_state();
if(isset($_SESSION['mfa_enrolment']) && ($_SESSION['mfa_enrolment']['expires']<time() || !hash_equals($_SESSION['mfa_enrolment']['credential'],hash('sha256',config()['password_hash'])))) unset($_SESSION['mfa_enrolment']);
if($_SERVER['REQUEST_METHOD']==='POST') {
    require_post();check_csrf();
    $network=limited('admin-security',8,900);
    $account=!$network && limited('admin-security-account',30,900,'website-admin');
    if($network||$account){http_response_code(429);header('Retry-After: 900');$error='Too many attempts. Try again in 15 minutes.';}
    elseif(!admin_password_correct(password_value('current'))){http_response_code(401);$error='Your current password is incorrect.';}
    else {
        try {
            $action=post('action');
            if($action==='enrol' && $state['secret']===''){
                $_SESSION['mfa_enrolment']=['secret'=>random_bytes(20),'expires'=>time()+600,'credential'=>hash('sha256',config()['password_hash'])];
                redirect('/manage/security.php');
            } elseif($action==='enable' && $state['secret']==='' && isset($_SESSION['mfa_enrolment'])) {
                $codes=admin_mfa_enable($_SESSION['mfa_enrolment']['secret'],post('code'));
                admin_sign_in();$_SESSION['new_recovery_codes']=$codes;redirect('/manage/security.php');
            } elseif($action==='revoke'){
                admin_revoke_other_sessions();$notice='Other website administration sessions have been signed out.';
            } elseif(in_array($action,['rotate','disable'],true) && $state['secret']!==''){
                if(!admin_mfa_check(post('code'))) throw new InvalidArgumentException('Enter a current authenticator code or an unused recovery code.');
                db()->exec('BEGIN IMMEDIATE');
                try {
                    if($action==='rotate') {$codes=admin_recovery_generate();admin_event('recovery_rotated');}
                    else {run("UPDATE admin_security SET secret='',last_counter=-1,version=version+1 WHERE id=1");run('DELETE FROM admin_recovery');run('DELETE FROM admin_sessions');admin_event('mfa_disabled');}
                    db()->exec('COMMIT');
                }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
                if($action==='disable') admin_sign_in();
                if($action==='rotate') $_SESSION['new_recovery_codes']=$codes;
                redirect('/manage/security.php');
            } else {http_response_code(400);$error='This security request is unavailable. Reload the page.';}
        } catch(InvalidArgumentException $e){http_response_code(422);$error=$e->getMessage();}
    }
}
$state=admin_security_state();$enrolment=$_SESSION['mfa_enrolment']??null;
$codes=$_SESSION['new_recovery_codes']??[];unset($_SESSION['new_recovery_codes']);
$sessions=(int)scalar(run('SELECT count(*) FROM admin_sessions'));
$recovery=(int)scalar(run('SELECT count(*) FROM admin_recovery'));
$events=rows(run('SELECT created,event,network FROM admin_security_events ORDER BY id DESC LIMIT 30'));
layout_start('Sign-in security'); ?>
<p><a href="/manage/settings.php">← Account settings</a> · <a href="/manage/">Dashboard</a></p>
<section class="admin-section"><p class="eyebrow">PROTECT WEBSITE ADMINISTRATION</p><h1>Sign-in security</h1>
<p>Sessions expire after 30 minutes without activity or eight hours from sign-in. Changing your password ends existing sign-ins. Two-step verification stays enabled after a password reset.</p>
<?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif ?>
<?php if($notice): ?><p class="notice" role="status"><?= h($notice) ?></p><?php endif ?>
<?php if($codes): ?><section class="notice"><h2>Save your recovery codes now</h2><p>These codes are displayed once. Store them in your password manager or another safe place, separately from your phone. Each works once. Never send them through the website enquiry form.</p><ul><?php foreach($codes as $code): ?><li><code><?= h($code) ?></code></li><?php endforeach ?></ul></section><?php endif ?>
<h2>Two-step verification: <?= $state['secret']!==''?'enabled':'not yet enabled' ?></h2>
<?php if($state['secret']==='' && !$enrolment): ?>
<p>Add this account to an authenticator app that supports time-based codes. You will confirm a code before two-step verification becomes required. No password or sign-in change takes place until confirmation.</p>
<form method="post" class="enquiry-form"><?= csrf() ?><input type="hidden" name="action" value="enrol"><label>Current password<input name="current" type="password" autocomplete="current-password" required maxlength="200"></label><button class="button">Set up authenticator</button></form>
<?php elseif($state['secret']===''): ?>
<p>In your authenticator app choose to enter a setup key. Account: <?= h(config()['admin_email']) ?>. Type: time based, six digits, 30 seconds.</p>
<p class="message-text"><strong>Private setup key:</strong> <code><?= h(admin_base32($enrolment['secret'])) ?></code></p>
<p>This setup expires after ten minutes. Keep the key private. Enter the current code to finish, then save the recovery codes displayed.</p>
<form method="post" class="enquiry-form"><?= csrf() ?><input type="hidden" name="action" value="enable"><label>Current password<input name="current" type="password" autocomplete="current-password" required maxlength="200"></label><label>Authenticator code<input name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required maxlength="6"></label><button class="button">Confirm and enable two-step verification</button></form>
<?php else: ?>
<p>Your password and a code are required for new sign-ins. <?= $recovery ?> unused recovery codes remain.</p>
<details><summary>Replace recovery codes</summary><p>This invalidates the previous recovery codes. Save the replacement codes immediately.</p><form method="post" class="enquiry-form"><?= csrf() ?><input type="hidden" name="action" value="rotate"><label>Current password<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label><label>Authenticator or recovery code<input name="code" autocomplete="one-time-code" required maxlength="32"></label><button class="button">Replace recovery codes</button></form></details>
<details><summary>Disable two-step verification</summary><p>Your password and a current authenticator or unused recovery code are required. Disabling it signs out other sessions and makes new sign-ins password-only.</p><form method="post" class="enquiry-form"><?= csrf() ?><input type="hidden" name="action" value="disable"><label>Current password<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label><label>Authenticator or recovery code<input name="code" autocomplete="one-time-code" required maxlength="32"></label><button class="button secondary">Disable two-step verification</button></form></details>
<?php endif ?></section>
<section class="admin-section"><h2>Website sessions</h2><p><?= $sessions ?> active sign-in sessions, including this one.</p><form method="post" class="enquiry-form"><?= csrf() ?><input type="hidden" name="action" value="revoke"><label>Current password<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label><button class="button">Sign out other sessions</button></form></section>
<section class="admin-section"><h2>Recent security activity</h2><p>Last 30 events, retained for up to 90 days. Network references are keyed digests that rotate monthly; raw addresses, passwords and verification codes are not stored in this log.</p><table><thead><tr><th>Kenya time</th><th>Event</th><th>Network reference</th></tr></thead><tbody><?php foreach($events as $event): ?><tr><td><?= h(date('j M Y H:i',$event['created'])) ?></td><td><?= h(str_replace('_',' ',$event['event'])) ?></td><td><?= h(substr($event['network'],0,12)) ?></td></tr><?php endforeach ?></tbody></table></section>
<?php layout_end(); ?>
