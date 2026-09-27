<?php
require dirname(__DIR__) . '/api/analytics.php';
require_admin(); analytics_tables();
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post(); check_csrf();
    $id = filter_var(post('id'), FILTER_VALIDATE_INT);
    if (!$id || !in_array(post('status'), ['new', 'in progress', 'closed', 'spam'], true)) { http_response_code(422); exit('Invalid update'); }
    if(!scalar(run('SELECT id FROM messages WHERE id=?',[$id]))){http_response_code(404);exit('Message not found');}
    run('UPDATE messages SET status=? WHERE id=?', [post('status'), $id]);
    run('INSERT INTO activity(message_id,created_at,kind,body) VALUES(?,?,?,?)',[$id,date('c'),'status','Status changed to '.post('status')]);
    redirect('/manage/?saved=1');
}
$status = is_string($_GET['status'] ?? null) ? $_GET['status'] : '';
if (!in_array($status, ['', 'new', 'in progress', 'closed', 'spam'], true)) $status = '';
$page = max(1, min(100000, (int)($_GET['page'] ?? 1)));
$search=is_string($_GET['q']??null)?substr(trim($_GET['q']),0,120):'';
$where=' WHERE 1=1';$params=[];
if($status){$where.=' AND status=?';$params[]=$status;}
if($search!==''){$where.=' AND (instr(lower(name),lower(?))>0 OR instr(lower(contact),lower(?))>0 OR instr(lower(reference),lower(?))>0 OR instr(lower(message),lower(?))>0)';array_push($params,$search,$search,$search,$search);}
$countQuery = run('SELECT COUNT(*) FROM messages' . $where, $params);
$total = (int)scalar($countQuery);
$page = min($page, max(1, (int)ceil($total/20)));
$q = run('SELECT * FROM messages' . $where . ' ORDER BY id DESC LIMIT 20 OFFSET ' . (($page-1)*20), $params); $messages = rows($q);
$new = scalar(run("SELECT COUNT(*) FROM messages WHERE status='new'"));
$days = in_array((int)($_GET['days'] ?? 30), [7,30,90], true) ? (int)($_GET['days'] ?? 30) : 30;
$since = date('Y-m-d', strtotime('-' . ($days-1) . ' days'));
$q = run('SELECT day,SUM(count) AS total FROM views WHERE day>=? GROUP BY day ORDER BY day', [$since]);
$daily = array_column(rows($q), 'total', 'day');
$q = run('SELECT path,SUM(count) AS total FROM views WHERE day>=? GROUP BY path ORDER BY total DESC', [$since]); $paths = rows($q);
$maximum = max([1, ...array_values($daily)]);
$uniqueToday=(int)scalar(run('SELECT COUNT(DISTINCT visitor) FROM analytics_sessions WHERE last_seen>=?',[strtotime(date('Y-m-d'))]));
$uniquePeriod=(int)scalar(run('SELECT COUNT(DISTINCT visitor) FROM analytics_sessions WHERE last_seen>=?',[strtotime($since)]));
layout_start('Website dashboard');
?>
<div class="admin-title"><div><p class="eyebrow">MWEIN WEBSITE</p><h1>Your front desk,<br><em>online.</em></h1></div><form method="post" action="/manage/logout.php"><?= csrf() ?><button class="button secondary">Sign out</button></form></div>
<?php if (isset($_GET['saved'])): ?><p class="notice" role="status">Message status updated.</p><?php endif ?>
<nav class="section-tabs"><a href="#inbox">Messages · <?= (int)$new ?> new</a><a href="#activity">Website activity</a><a href="/manage/settings.php">Account security</a><a href="/manage/posts.php">Blog & media</a><a href="/manage/feedback.php">Comments & reviews</a><a href="/manage/analytics.php">Visitor analytics</a><a href="/manage/maintenance.php">Backups & alerts</a></nav>
<section class="stats-grid" aria-label="Summary"><article><span>New messages</span><strong><?= (int)$new ?></strong><small>Awaiting your review</small></article><article><span>Unique visitors today</span><strong><?= $uniqueToday ?></strong><small>Consenting browsers · Africa/Nairobi</small></article><article><span>Unique visitors · <?= $days ?> days</span><strong><?= $uniquePeriod ?></strong><small>Each consenting browser counted once</small></article></section>
<section id="inbox" class="admin-section"><div class="section-head"><div><p class="eyebrow">YOUR INBOX</p><h2>Requests & messages</h2></div><form method="get" class="filter"><label>Search<input name="q" value="<?= h($search) ?>" maxlength="120" placeholder="Name, contact or reference"></label><label>Status<select name="status"><option value="">All messages</option><?php foreach (['new','in progress','closed','spam'] as $s): ?><option value="<?= h($s) ?>" <?= $status===$s?'selected':'' ?>><?= h(ucfirst($s)) ?></option><?php endforeach ?></select></label><button class="button secondary">Filter</button></form></div>
<p class="small">Open a conversation to reply by email, record notes or manage its status.</p>
<?php if (!$messages): ?><div class="empty"><h3>No messages here yet</h3><p>Requests submitted through the website will appear here.</p></div><?php endif ?>
<?php foreach ($messages as $m): ?><details class="message"><summary><span class="badge"><?= h(ucfirst($m['status'])) ?></span><span><strong><?= h($m['name']) ?></strong><small><?= h($m['category']) ?> · <?= h(date('j M Y, H:i', strtotime($m['created_at']))) ?></small></span><span>View message ↓</span></summary><div class="message-body"><p><a class="button" href="/manage/message.php?id=<?= (int)$m['id'] ?>">Open conversation & reply →</a></p><p><strong>Reply to:</strong> <?= h($m['contact']) ?></p><p class="message-text"><?= h($m['message']) ?></p><p class="small">Reference <?= h($m['reference']) ?></p><form method="post" class="filter"><?= csrf() ?><input type="hidden" name="id" value="<?= (int)$m['id'] ?>"><label>Status<select name="status"><?php foreach (['new','in progress','closed','spam'] as $s): ?><option <?= $m['status']===$s?'selected':'' ?> value="<?= h($s) ?>"><?= h(ucfirst($s)) ?></option><?php endforeach ?></select></label><button class="button">Save status</button></form></div></details><?php endforeach ?>
<div class="pagination"><span><?= $total ?> <?= $total===1?'message':'messages' ?> · Page <?= $page ?> of <?= max(1,(int)ceil($total/20)) ?></span><?php if($page>1): ?><a href="?status=<?= urlencode($status) ?>&q=<?= urlencode($search) ?>&page=<?= $page-1 ?>#inbox">Previous</a><?php endif ?><?php if($page*20<$total): ?><a href="?status=<?= urlencode($status) ?>&q=<?= urlencode($search) ?>&page=<?= $page+1 ?>#inbox">Next →</a><?php endif ?></div></section>
<section id="activity" class="admin-section"><div class="section-head"><div><p class="eyebrow">WEBSITE ACTIVITY</p><h2>A clearer view of your reach.</h2></div><form method="get" class="filter"><label>Period<select name="days"><?php foreach([7,30,90] as $d): ?><option value="<?= $d ?>" <?= $d===$days?'selected':'' ?>>Last <?= $d ?> days</option><?php endforeach ?></select></label><button class="button secondary">Apply</button></form></div><p>The headline counts above are unique consenting browsers. This browser is excluded from statistics after admin sign-in, including after sign-out. The page views below are secondary counts of page loads, including repeats. Privacy settings, ad blockers and filtered bots can affect the totals.</p><div class="activity-grid"><div><h3>Daily page views</h3><div class="chart" role="img" aria-label="Daily page views; exact counts are in the table below"><?php for($i=0;$i<$days;$i++): $day=date('Y-m-d',strtotime($since . " +$i days")); ?><div title="<?= h($day) ?>: <?= (int)($daily[$day]??0) ?>"><meter min="0" max="<?= (int)$maximum ?>" value="<?= (int)($daily[$day]??0) ?>"><?= (int)($daily[$day]??0) ?></meter></div><?php endfor ?></div><div class="chart-range"><span><?= h(date('j M',strtotime($since))) ?></span><span><?= h(date('j M')) ?></span></div><details><summary>View daily counts</summary><table><thead><tr><th>Date</th><th>Views</th></tr></thead><tbody><?php for($i=$days-1;$i>=0;$i--): $day=date('Y-m-d',strtotime($since . " +$i days")); ?><tr><td><?= h($day) ?></td><td><?= (int)($daily[$day]??0) ?></td></tr><?php endfor ?></tbody></table></details></div><div><h3>Most viewed pages</h3><table><thead><tr><th>Page</th><th>Views</th></tr></thead><tbody><?php foreach($paths as $p): ?><tr><td><?= h($p['path']==='/'?'Home':ucfirst(str_replace(['/', '.html'], '', $p['path']))) ?></td><td><?= (int)$p['total'] ?></td></tr><?php endforeach ?><?php if(!$paths): ?><tr><td colspan="2">No page views recorded yet.</td></tr><?php endif ?></tbody></table></div></div></section>
<?php layout_end(); ?>
