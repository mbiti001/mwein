<?php
require dirname(__DIR__).'/api/common.php';session_open();
$state=admin_security_state();
if(!isset($_SESSION['pending_admin'],$_SESSION['pending_credential'],$_SESSION['pending_version']) ||
 time()-$_SESSION['pending_admin']>=300 || $state['secret']==='' ||
 (int)$_SESSION['pending_version']!==(int)$state['version'] ||
 !hash_equals(hash('sha256',config()['password_hash']),$_SESSION['pending_credential'])) {
    $_SESSION=['csrf'=>bin2hex(random_bytes(32))];redirect('/manage/login.php');
}
$error='';
if($_SERVER['REQUEST_METHOD']==='POST') {
    require_post();check_csrf();
    $network=limited('mfa',8,900);
    $account=!$network && limited('mfa-account',30,900,'website-admin');
    if($network||$account){admin_event('mfa_blocked');http_response_code(429);header('Retry-After: 900');$error='Too many attempts. Try again in 15 minutes.';}
    elseif(admin_mfa_check(post('code'))){admin_sign_in();redirect('/manage/');}
    else{admin_event('mfa_failed');http_response_code(401);$error='The code is incorrect, expired or already used.';}
}
layout_start('Two-step verification'); ?>
<section class="login-card"><p class="eyebrow">WEBSITE ADMINISTRATION</p><h1>Verify it’s you.</h1>
<p>Enter the six-digit code from your authenticator app, or one unused recovery code.</p>
<?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif ?>
<form method="post"><?= csrf() ?><label>Verification or recovery code<input name="code" autocomplete="one-time-code" maxlength="32" required autofocus></label><button class="button">Verify and sign in</button></form>
<p class="small">This sign-in step expires after five minutes. Codes can be used only once.</p><a href="/manage/login.php">Start sign-in again</a></section>
<?php layout_end(); ?>
