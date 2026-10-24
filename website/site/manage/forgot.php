<?php
require dirname(__DIR__).'/api/mail.php';
session_open(); $notice='';
if ($_SERVER['REQUEST_METHOD']==='POST') {
    require_post(); check_csrf();
    $notice='If this address belongs to the administrator, a password reset link will be sent. Check your inbox and spam folder. The link expires in 30 minutes.';
    $blocked=limited('reset',5,3600);
    if (!$blocked && hash_equals(config()['admin_email'],strtolower(post('email'))) && !isset(config()['setup_token_hash'])) {
        $recent=(int)scalar(run('SELECT COUNT(*) FROM password_resets WHERE created>?',[time()-300]));
        if ($recent===0) {
            $token=bin2hex(random_bytes(32)); $hash=hash('sha256',$token);
            run('DELETE FROM password_resets WHERE expires<?',[time()]);
            run('INSERT INTO password_resets(token,created,expires,credential) VALUES(?,?,?,?)',[$hash,time(),time()+1800,hash('sha256',config()['password_hash'])]);
            $url=config()['origin'].'/manage/reset.php?token='.$token;
            if (!send_email(config()['admin_email'],'Reset your Mwein website password',"Use this link within 30 minutes to choose a new website password:\n\n".$url."\n\nIf you did not request this, ignore this email. Your password has not changed.\nMwein Medical Services")) {
                run('DELETE FROM password_resets WHERE token=?',[$hash]);
                error_log('Mwein password reset email was not accepted by mail server');
            }
        }
    }
}
layout_start('Reset your password'); ?>
<section class="login-card"><h1>Forgot your password?</h1><p>We’ll email a recovery link to your administrator address.</p>
<?php if($notice): ?><p class="notice" role="status"><?= h($notice) ?></p><?php endif ?>
<form method="post"><?= csrf() ?><label>Email address<input type="email" name="email" autocomplete="email" required maxlength="254"></label><button class="button">Send reset link</button></form><p><a href="/manage/login.php">Back to sign-in</a></p></section>
<?php layout_end(); ?>
