<?php
declare(strict_types=1);
// Hosting-owner recovery only. Keep this tool outside the public document root.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
$path=$argv[1]??'';
if(!is_file($path) || ($argv[2]??'')!=='--disable-mfa'){
    fwrite(STDERR,"Usage: php recover-admin-mfa.php /private/config.php --disable-mfa [/absolute/document-root]\nThis disables website MFA and signs out website admin sessions. The password is unchanged.\n");exit(1);
}
putenv('MWEIN_WEB_CONFIG='.$path);
$root=$argv[3]??dirname(__DIR__).'/site';
require $root.'/api/common.php';
admin_security_tables();db()->exec('BEGIN IMMEDIATE');
try{
    run("UPDATE admin_security SET secret='',last_counter=-1,version=version+1 WHERE id=1");
    run('DELETE FROM admin_recovery');run('DELETE FROM admin_sessions');admin_event('mfa_disabled');db()->exec('COMMIT');
}catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
echo "Website two-step verification disabled by the hosting owner. Existing sessions revoked. Re-enrol from Account security after signing in.\n";
