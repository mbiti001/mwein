<?php
declare(strict_types=1);
// Shared website services. No credentials or patient data belong in this directory.
ini_set('display_errors', '0');
date_default_timezone_set('Africa/Nairobi');
umask(0077);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
set_exception_handler(function (Throwable $e): void {
    error_log('Mwein website: ' . get_class($e));
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<h1>Temporarily unavailable</h1><p>Please try again later or email info@mweinmedical.co.ke. You can also send a WhatsApp message to +254 707 711 888. Your message has not been confirmed as received.</p>';
});
function config(): array {
    static $config;
    if ($config !== null) return $config;
    $path = getenv('MWEIN_WEB_CONFIG') ?: dirname(__DIR__, 2) . '/mwein-website-private/config.php';
    if (!is_file($path)) throw new RuntimeException('Website setup required');
    if (function_exists('opcache_invalidate')) opcache_invalidate($path, true);
    $config = require $path;
    if (!is_array($config) || strlen($config['secret'] ?? '') < 32) throw new RuntimeException('Invalid configuration');
    $root = realpath(dirname(__DIR__));
    $data = realpath($config['data_dir']);
    if (!$data || $data === $root || str_starts_with($data, $root . DIRECTORY_SEPARATOR)) throw new RuntimeException('Data must be outside public root');
    return $config;
}
function db(): SQLite3 {
    static $db;
    if ($db) return $db;
    $db = new SQLite3(config()['data_dir'] . '/website.sqlite');
    $db->enableExceptions(true);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new');
    CREATE TABLE IF NOT EXISTS password_resets (token TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, credential TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT '', request_key TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS activity_message ON activity(message_id,id);
    CREATE TABLE IF NOT EXISTS views (day TEXT NOT NULL, path TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,path));
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
    return $db;
}
function run(string $sql, array $values = []): SQLite3Result {
    $statement = db()->prepare($sql);
    foreach ($values as $i => $value) $statement->bindValue($i+1, $value, is_int($value) ? SQLITE3_INTEGER : SQLITE3_TEXT);
    return $statement->execute();
}
function rows(SQLite3Result $result): array {
    $rows = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) $rows[] = $row;
    return $rows;
}
function scalar(SQLite3Result $result): mixed { return ($result->fetchArray(SQLITE3_NUM) ?: [null])[0]; }
function whatsapp_contact(string $contact): string {
    $digits=preg_replace('/[^0-9]/','',$contact);
    if(preg_match('/^0[17][0-9]{8}$/D',$digits)) $digits='254'.substr($digits,1);
    return preg_match('/^[1-9][0-9]{7,14}$/D',$digits) ? $digits : '';
}
function post(string $key): string { return is_string($_POST[$key] ?? null) ? trim($_POST[$key]) : ''; }
function h(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function redirect(string $path): never { header('Location: ' . $path, true, 303); exit; }
function session_open(): void {
    header('Referrer-Policy: no-referrer');
    $secure = parse_url(config()['origin'], PHP_URL_SCHEME) === 'https';
    if ($secure && ($_SERVER['HTTPS'] ?? '') !== 'on') { http_response_code(400); exit('HTTPS is required.'); }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('mwein_admin');
    session_set_cookie_params(['lifetime'=>0, 'path'=>'/manage', 'secure'=>$secure, 'httponly'=>true, 'samesite'=>'Strict']);
    session_start();
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}
function csrf(): string { return '<input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '">'; }
function check_csrf(): void {
    if (!hash_equals($_SESSION['csrf'], post('csrf'))) { http_response_code(403); exit('Session check failed. Reload this page and try again.'); }
}
function same_origin(): void {
    if (($_SERVER['HTTP_ORIGIN'] ?? '') !== config()['origin']) { http_response_code(403); exit('Please submit from the Mwein website.'); }
}
function require_post(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Allow: POST'); http_response_code(405); exit; }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) { http_response_code(413); exit('Message too large.'); }
}
function limited(string $scope, int $max, int $seconds, ?string $identity = null): bool {
    // Only a rotating keyed digest is stored, never the raw address. Do not trust forwarded IP headers.
    $now = time();
    $bucket = intdiv($now, $seconds);
    $key = hash_hmac('sha256', $scope . '|' . ($identity ?? ($_SERVER['REMOTE_ADDR'] ?? '')) . '|' . $bucket, config()['secret']);
    run('DELETE FROM limits WHERE expires < ?', [$now]);
    run('INSERT INTO limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', [$key, ($bucket+1)*$seconds]);
    return (int)scalar(run('SELECT count FROM limits WHERE key=?', [$key])) > $max;
}
function require_admin(): void {
    session_open();
    $valid = isset($_SESSION['admin'], $_SESSION['last'], $_SESSION['started'], $_SESSION['credential']) &&
        time() - $_SESSION['last'] < 1800 && time() - $_SESSION['started'] < 28800 &&
        hash_equals(hash('sha256', config()['password_hash']), $_SESSION['credential']);
    if (!$valid) { unset($_SESSION['admin']); redirect('/manage/login.php'); }
    $_SESSION['last'] = time();
    exclude_internal_browser();
}
function internal_browser(): bool {
    $cookie = $_COOKIE['mwein_internal'] ?? '';
    if (!is_string($cookie) || !preg_match('/^([0-9]{10})\.([a-f0-9]{64})$/D', $cookie, $m) || (int)$m[1] <= time()) return false;
    return hash_equals(hash_hmac('sha256', 'internal-browser|'.$m[1], config()['secret']), $m[2]);
}
function exclude_internal_browser(): void {
    $expires = time() + 365*86400;
    $options = ['expires'=>$expires,'path'=>'/','secure'=>parse_url(config()['origin'], PHP_URL_SCHEME)==='https','httponly'=>true,'samesite'=>'Lax'];
    setcookie('mwein_internal', $expires.'.'.hash_hmac('sha256', 'internal-browser|'.$expires, config()['secret']), $options);
    $options['expires'] = time()-3600;
    setcookie('mwein_visitor','',$options); setcookie('mwein_visit','',$options);
}
function layout_start(string $title): void {
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . h($title) . ' | Mwein</title><link rel="icon" href="/favicon.ico?v=mwein-tab02"><link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png?v=mwein-tab02"><link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=mwein-tab02"><link rel="stylesheet" href="/assets/site.css?v=ux03"><link rel="stylesheet" href="/assets/inbox.css?v=2"><link rel="stylesheet" href="/assets/experience.css?v=ux02"></head><body class="dashboard"><header class="wrap header"><a href="/index.html" class="brand"><img src="/assets/mwein-wordmark.png" width="300" height="100" alt="Mwein Medical Services"></a><a href="/index.html">View website ↗</a></header><main class="wrap admin-main">';
}
function layout_end(): void { echo '</main></body></html>'; }
