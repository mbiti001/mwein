<?php
require_once __DIR__.'/common.php';
function analytics_tables(): void {
    db()->exec("CREATE TABLE IF NOT EXISTS analytics_visitors (visitor TEXT PRIMARY KEY,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_sessions (session TEXT PRIMARY KEY,visitor TEXT NOT NULL,started INTEGER NOT NULL,last_seen INTEGER NOT NULL,views INTEGER NOT NULL,country TEXT NOT NULL,source TEXT NOT NULL,device TEXT NOT NULL,browser TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS analytics_session_date ON analytics_sessions(started);
    CREATE INDEX IF NOT EXISTS analytics_session_visitor ON analytics_sessions(visitor);
    CREATE TABLE IF NOT EXISTS analytics_daily_visitors (day TEXT NOT NULL,visitor TEXT NOT NULL,is_new INTEGER NOT NULL,PRIMARY KEY(day,visitor));
    CREATE TABLE IF NOT EXISTS analytics_events (event TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS analytics_event_date ON analytics_events(created);
    CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_archives(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,summary TEXT NOT NULL,backup TEXT NOT NULL);");
    run("INSERT OR IGNORE INTO analytics_meta(key,value) VALUES('daily_started',?)",[(string)time()]);
}
function archive_analytics(): void {
    require_once __DIR__.'/backup.php';
    analytics_tables();
    // Back up original records before changing live counters; keep a readable aggregate archive too.
    $backup = backup_website();
    db()->exec('BEGIN IMMEDIATE');
    try {
        $summary=['page_views'=>(int)scalar(run('SELECT COALESCE(SUM(count),0) FROM views')),
            'unique'=>(int)scalar(run('SELECT COUNT(DISTINCT visitor) FROM analytics_sessions')),
            'sessions'=>(int)scalar(run('SELECT COUNT(*) FROM analytics_sessions')),
            'pages'=>rows(run('SELECT day,path,count FROM views ORDER BY day,path')),'daily'=>daily_analytics(90),'breakdowns'=>[]];
        foreach(['country','source','device','browser'] as $field)$summary['breakdowns'][$field]=rows(run("SELECT $field AS label,COUNT(*) AS sessions,COUNT(DISTINCT visitor) AS visitors FROM analytics_sessions GROUP BY $field ORDER BY sessions DESC"));
        run('INSERT INTO analytics_archives(created_at,summary,backup) VALUES(?,?,?)',[date('c'),json_encode($summary,JSON_THROW_ON_ERROR),$backup['snapshot']]);
        db()->exec('DELETE FROM views; DELETE FROM analytics_sessions; DELETE FROM analytics_visitors; DELETE FROM analytics_daily_visitors;');
        run("INSERT INTO analytics_meta(key,value) VALUES('period_started',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[(string)time()]);
        run("UPDATE analytics_meta SET value=? WHERE key='daily_started'",[(string)time()]);
        db()->exec('COMMIT');
    } catch(Throwable $e) {db()->exec('ROLLBACK');throw $e;}
}
function country_for_ip(string $ip): string {
    $packed=@inet_pton($ip); if($packed===false)return 'Unknown';
    $width=strlen($packed);$file=config()['data_dir'].'/geo/country-v'.($width===4?'4':'6').'.bin';
    if(!is_file($file))return 'Unknown';
    $f=fopen($file,'rb');if(!$f)return 'Unknown';
    try {$size=$width*2+2;$low=0;$high=intdiv(filesize($file),$size)-1;
        while($low<=$high){$mid=intdiv($low+$high,2);fseek($f,$mid*$size);$row=fread($f,$size);if(strlen($row)!==$size)return 'Unknown';
            if(strcmp($packed,substr($row,0,$width))<0)$high=$mid-1;
            elseif(strcmp($packed,substr($row,$width,$width))>0)$low=$mid+1;
            else {$country=substr($row,-2);return preg_match('/^[A-Z]{2}$/D',$country)?$country:'Unknown';}
        }return 'Unknown';
    }finally{fclose($f);}
}
function analytics_cookie(string $name,string $value,int $expires): void {
    setcookie($name,$value,['expires'=>$expires,'path'=>'/','secure'=>parse_url(config()['origin'],PHP_URL_SCHEME)==='https','httponly'=>true,'samesite'=>'Lax']);
}
function record_visitor(): void {
    analytics_tables();$now=time();$cutoff=$now-90*86400;
    run('DELETE FROM analytics_sessions WHERE last_seen<?',[$cutoff]);
    run('DELETE FROM analytics_visitors WHERE last_seen<?',[$cutoff]);
    $raw=$_COOKIE['mwein_visitor']??'';
    if(!is_string($raw)||!preg_match('/^[a-f0-9]{64}$/D',$raw))$raw=bin2hex(random_bytes(32));
    $visitor=hash_hmac('sha256',$raw,config()['secret']);
    analytics_cookie('mwein_visitor',$raw,$now+90*86400);
    run('INSERT INTO analytics_visitors(visitor,first_seen,last_seen) VALUES(?,?,?) ON CONFLICT(visitor) DO UPDATE SET last_seen=excluded.last_seen',[$visitor,$now,$now]);
    $rawSession=$_COOKIE['mwein_visit']??'';
    $session=is_string($rawSession)&&preg_match('/^[a-f0-9]{64}$/D',$rawSession)?hash_hmac('sha256',$rawSession,config()['secret']):'';
    $existing=rows(run('SELECT session FROM analytics_sessions WHERE session=? AND visitor=? AND last_seen>?',[$session,$visitor,$now-1800]));
    if($existing){run('UPDATE analytics_sessions SET views=views+1,last_seen=? WHERE session=?',[$now,$session]);}
    else {
        $rawSession=bin2hex(random_bytes(32));$session=hash_hmac('sha256',$rawSession,config()['secret']);
        $source=strtolower((string)parse_url(post('referrer'),PHP_URL_HOST));
        $own=parse_url(config()['origin'],PHP_URL_HOST);
        if(!$source||$source===$own||!preg_match('/^[a-z0-9.-]{1,253}$/D',$source))$source='Direct / unknown';
        $ua=$_SERVER['HTTP_USER_AGENT']??'';
        $device=preg_match('/ipad|tablet/i',$ua)?'Tablet':(preg_match('/mobile|android|iphone/i',$ua)?'Mobile':'Desktop / other');
        $browser=preg_match('/Edg\//',$ua)?'Edge':(preg_match('/Firefox\//',$ua)?'Firefox':(preg_match('/Chrome\//',$ua)?'Chrome':(preg_match('/Safari\//',$ua)?'Safari':'Other')));
        run('INSERT INTO analytics_sessions(session,visitor,started,last_seen,views,country,source,device,browser) VALUES(?,?,?,?,1,?,?,?,?)',[$session,$visitor,$now,$now,country_for_ip($_SERVER['REMOTE_ADDR']??''),$source,$device,$browser]);
    }
    $firstSeen=(int)scalar(run('SELECT first_seen FROM analytics_visitors WHERE visitor=?',[$visitor]));
    record_daily_visitor($visitor,$firstSeen,$now);
    analytics_cookie('mwein_visit',$rawSession,$now+1800);
}

// Daily membership is separate from session start/end, so visits across midnight
// count once on each active day even when they belong to a single session.
function record_daily_visitor(string $visitor,int $firstSeen,int $now): void {
    $day=date('Y-m-d',$now);
    run('INSERT OR IGNORE INTO analytics_daily_visitors(day,visitor,is_new) VALUES(?,?,?)',[$day,$visitor,date('Y-m-d',$firstSeen)===$day?1:0]);
    run('DELETE FROM analytics_daily_visitors WHERE day<?',[date('Y-m-d',strtotime('-89 days',$now))]);
}
function daily_analytics(int $days,?int $now=null): array {
    $now??=time();$days=max(1,min(90,$days));
    $today=date('Y-m-d',$now);$since=date('Y-m-d',strtotime('-'.($days-1).' days',$now));
    $started=(int)scalar(run("SELECT value FROM analytics_meta WHERE key='daily_started'"));
    $views=array_column(rows(run('SELECT day,SUM(count) AS total FROM views WHERE day>=? AND day<=? GROUP BY day',[$since,$today])),'total','day');
    $visitors=[];foreach(rows(run('SELECT day,COUNT(*) AS visitors,SUM(is_new) AS new_visitors FROM analytics_daily_visitors WHERE day>=? AND day<=? GROUP BY day',[$since,$today])) as $row)$visitors[$row['day']]=$row;
    // Kenya uses UTC+3; timestamps are Unix UTC seconds.
    $sessions=array_column(rows(run("SELECT date(started,'unixepoch','+3 hours') AS day,COUNT(*) AS total FROM analytics_sessions WHERE started>=? AND started<=? GROUP BY day",[strtotime($since),$now])),'total','day');
    $enquiries=[];
    if(scalar(run("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='enquiry_sources'")))$enquiries=array_column(rows(run('SELECT day,SUM(count) AS total FROM enquiry_sources WHERE day>=? AND day<=? GROUP BY day',[$since,$today])),'total','day');
    $result=[];
    for($i=0;$i<$days;$i++){
        $day=date('Y-m-d',strtotime('-'.$i.' days',$now));
        $available=$started>0 && $day>=date('Y-m-d',$started);
        $result[]=['day'=>$day,'views'=>(int)($views[$day]??0),'visitors'=>$available?(int)($visitors[$day]['visitors']??0):null,'new_visitors'=>$available?(int)($visitors[$day]['new_visitors']??0):null,'sessions'=>(int)($sessions[$day]??0),'enquiries'=>(int)($enquiries[$day]??0)];
    }
    return $result;
}
