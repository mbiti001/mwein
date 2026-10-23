<?php
require dirname(__DIR__).'/api/mail.php'; require_admin(); $error='';
if($_SERVER['REQUEST_METHOD']==='POST') {
    require_post(); check_csrf();
    if(limited('change-password',8,900)) $error='Too many attempts. Try again in 15 minutes.';
    elseif(!password_verify(password_value('current'),config()['password_hash'])) $error='Your current password is incorrect.';
    elseif(strlen(password_value('password'))<16 || strlen(password_value('password'))>72 || password_value('password')!==password_value('confirmation')) $error='Use 16–72 bytes (plain letters, numbers and symbols recommended) and enter the same new password twice.';
    elseif(update_password(config()['password_hash'],password_value('password'))) { run('UPDATE password_resets SET used=1'); $_SESSION=[];session_regenerate_id(true);redirect('/manage/login.php?reset=complete'); }
    else $error='Your credentials changed. Sign in again.';
}
layout_start('Account settings'); ?>
<p><a href="/manage/">← Dashboard</a></p><section class="login-card"><h1>Account security</h1><p>Administrator: <?= h(config()['admin_email']) ?></p><p>Recovery emails go to this address. Keep access to the mailbox secure.</p><?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif ?><form method="post"><?= csrf() ?><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="16" maxlength="72" required></label><label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" minlength="16" maxlength="72" required></label><button class="button">Change password</button></form><p>Changing your password ends all existing sign-ins.</p></section>
<?php layout_end(); ?>
