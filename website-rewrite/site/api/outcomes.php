<?php
require_once __DIR__.'/common.php';
function public_source(string $value): string {
    if(in_array($value,['/','/index.html','/services.html','/insurers.html','/blog.html','/blog.php','/partners.html','/contact.html','/privacy-policy.html'],true))return $value==='/index.html'?'/':$value;
    if(preg_match('/^post:([1-9][0-9]{0,8})$/D',$value,$m)){
        if(!scalar(run("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='posts'")))return '';
        if(scalar(run("SELECT id FROM posts WHERE id=? AND published IS NOT NULL AND published!=''",[(int)$m[1]])))return 'post:'.(int)$m[1];
    }return '';
}
function record_enquiry_source(string $source): void {
    db()->exec('CREATE TABLE IF NOT EXISTS enquiry_sources(day TEXT NOT NULL,source TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,source))');
    $source=public_source($source)?:'Unknown';
    run('INSERT INTO enquiry_sources(day,source,count) VALUES(?,?,1) ON CONFLICT(day,source) DO UPDATE SET count=count+1',[date('Y-m-d'),$source]);
}
