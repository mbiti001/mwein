<?php
require dirname(__DIR__).'/api/care-totals.php';
require_admin();
$current=care_totals_current(); $error='';
$values=['patients'=>(string)$current['patients'],'encounters'=>(string)$current['encounters'],'recorded_on'=>$current['recorded_on'],'version'=>(string)$current['id'],'note'=>''];
if ($_SERVER['REQUEST_METHOD']==='POST') {
    require_post(); check_csrf();
    foreach(array_keys($values) as $key) $values[$key]=post($key);
    $date=preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D',$values['recorded_on']) ? DateTimeImmutable::createFromFormat('!Y-m-d',$values['recorded_on']) : false;
    $countsValid=true;
    foreach(['patients','encounters'] as $key) if(!preg_match('/^(0|[1-9][0-9]{0,9})$/D',$values[$key]) || (int)$values[$key]>1000000000) $countsValid=false;
    if(!$countsValid || !ctype_digit($values['version']) || (int)$values['version']<1) $error='Enter whole-number totals between 0 and 1,000,000,000.';
    elseif(!$date || $date->format('Y-m-d')!==$values['recorded_on'] || $values['recorded_on']<'1900-01-01' || $values['recorded_on']>date('Y-m-d')) $error='Choose a valid reporting date no later than today (Kenya time).';
    elseif(strlen($values['note'])<5 || strlen($values['note'])>500 || !preg_match('//u',$values['note'])) $error='Give a private source or correction note of 5–500 characters. Do not include patient details.';
    elseif(post('confirmed')!=='yes') $error='Confirm that these totals were checked against facility records.';
    if($error) http_response_code(422);
    else {
        db()->exec('BEGIN IMMEDIATE');
        try {
            $latest=care_totals_current();
            if((int)$latest['id']!==(int)$values['version']) {
                db()->exec('ROLLBACK'); http_response_code(409); $error='Another update was saved first. Reload this page and compare the latest totals before saving again.';
            } else {
                run('INSERT INTO care_totals_history(patients,encounters,recorded_on,created_at,note,actor) VALUES(?,?,?,?,?,?)',[(int)$values['patients'],(int)$values['encounters'],$values['recorded_on'],date('c'),$values['note'],config()['admin_email']]);
                db()->exec('COMMIT'); redirect('/manage/care-totals.php?saved=1');
            }
        } catch(Throwable $e) { db()->exec('ROLLBACK'); throw $e; }
    }
}
$count=(int)scalar(run('SELECT COUNT(*) FROM care_totals_history'));
$page=max(1,min((int)($_GET['page']??1),max(1,(int)ceil($count/20))));
$history=rows(run('SELECT * FROM care_totals_history ORDER BY id DESC LIMIT 20 OFFSET ?',[($page-1)*20]));
layout_start('Confirmed care totals');
?>
<link rel="stylesheet" href="/assets/feedback.css?v=20260927">
<p><a href="/manage/">← Dashboard</a></p><h1>Confirmed care totals</h1>
<p>Publish totals checked against facility records. Registrations count registered patients; encounters may include repeat visits. No daily estimates are added. Corrections may increase or decrease a total.</p>
<?php if(isset($_GET['saved'])): ?><p role="status">Confirmed totals saved and available on the public homepage.</p><?php endif ?>
<?php if($error): ?><p role="alert"><?= h($error) ?> <a href="/manage/care-totals.php">Reload latest totals</a></p><?php endif ?>
<form method="post" class="feedback-form">
<?= csrf() ?><input type="hidden" name="version" value="<?= h($values['version']) ?>">
<label>Patients registered<input type="number" name="patients" min="0" max="1000000000" step="1" required value="<?= h($values['patients']) ?>"></label>
<label>Encounters recorded<input type="number" name="encounters" min="0" max="1000000000" step="1" required value="<?= h($values['encounters']) ?>"></label>
<label>Records confirmed as of<input type="date" name="recorded_on" min="1900-01-01" max="<?= date('Y-m-d') ?>" required value="<?= h($values['recorded_on']) ?>"></label>
<label>Source or correction note (private)<textarea name="note" rows="3" minlength="5" maxlength="500" required><?= h($values['note']) ?></textarea></label>
<p class="feedback-privacy">Describe the source or reason for correction. Do not enter patient names, medical information or record identifiers. Only the totals and reporting date appear publicly.</p>
<label class="feedback-check"><input type="checkbox" name="confirmed" value="yes" required> I checked these totals against facility records and want to publish them.</label>
<button class="button" type="submit">Publish confirmed totals</button>
</form>
<h2>Correction history</h2><p>Previous values are retained. To correct a mistake, publish a new entry above. Times are recorded in Kenya time.</p>
<?php foreach($history as $entry): ?><article class="feedback-card"><h3>Revision <?= (int)$entry['id'] ?> · Records as of <?= h($entry['recorded_on']) ?></h3><p><?= number_format((int)$entry['patients']) ?> registered patients · <?= number_format((int)$entry['encounters']) ?> encounters</p><p><?= h($entry['note']) ?></p><p class="small">Saved <?= h($entry['created_at']) ?> · <?= h($entry['actor']) ?></p></article><?php endforeach ?>
<nav aria-label="History pages"><?php if($page>1): ?><a href="?page=<?= $page-1 ?>">Previous</a><?php endif ?><?php if($page*20<$count): ?> <a href="?page=<?= $page+1 ?>">Next</a><?php endif ?></nav>
<?php layout_end(); ?>
