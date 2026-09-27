<?php
require dirname(__DIR__).'/api/mail.php';
session_open(); header('Referrer-Policy: no-referrer');
if ($_SERVER['REQUEST_METHOD']==='GET' && isset($_GET['token'])) {
    $token=is_string($_GET['token'])?$_GET['token']:'';
    $_SESSION['reset_token']=preg_match('/^[a-f0-9]{64}$/D',$token)?hash('sha256',$token):'';
    redirect('/manage/reset.php');
}
$record=rows(run('SELECT * FROM password_resets WHERE token=? AND expires>? AND used=0',[$_SESSION['reset_token']??'',time()]))[0]??null;
$valid=$record && hash_equals($record['credential'],hash('sha256',config()['password_hash'])) && !isset(config()['setup_token_hash']);
$error='';
if($_SERVER['REQUEST_METHOD']==='POST') {
    require_post(); check_csrf();
    if(limited('reset-password',10,900)) { http_response_code(429); $error='Too many attempts. Try again later.'; }
    elseif(!$valid) { http_response_code(400); $error='This reset link is invalid, expired or already used.'; }
    elseif(strlen(password_value('password'))<16 || strlen(password_value('password'))>72 || password_value('password')!==password_value('confirmation')) { http_response_code(422); $error='Use 16–72 bytes (plain letters, numbers and symbols recommended) and enter the same password twice.'; }
    elseif(update_password(config()['password_hash'],password_value('password'))) {
        run('UPDATE password_resets SET used=1'); $_SESSION=[]; session_regenerate_id(true); redirect('/manage/login.php?reset=complete');
    } else { http_response_code(409); $error='This link is no longer valid. Request a new one.'; }
}
layout_start('Choose a new password'); ?>
<section class="login-card"><h1>Choose a new password.</h1><?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif ?>
<?php if($valid): ?><form method="post"><?= csrf() ?><label>New password<input type="password" name="password" autocomplete="new-password" minlength="16" maxlength="72" required></label><label>Confirm password<input type="password" name="confirmation" autocomplete="new-password" minlength="16" maxlength="72" required></label><button class="button">Reset password</button></form><p>All existing sign-ins will end.</p><?php else: ?><p>This link is invalid, expired or already used.</p><a href="/manage/forgot.php">Request a new reset link</a><?php endif ?></section>
<?php layout_end(); ?>
