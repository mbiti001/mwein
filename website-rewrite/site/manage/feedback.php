<?php
require dirname(__DIR__).'/api/feedback.php';require_admin();feedback_tables();$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
    require_post();check_csrf();$id=filter_var(post('id'),FILTER_VALIDATE_INT);$version=filter_var(post('version'),FILTER_VALIDATE_INT);$status=post('status');$note=post('note');
    if(!$id||!$version||!in_array($status,['pending','approved','hidden'],true)||strlen($note)<5||strlen($note)>300){http_response_code(422);$error='Choose a valid status and give a moderation reason of 5–300 characters.';}
    else{
      db()->exec('BEGIN IMMEDIATE');
      try{
        $item=rows(run('SELECT status,version FROM feedback WHERE id=?',[$id]))[0]??null;
        if(!$item||(int)$item['version']!==$version){db()->exec('ROLLBACK');http_response_code(409);$error='This submission changed. Reload and review its current status.';}
        else{run('UPDATE feedback SET status=?,version=version+1 WHERE id=?',[$status,$id]);run('INSERT INTO feedback_moderation(feedback_id,created_at,previous_status,next_status,note) VALUES(?,?,?,?,?)',[$id,date('c'),$item['status'],$status,$note]);db()->exec('COMMIT');redirect('/manage/feedback.php?saved=1');}
      }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
    }
}
$status=is_string($_GET['status']??null)?$_GET['status']:'pending';if(!in_array($status,['pending','approved','hidden'],true))$status='pending';
$count=(int)scalar(run('SELECT COUNT(*) FROM feedback WHERE status=?',[$status]));$page=max(1,(int)($_GET['page']??1));$page=min($page,max(1,(int)ceil($count/20)));
$items=rows(run('SELECT f.*,p.published AS post_published FROM feedback f LEFT JOIN posts p ON p.id=f.post_id WHERE f.status=? ORDER BY f.id DESC LIMIT 20 OFFSET ?',[$status,($page-1)*20]));
layout_start('Comments & reviews'); ?>
<link rel="stylesheet" href="/assets/feedback.css?v=20260927">
<p><a href="/manage/">← Dashboard</a></p><h1>Comments & reviews</h1>
<p>Publish genuine, relevant feedback regardless of its rating. Hide spam, abuse and private medical or contact details. Do not approve a submission containing personal health information. Hidden entries remain private for review; use the facility’s privacy process for removal requests.</p>
<p>Website reviews are self-reported, not verified patient visits. Published ratings alone contribute to the displayed average.</p>
<?php if(isset($_GET['saved'])): ?><p role="status">Moderation decision saved.</p><?php endif ?><?php if($error): ?><p role="alert"><?= h($error) ?></p><?php endif ?>
<nav class="section-tabs" aria-label="Moderation filters"><?php foreach(['pending','approved','hidden'] as $s): ?><a href="?status=<?= $s ?>" <?= $s===$status?'aria-current="page"':'' ?>><?= h(ucfirst($s)) ?></a><?php endforeach ?><a href="/reviews.php">Public reviews ↗</a></nav>
<p><?= $count ?> <?= h($status) ?> submissions · Page <?= $page ?></p>
<?php foreach($items as $item): ?><article class="feedback-card"><p class="eyebrow"><?= h($item['kind']) ?> · <?= h($item['status']) ?></p><h2><?= h($item['display_name']) ?></h2><p><?= h($item['created_at']) ?><?php if($item['kind']==='review'): ?> · <?= (int)$item['rating'] ?>/5 stars<?php endif ?></p><?php if($item['kind']==='comment'): ?><p>Post #<?= (int)$item['post_id'] ?> · <?= $item['post_published']?'Published post':'Post currently unavailable' ?></p><?php endif ?><p class="feedback-body"><?= nl2br(h($item['body'])) ?></p><p class="small">Reference <?= h($item['reference']) ?></p>
<form method="post" class="feedback-form"><?= csrf() ?><input type="hidden" name="id" value="<?= (int)$item['id'] ?>"><input type="hidden" name="version" value="<?= (int)$item['version'] ?>"><label>Status<select name="status"><?php foreach(['pending','approved','hidden'] as $s): ?><option value="<?= $s ?>" <?= $s===$item['status']?'selected':'' ?>><?= h(ucfirst($s)) ?></option><?php endforeach ?></select></label><label>Moderation reason (private)<input name="note" required minlength="5" maxlength="300" placeholder="For example: Relevant feedback; no private details"></label><button class="button" type="submit">Save decision</button></form>
<details><summary>Moderation history</summary><?php foreach(rows(run('SELECT * FROM feedback_moderation WHERE feedback_id=? ORDER BY id DESC',[(int)$item['id']])) as $event): ?><p><?= h($event['created_at'].' · '.$event['previous_status'].' → '.$event['next_status'].' · '.$event['note']) ?></p><?php endforeach ?></details></article><?php endforeach ?>
<?php if(!$items): ?><p>No submissions in this queue.</p><?php endif ?>
<nav class="pagination" aria-label="Moderation pages"><?php if($page>1): ?><a href="?status=<?= $status ?>&page=<?= $page-1 ?>">Previous</a><?php endif ?><?php if($page*20<$count): ?><a href="?status=<?= $status ?>&page=<?= $page+1 ?>">Next</a><?php endif ?></nav>
<?php layout_end(); ?>
