<?php
require dirname(__DIR__) . '/api/common.php';
session_open();
$settings = config();
$tokenHash = $settings['setup_token_hash'] ?? '';
if (!$tokenHash || ($settings['setup_expires'] ?? 0) < time()) { http_response_code(404); exit('Setup is unavailable. Use the normal admin sign-in.'); }
// Initialising the database also checks SQLite support before the owner enters a password.
db();
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post(); check_csrf();
    if (limited('setup', 8, 900)) { http_response_code(429); $error = 'Too many attempts. Please try again in 15 minutes.'; }
    elseif (post('action') === 'unlock') {
        if (hash_equals($tokenHash, hash('sha256', post('code')))) {
            session_regenerate_id(true);
            $_SESSION['setup_authorized'] = $tokenHash;
            redirect('/manage/setup.php');
        } else { http_response_code(403); $error = 'The setup code is incorrect.'; }
    } elseif (post('action') === 'password' && hash_equals($tokenHash, $_SESSION['setup_authorized'] ?? '')) {
        $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
        $confirmation = is_string($_POST['confirmation'] ?? null) ? $_POST['confirmation'] : '';
        if (strlen($password) < 16 || strlen($password) > 72 || $password !== $confirmation) {
            http_response_code(422); $error = 'Use 16–72 bytes (plain letters, numbers and symbols recommended) and enter the same password twice.';
        } else {
            $path = getenv('MWEIN_WEB_CONFIG') ?: dirname(__DIR__, 2) . '/mwein-website-private/config.php';
            $lock = fopen(dirname($path) . '/setup.lock', 'c');
            if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock setup');
            if (function_exists('opcache_invalidate')) opcache_invalidate($path, true);
            $current = require $path;
            if (!hash_equals($tokenHash, $current['setup_token_hash'] ?? '') || ($current['setup_expires'] ?? 0)<time()) {
                flock($lock, LOCK_UN); fclose($lock); http_response_code(409); exit('Setup has already finished or expired.');
            }
            $current['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
            unset($current['setup_token_hash'], $current['setup_expires']);
            $temp = tempnam(dirname($path), 'setup-');
            if (file_put_contents($temp, "<?php\nreturn " . var_export($current,true) . ";\n") === false || !rename($temp, $path)) throw new RuntimeException('Cannot save setup');
            flock($lock, LOCK_UN); fclose($lock);
            $_SESSION = []; session_regenerate_id(true);
            redirect('/manage/login.php?setup=complete');
        }
    } else { http_response_code(403); $error = 'Unlock setup first.'; }
}
layout_start('Set up website administration');
?>
<section class="login-card"><p class="eyebrow">ONE-TIME ADMIN SETUP</p><h1>Make it yours.</h1>
<?php if($error): ?><p role="alert" class="error"><?= h($error) ?></p><?php endif ?>
<?php if(hash_equals($tokenHash, $_SESSION['setup_authorized'] ?? '')): ?>
<p>Create your website admin password. Your sign-in email is <strong><?= h($settings['admin_email']) ?></strong>.</p>
<form method="post"><?= csrf() ?><input type="hidden" name="action" value="password"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="16" maxlength="72" required></label><label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="16" maxlength="72" required></label><button class="button">Save my password →</button></form><p class="small">Use at least 16 characters. This setup page closes after you save your password.</p>
<?php else: ?>
<p>Enter the private setup code supplied during installation.</p><form method="post"><?= csrf() ?><input type="hidden" name="action" value="unlock"><label>Setup code<input type="password" name="code" autocomplete="off" required maxlength="128"></label><button class="button">Continue →</button></form>
<?php endif ?></section>
<?php layout_end(); ?>
