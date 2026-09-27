<?php
require dirname(__DIR__).'/api/analytics.php';require_admin();analytics_tables();
if($_SERVER['REQUEST_METHOD']==='POST'){
    require_post();check_csrf();
    if(post('action')!=='archive'){http_response_code(422);exit('Unknown action');}
    if(limited('analytics-archive',1,3600,'website-admin')){http_response_code(429);exit('A new period was requested recently. Please wait one hour.');}
    archive_analytics();redirect('/manage/analytics.php?archived=1');
}
$periodStarted=(int)(scalar(run("SELECT value FROM analytics_meta WHERE key='period_started'"))??0);
$days=in_array((int)($_GET['days']??30),[7,30,90],true)?(int)($_GET['days']??30):30;
$since=strtotime(date('Y-m-d',strtotime('-'.($days-1).' days')));
$unique=(int)scalar(run('SELECT COUNT(DISTINCT visitor) FROM analytics_sessions WHERE last_seen>=?',[$since]));
$new=(int)scalar(run('SELECT COUNT(DISTINCT s.visitor) FROM analytics_sessions s JOIN analytics_visitors v ON v.visitor=s.visitor WHERE s.last_seen>=? AND v.first_seen>=?',[$since,$since]));
$total=(int)scalar(run('SELECT COUNT(*) FROM analytics_sessions WHERE started>=?',[$since]));
$repeat=(int)scalar(run('SELECT COUNT(*) FROM (SELECT visitor FROM analytics_sessions WHERE started>=? GROUP BY visitor HAVING COUNT(*)>1)',[$since]));
layout_start('Visitor analytics'); ?>
<p><a href="/manage/#activity">← Dashboard</a></p><h1>Visitor analytics</h1>
<p class="notice">This browser is excluded from visitor and page-view statistics for one year after its latest admin use, including after sign-out. Sign in once on every browser used for development or staff checks. Clearing cookies or using private browsing removes this exclusion.</p>
<?php if($periodStarted): ?><p>Current reporting period started <?= h(date('j M Y, H:i:s',$periodStarted)) ?> (Africa/Nairobi). Earlier totals are in the private archive below.</p><?php endif ?>
<?php if(isset($_GET['archived'])): ?><p role="status" class="notice">Previous totals archived. A new counting period has started. Messages, blog posts and saved enquiries were kept.</p><?php endif ?>
<form method="get" class="filter"><label>Period<select name="days"><?php foreach([7,30,90] as $n): ?><option value="<?= $n ?>" <?= $n===$days?'selected':'' ?>>Last <?= $n ?> days</option><?php endforeach ?></select></label><button class="button">Update</button></form>
<div class="stats-grid"><article><span>Unique visitors</span><strong><?= $unique ?></strong></article><article><span>New unique visitors</span><strong><?= $new ?></strong></article><article><span>Previously seen visitors</span><strong><?= $unique-$new ?></strong></article><article><span>Sessions started</span><strong><?= $total ?></strong></article><article><span>Browsers with repeat sessions</span><strong><?= $repeat ?></strong></article></div>
<p>These figures cover visitors who allowed analytics in the current reporting period. Admin/development browsers and recognised automated traffic are excluded. Unique means a recognised browser, not a verified person. New means first recognised within this period; previously seen means first recognised before it. Repeat-session browsers can also be new. Sessions end after 30 minutes of inactivity. Clearing cookies, using another device or declining analytics changes these counts. Page-view totals include anonymous views and are shown separately.</p>
<?php foreach(['country'=>'Approximate country / region','source'=>'Traffic source','device'=>'Device type','browser'=>'Browser'] as $field=>$title): $items=rows(run("SELECT $field AS label,COUNT(*) AS sessions,COUNT(DISTINCT visitor) AS visitors FROM analytics_sessions WHERE started>=? GROUP BY $field ORDER BY sessions DESC LIMIT 30",[$since])); ?>
<section class="admin-section"><h2><?= h($title) ?></h2><table><thead><tr><th><?= h($title) ?></th><th>Sessions started</th><th>Unique browsers</th></tr></thead><tbody><?php foreach($items as $item): ?><tr><td><?= h($item['label']) ?></td><td><?= (int)$item['sessions'] ?></td><td><?= (int)$item['visitors'] ?></td></tr><?php endforeach ?><?php if(!$items): ?><tr><td colspan="3">No consented visitor data yet.</td></tr><?php endif ?></tbody></table></section>
<?php endforeach ?>
<p>Regions are country-level estimates (ISO country codes) from the network address, not GPS or a confirmed residence. VPNs and mobile networks can be inaccurate; unavailable results are Unknown. No visitor IP address is saved or sent to a geolocation provider. <a href="https://db-ip.com">IP Geolocation by DB-IP</a>, September 2026 Lite database, CC BY 4.0. Visitor and session records expire after 90 days of inactivity; historic page-count totals remain.</p>
<?php
$sinceDay=date('Y-m-d',$since);$counts=rows(run('SELECT path,SUM(count) AS total FROM views WHERE day>=? GROUP BY path ORDER BY total DESC',[$sinceDay]));$enquiries=[];
if(scalar(run("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='enquiry_sources'")))foreach(rows(run('SELECT source,SUM(count) AS total FROM enquiry_sources WHERE day>=? GROUP BY source',[$sinceDay])) as $r)$enquiries[$r['source']]=$r['total'];
$labels=[];if(scalar(run("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='posts'")))foreach(rows(run("SELECT id,published FROM posts WHERE published IS NOT NULL AND published!=''")) as $r)$labels['post:'.$r['id']]=json_decode($r['published'],true)['title'];
$combined=[];foreach($counts as $r)$combined[$r['path']]=(int)$r['total'];foreach($enquiries as $key=>$n)if(!isset($combined[$key]))$combined[$key]=0;
?>
<section class="admin-section"><h2>Pages, articles and enquiries</h2><p>Views include repeat loads and anonymous visits. Enquiries count saved website forms attributed to the page or article that linked to the form. These are aggregate counts, not a tracked visitor journey or conversion rate. Direct forms and older traffic may have an unknown source. Email and WhatsApp conversations are not counted here.</p><table><thead><tr><th>Page / article</th><th>Views</th><th>Saved enquiries</th></tr></thead><tbody><?php foreach($combined as $key=>$n): ?><tr><td><?= h($labels[$key]??($key==='/'?'Home':$key)) ?></td><td><?= $n ?></td><td><?= (int)($enquiries[$key]??0) ?></td></tr><?php endforeach ?></tbody></table></section>
<section class="admin-section"><h2>Previous counting periods</h2><p>Archived totals may include development traffic. Unique browsers are estimates, not verified people. These periods are excluded from current reports.</p>
<?php foreach(rows(run('SELECT * FROM analytics_archives ORDER BY id DESC')) as $archive): $a=json_decode($archive['summary'],true); ?>
<details class="contact-card"><summary>Archived <?= h(date('j M Y, H:i:s',strtotime($archive['created_at']))) ?> · <?= (int)$a['page_views'] ?> page views · <?= (int)$a['unique'] ?> unique browsers</summary><p><?= (int)$a['sessions'] ?> sessions. Recovery snapshot: <?= h($archive['backup']) ?>.</p><table><thead><tr><th>Date</th><th>Page</th><th>Views</th></tr></thead><tbody><?php foreach($a['pages'] as $r): ?><tr><td><?= h($r['day']) ?></td><td><?= h($r['path']) ?></td><td><?= (int)$r['count'] ?></td></tr><?php endforeach ?></tbody></table>
<?php foreach($a['breakdowns'] as $field=>$items): ?><h3><?= h(ucfirst($field)) ?></h3><table><thead><tr><th>Group</th><th>Sessions</th><th>Unique browsers</th></tr></thead><tbody><?php foreach($items as $r): ?><tr><td><?= h($r['label']) ?></td><td><?= (int)$r['sessions'] ?></td><td><?= (int)$r['visitors'] ?></td></tr><?php endforeach ?></tbody></table><?php endforeach ?></details>
<?php endforeach ?>
<details><summary>Start another counting period</summary><p>This archives current traffic totals and starts the live counters from zero. It first creates a verified private backup. Enquiries, messages, blog content and previous archives are kept.</p><form method="post"><?= csrf() ?><input type="hidden" name="action" value="archive"><button class="button secondary">Archive totals and start a new period</button></form></details></section>
<?php layout_end(); ?>
