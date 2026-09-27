<?php
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
$public=$argv[1]??dirname(__DIR__).'/site';
require $public.'/api/backup.php';
try { $result=backup_website(); echo 'Mwein backup verified: '.$result['snapshot'].PHP_EOL; }
catch(Throwable $e) {fwrite(STDERR,'Mwein backup failed: '.get_class($e).PHP_EOL);exit(1);}
