<?php
require __DIR__ . '/analytics.php';
require_post();
same_origin();
if(post('forget')==='yes'){
    analytics_cookie('mwein_visitor','',time()-3600);analytics_cookie('mwein_visit','',time()-3600);http_response_code(204);exit;
}
// Honour browser privacy preferences, ignore obvious automated traffic.
if (($_SERVER['HTTP_DNT'] ?? '') === '1' || ($_SERVER['HTTP_SEC_GPC'] ?? '') === '1' || preg_match('/bot|crawler|spider|headless/i', $_SERVER['HTTP_USER_AGENT'] ?? '')) { http_response_code(204); exit; }
require_once __DIR__.'/outcomes.php';
$path = post('path');
$allowed = ['/', '/index.html', '/services.html', '/insurers.html', '/blog.html', '/blog.php', '/partners.html', '/contact.html', '/privacy-policy.html'];
if (!in_array($path, $allowed, true) && public_source($path)==='') { http_response_code(400); exit; }
if (internal_browser()) { header('X-Mwein-Analytics: excluded'); http_response_code(204); exit; }
if (limited('views', 120, 3600)) { http_response_code(429); exit; }
if ($path === '/index.html') $path = '/';
if(post('identify_only')!=='yes')run('INSERT INTO views(day,path,count) VALUES (?,?,1) ON CONFLICT(day,path) DO UPDATE SET count=count+1', [date('Y-m-d'), $path]);
if(post('consent')==='yes')record_visitor();
http_response_code(204);
