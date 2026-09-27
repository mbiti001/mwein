<?php
require dirname(__DIR__) . '/api/common.php';
session_open();
$error = '';
if (isset(config()['setup_token_hash'])) redirect('/manage/setup.php');
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post(); check_csrf();
    $networkBlocked = limited('login', 8, 900);
    // One administrator: a shared bucket also limits attempts spread across networks.
    // Only network-admitted attempts consume it, so one blocked IP cannot keep filling it.
    $accountBlocked = !$networkBlocked && limited('login-account', 40, 900, 'website-admin');
    if ($networkBlocked || $accountBlocked) { http_response_code(429); header('Retry-After: 900'); $error = 'Too many attempts. Please try again in 15 minutes.'; }
    else {
    $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
    $validPassword = strlen($password) <= 72 && !str_contains($password, "\0");
    // Always run the same password check for unknown and known email addresses.
    $verified = password_verify($validPassword ? $password : '', config()['password_hash']);
    if ($validPassword && $verified && hash_equals(config()['admin_email'], strtolower(post('email')))) {
        session_regenerate_id(true);
        $_SESSION = ['admin'=>true, 'last'=>time(), 'started'=>time(), 'credential'=>hash('sha256', config()['password_hash']), 'csrf'=>bin2hex(random_bytes(32))];
        redirect('/manage/');
    } else { http_response_code(401); $error = 'The email or password is incorrect.'; }
    }
}
layout_start('Website admin sign-in');
?>
<section class="login-card"><p class="eyebrow">WEBSITE ADMINISTRATION</p><h1>Welcome back.</h1><p>Sign in to review messages and website activity.</p>
<?php if ($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif ?>
<?php if(isset($_GET['reset'])): ?><p class="notice">Password updated. Please sign in.</p><?php endif ?><form method="post"><?= csrf() ?><label>Email address<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="button">Sign in →</button></form>
<p><a href="/manage/forgot.php">Forgot your password?</a></p><p class="small">This is the website inbox. <a href="/staff.html">Go to the staff EMR</a> for clinical work.</p></section>
<?php layout_end(); ?>
