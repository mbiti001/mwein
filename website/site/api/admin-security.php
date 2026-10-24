<?php
// Website administration only. No clinical HMIS integration.
require_once __DIR__.'/common.php';

function admin_security_tables(): void {
    static $ready=false;
    if($ready) return;
    // Online SQLite backup before the additive security schema is first created.
    $lock=fopen(config()['data_dir'].'/admin-security-migration.lock','c');
    if(!$lock || !flock($lock,LOCK_EX)) throw new RuntimeException('Cannot lock security migration');
    try {
        if(!scalar(run("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_security'"))) {
            $folder=config()['data_dir'].'/security-backups';
            if(!is_dir($folder) && !mkdir($folder,0700)) throw new RuntimeException('Cannot create security backup directory');
            $backup=new SQLite3($folder.'/before-security-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(4)).'.sqlite');
            if(!db()->backup($backup) || $backup->querySingle('PRAGMA integrity_check')!=='ok') throw new RuntimeException('Security backup verification failed');
            $backup->close();
        }
    db()->exec("CREATE TABLE IF NOT EXISTS admin_security(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL DEFAULT '',last_counter INTEGER NOT NULL DEFAULT -1,version INTEGER NOT NULL DEFAULT 1);
      INSERT OR IGNORE INTO admin_security(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS admin_recovery(hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,credential TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_security_events(id INTEGER PRIMARY KEY AUTOINCREMENT,created INTEGER NOT NULL,event TEXT NOT NULL,network TEXT NOT NULL);");
    } finally {flock($lock,LOCK_UN);fclose($lock);}
    run('DELETE FROM admin_sessions WHERE last_seen<? OR created<?',[time()-1800,time()-28800]);
    run('DELETE FROM admin_security_events WHERE created<?',[time()-90*86400]);
    $ready=true;
}
function admin_security_state(): array {
    admin_security_tables();
    return rows(run('SELECT * FROM admin_security WHERE id=1'))[0];
}
function admin_event(string $event): void {
    admin_security_tables();
    $allowed=['login_failed','login_blocked','password_accepted','login_success','mfa_failed','mfa_blocked','mfa_enabled','mfa_disabled','recovery_used','recovery_rotated','sessions_revoked','logout','password_changed'];
    if(!in_array($event,$allowed,true)) throw new InvalidArgumentException('Unknown security event');
    $network=hash_hmac('sha256',date('Y-m').'|'.($_SERVER['REMOTE_ADDR']??'cli'),config()['secret']);
    run('INSERT INTO admin_security_events(created,event,network) VALUES(?,?,?)',[time(),$event,$network]);
    run('DELETE FROM admin_security_events WHERE id < COALESCE((SELECT id FROM admin_security_events ORDER BY id DESC LIMIT 1 OFFSET 9999),0)');
}
function admin_session_token(): string { return hash('sha256',$_SESSION['auth_token']??''); }
function admin_sign_in(): void {
    $state=admin_security_state();
    session_regenerate_id(true);
    $_SESSION=['admin'=>true,'last'=>time(),'started'=>time(),'credential'=>hash('sha256',config()['password_hash']),
      'csrf'=>bin2hex(random_bytes(32)),'auth_token'=>bin2hex(random_bytes(32)),'mfa_version'=>(int)$state['version']];
    run('INSERT INTO admin_sessions(token,created,last_seen,credential,version) VALUES(?,?,?,?,?)',
      [admin_session_token(),time(),time(),$_SESSION['credential'],(int)$state['version']]);
    admin_event('login_success');
}
function admin_session_registered(): bool {
    $state=admin_security_state();
    if(!isset($_SESSION['auth_token'],$_SESSION['mfa_version']) || (int)$_SESSION['mfa_version']!==(int)$state['version']) return false;
    $record=rows(run('SELECT * FROM admin_sessions WHERE token=?',[admin_session_token()]))[0]??null;
    if(!$record || $record['last_seen']<=time()-1800 || $record['created']<=time()-28800 ||
       !hash_equals($record['credential'],hash('sha256',config()['password_hash'])) || (int)$record['version']!==(int)$state['version']) return false;
    run('UPDATE admin_sessions SET last_seen=? WHERE token=?',[time(),admin_session_token()]);
    return true;
}
function admin_password_correct(string $password): bool {
    return strlen($password)<=72 && !str_contains($password,"\0") && password_verify($password,config()['password_hash']);
}
function admin_mfa_encrypt(string $secret): string {
    $iv=random_bytes(12);$tag='';
    $cipher=openssl_encrypt($secret,'aes-256-gcm',hash_hkdf('sha256',config()['secret'],32,'mwein-admin-mfa'),OPENSSL_RAW_DATA,$iv,$tag,'mwein-admin-v1');
    if($cipher===false) throw new RuntimeException('Cannot protect authenticator secret');
    return base64_encode($iv.$tag.$cipher);
}
function admin_mfa_decrypt(string $encrypted): string {
    $raw=base64_decode($encrypted,true);
    if($raw===false || strlen($raw)<29) throw new RuntimeException('Invalid authenticator secret');
    $secret=openssl_decrypt(substr($raw,28),'aes-256-gcm',hash_hkdf('sha256',config()['secret'],32,'mwein-admin-mfa'),OPENSSL_RAW_DATA,substr($raw,0,12),substr($raw,12,16),'mwein-admin-v1');
    if($secret===false) throw new RuntimeException('Cannot read authenticator secret');
    return $secret;
}
function admin_base32(string $bytes): string {
    $alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';$bits=0;$buffer=0;$out='';
    foreach(unpack('C*',$bytes) as $byte){$buffer=($buffer<<8)|$byte;$bits+=8;while($bits>=5){$bits-=5;$out.=$alphabet[($buffer>>$bits)&31];}$buffer&=(1<<$bits)-1;}
    if($bits)$out.=$alphabet[($buffer<<(5-$bits))&31];
    return $out;
}
// RFC 6238 / RFC 4226: SHA-1, six digits, 30-second steps; checked against RFC vectors.
function admin_totp(string $secret,int $counter,int $digits=6): string {
    $mac=hash_hmac('sha1',pack('N2',intdiv($counter,4294967296),$counter%4294967296),$secret,true);
    $offset=ord($mac[19])&15;$value=unpack('N',substr($mac,$offset,4))[1]&0x7fffffff;
    return str_pad((string)($value%(10**$digits)),$digits,'0',STR_PAD_LEFT);
}
function admin_totp_counter(string $secret,string $code,?int $now=null): ?int {
    if(!preg_match('/^[0-9]{6}$/D',$code)) return null;
    $current=intdiv($now??time(),30);
    foreach([$current,$current-1,$current+1] as $counter) if($counter>=0 && hash_equals(admin_totp($secret,$counter),$code)) return $counter;
    return null;
}
function admin_mfa_check(string $code): bool {
    $state=admin_security_state();
    if($state['secret']==='') return false;
    $counter=admin_totp_counter(admin_mfa_decrypt($state['secret']),trim($code));
    if($counter!==null){
        run('UPDATE admin_security SET last_counter=? WHERE id=1 AND version=? AND secret=? AND last_counter<?',[$counter,(int)$state['version'],$state['secret'],$counter]);
        return db()->changes()===1;
    }
    $normalized=strtoupper(str_replace(['-',' '],'',trim($code)));
    if(!preg_match('/^[A-F0-9]{20}$/D',$normalized)) return false;
    run('DELETE FROM admin_recovery WHERE hash=?',[hash_hmac('sha256',$normalized,config()['secret'])]);
    if(db()->changes()!==1) return false;
    admin_event('recovery_used');return true;
}
function admin_recovery_generate(): array {
    run('DELETE FROM admin_recovery');$codes=[];
    for($i=0;$i<10;$i++){
        $raw=strtoupper(bin2hex(random_bytes(10)));
        run('INSERT INTO admin_recovery(hash) VALUES(?)',[hash_hmac('sha256',$raw,config()['secret'])]);
        $codes[]=implode('-',str_split($raw,5));
    }return $codes;
}
function admin_mfa_enable(string $secret,string $code): array {
    $counter=admin_totp_counter($secret,$code);
    if($counter===null) throw new InvalidArgumentException('Enter the current six-digit code from your authenticator.');
    admin_security_tables();db()->exec('BEGIN IMMEDIATE');
    try {
        $state=admin_security_state();
        if($state['secret']!=='') throw new InvalidArgumentException('Two-step verification is already enabled.');
        run('UPDATE admin_security SET secret=?,last_counter=?,version=version+1 WHERE id=1',[admin_mfa_encrypt($secret),$counter]);
        $codes=admin_recovery_generate();run('DELETE FROM admin_sessions');admin_event('mfa_enabled');
        db()->exec('COMMIT');return $codes;
    }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
}
function admin_revoke_other_sessions(): void {
    run('DELETE FROM admin_sessions WHERE token<>?',[admin_session_token()]);
    admin_event('sessions_revoked');
}
