<?php
require_once __DIR__ . '/common.php';
function enquiry_sender(string $category): string {
    return in_array($category, ['Official correspondence', 'Partnership or support'], true)
        ? 'admin@mweinmedical.co.ke' : 'info@mweinmedical.co.ke';
}
function send_email(string $to, string $subject, string $body, string $from = 'admin@mweinmedical.co.ke'): bool {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to . $subject)) throw new InvalidArgumentException('Invalid email');
    if (!in_array($from, ['info@mweinmedical.co.ke','admin@mweinmedical.co.ke'], true)) throw new InvalidArgumentException('Invalid sender');
    // The local test transport is explicitly configured outside the public website.
    if (getenv('MWEIN_TEST_MAIL_DIR') && str_starts_with(config()['origin'], 'http://127.0.0.1:')) {
        return file_put_contents(getenv('MWEIN_TEST_MAIL_DIR') . '/' . bin2hex(random_bytes(8)) . '.json', json_encode(compact('to','subject','body','from'))) !== false;
    }
    return mail($to, $subject, $body, ['From'=>'Mwein Medical Services <'.$from.'>', 'Reply-To'=>$from, 'MIME-Version'=>'1.0', 'Content-Type'=>'text/plain; charset=UTF-8']);
}
function password_value(string $key): string { return is_string($_POST[$key] ?? null) ? $_POST[$key] : ''; }
function update_password(string $expectedHash, string $password): bool {
    if (strlen($password)<16 || strlen($password)>72 || str_contains($password, "\0")) throw new InvalidArgumentException('Invalid password length');
    $path = getenv('MWEIN_WEB_CONFIG') ?: dirname(__DIR__,2).'/mwein-website-private/config.php';
    $lock=fopen(dirname($path).'/setup.lock','c');
    if (!$lock || !flock($lock,LOCK_EX)) throw new RuntimeException('Password lock');
    try {
        if(function_exists('opcache_invalidate')) opcache_invalidate($path,true);
        $current=require $path;
        if(!hash_equals($expectedHash,$current['password_hash']) || isset($current['setup_token_hash'])) return false;
        $current['password_hash']=password_hash($password,PASSWORD_DEFAULT);
        $temp=tempnam(dirname($path),'password-');
        if(file_put_contents($temp,"<?php\nreturn ".var_export($current,true).";\n")===false || !rename($temp,$path)) throw new RuntimeException('Password save');
        if(function_exists('opcache_invalidate')) opcache_invalidate($path,true);
        return true;
    } finally { flock($lock,LOCK_UN); fclose($lock); }
}
