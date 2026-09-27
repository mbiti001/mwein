<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
if (!extension_loaded('sqlite3')) exit("Enable SQLite3 before setup.\n");
$target = $argv[1] ?? '';
$origin = rtrim($argv[2] ?? 'https://mweinmedical.co.ke', '/');
$email = strtolower($argv[3] ?? '');
if (!$target || $target[0] !== '/' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('~^https://[a-z0-9.-]+$|^http://127\.0\.0\.1:[0-9]+$~D', $origin)) exit("Usage: php setup.php /absolute/private-directory https://mweinmedical.co.ke admin-email\nUse a private directory outside public_html. Password is read from standard input.\n");
if (str_contains($target, '/public_html') || str_contains($target, '/site/')) exit("Choose a directory outside the website.\n");
if (!is_dir($target) && !mkdir($target, 0700, true)) exit("Cannot create private directory.\n");
$configPath = $target . '/config.php';
if (file_exists($configPath)) exit("Already configured. Use reset-password.php to change the password.\n");
fwrite(STDERR, "New password (16–72 bytes (plain letters, numbers and symbols recommended); input is hidden on an interactive terminal): ");
$interactive = function_exists('stream_isatty') && stream_isatty(STDIN);
if ($interactive) system('stty -echo');
try { $password = rtrim(fgets(STDIN) ?: '', "\r\n"); } finally { if ($interactive) system('stty echo'); }
if (strlen($password)<16 || strlen($password)>72) exit("\nPassword must contain 16–72 bytes (plain letters, numbers and symbols recommended).\n");
$config = ['origin'=>$origin, 'admin_email'=>$email, 'password_hash'=>password_hash($password, PASSWORD_DEFAULT), 'secret'=>bin2hex(random_bytes(32)), 'data_dir'=>realpath($target)];
$file = fopen($configPath, 'x');
if (!$file) exit("Cannot create configuration.\n");
fwrite($file, "<?php\nreturn " . var_export($config, true) . ";\n"); fclose($file);
putenv('MWEIN_WEB_CONFIG=' . $configPath);
require dirname(__DIR__) . '/site/api/common.php';
db();
echo "\nWebsite database and admin account created.\n";
