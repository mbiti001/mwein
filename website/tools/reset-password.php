<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$path = $argv[1] ?? '';
if (!is_file($path)) exit("Usage: php reset-password.php /private/directory/config.php\n");
$config = require $path;
fwrite(STDERR, 'New password (16–72 bytes (plain letters, numbers and symbols recommended)): ');
$interactive = function_exists('stream_isatty') && stream_isatty(STDIN);
if ($interactive) system('stty -echo');
try { $password = rtrim(fgets(STDIN) ?: '', "\r\n"); } finally { if ($interactive) system('stty echo'); }
if (strlen($password)<16 || strlen($password)>72) exit("\nInvalid password length.\n");
$config['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
umask(0077);
$temp = tempnam(dirname($path), 'config-');
file_put_contents($temp, "<?php\nreturn " . var_export($config,true) . ";\n");
rename($temp, $path);
echo "\nPassword updated; existing admin sessions will be rejected.\n";
