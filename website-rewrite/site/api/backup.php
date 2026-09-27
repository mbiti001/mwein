<?php
require_once __DIR__.'/common.php';
function backup_website(): array {
    $private=config()['data_dir'];
    $root=$private.'/backups';
    if (!is_dir($root) && !mkdir($root,0700,true)) throw new RuntimeException('Cannot create backup directory');
    $lock=fopen($private.'/setup.lock','c');
    if (!$lock || !flock($lock,LOCK_EX)) throw new RuntimeException('Cannot lock backup');
    try {
        $name=date('Ymd-His').'-'.bin2hex(random_bytes(4));
        $dir=$root.'/'.$name;
        if (!mkdir($dir,0700)) throw new RuntimeException('Cannot create snapshot');
        $snapshot=new SQLite3($dir.'/website.sqlite');
        if (!db()->backup($snapshot)) throw new RuntimeException('SQLite snapshot failed');
        if ($snapshot->querySingle('PRAGMA integrity_check')!=='ok') throw new RuntimeException('Snapshot integrity failed');
        // Restore into an independent database; never overwrite production.
        $restored=new SQLite3(':memory:');
        if (!$snapshot->backup($restored) || $restored->querySingle('PRAGMA integrity_check')!=='ok') throw new RuntimeException('Restore check failed');
        $counts=[];
        foreach (['messages','activity','views'] as $table) {
            $count=(int)$snapshot->querySingle('SELECT COUNT(*) FROM '.$table);
            if ($count!==(int)$restored->querySingle('SELECT COUNT(*) FROM '.$table)) throw new RuntimeException('Restored count mismatch');
            $counts[$table]=$count;
        }
        // Include every media file referenced by the snapshot; image names are immutable.
        $mediaFiles=[];
        if ($snapshot->querySingle("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='media'")) {
            mkdir($dir.'/media',0700);
            $result=$snapshot->query('SELECT file FROM media');
            while($row=$result->fetchArray(SQLITE3_ASSOC)) {
                $filename=$row['file'];
                if(!preg_match('/^[a-f0-9]{48}\\.jpg$/D',$filename) || !copy($private.'/media/'.$filename,$dir.'/media/'.$filename)) throw new RuntimeException('Media backup failed');
                $mediaFiles[$filename]=hash_file('sha256',$dir.'/media/'.$filename);
            }
        }
        $restored->close();$snapshot->close();
        $configPath=getenv('MWEIN_WEB_CONFIG') ?: dirname(__DIR__,2).'/mwein-website-private/config.php';
        if (!copy($configPath,$dir.'/config.php')) throw new RuntimeException('Configuration backup failed');
        $check=require $dir.'/config.php';
        if (!is_array($check) || empty($check['password_hash']) || empty($check['secret'])) throw new RuntimeException('Configuration verification failed');
        $report=['snapshot'=>$name,'created_at'=>date('c'),'restore_check'=>'passed','counts'=>$counts,'database_sha256'=>hash_file('sha256',$dir.'/website.sqlite'),'config_sha256'=>hash_file('sha256',$dir.'/config.php'),'media_sha256'=>$mediaFiles,'php'=>PHP_VERSION];
        if (file_put_contents($dir.'/manifest.json',json_encode($report,JSON_PRETTY_PRINT))===false) throw new RuntimeException('Manifest write failed');
        $temp=tempnam($private,'backup-status-');
        if(file_put_contents($temp,json_encode($report))===false || !rename($temp,$private.'/backup-status.json')) throw new RuntimeException('Backup status failed');
        return $report;
    } finally {flock($lock,LOCK_UN);fclose($lock);}
}
