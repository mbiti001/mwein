<?php
require dirname(__DIR__).'/api/careers.php';require_admin();careers_tables();
$id=max(0,(int)($_GET['id']??0));$v=$id?(rows(run('SELECT * FROM vacancies WHERE id=?',[$id]))[0]??null):['title'=>'','location'=>'Mungatsi, Busia County','description'=>'','qualifications'=>'','instructions'=>'','deadline'=>'','version'=>0,'published'=>null];
if(!$v){http_response_code(404);exit('Vacancy not found');}$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 require_post();check_csrf();
 try {
  $action=post('action');if(!in_array($action,['draft','publish','close'],true)||($action==='close'&&!$id))throw new InvalidArgumentException('Choose a valid action.');
  $data=[];foreach(['title'=>180,'location'=>180,'description'=>6000,'qualifications'=>4000,'instructions'=>3000,'deadline'=>10] as $field=>$max){$data[$field]=post($field);if(strlen($data[$field])>$max||!preg_match('//u',$data[$field]))throw new InvalidArgumentException('Check the length of '.$field.'.');}
  if($action!=='close'){
   if(strlen($data['title'])<3)throw new InvalidArgumentException('Enter a title of at least 3 characters.');
   if($data['deadline']!==''&&(!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$data['deadline'])||date('Y-m-d',strtotime($data['deadline']))!==$data['deadline']))throw new InvalidArgumentException('Enter a valid closing date.');
   if($action==='publish'){foreach($data as $value)if(trim($value)==='')throw new InvalidArgumentException('Complete every field before publishing.');if(!vacancy_open($data))throw new InvalidArgumentException('Choose today or a future closing date.');}
  }
  db()->exec('BEGIN IMMEDIATE');
  try {
   $current=$id?(rows(run('SELECT * FROM vacancies WHERE id=?',[$id]))[0]??null):null;
   if($id&&(!$current||(int)post('version')!==(int)$current['version']))throw new InvalidArgumentException('This vacancy changed in another tab. Copy your edits, then reload.');
   if($action==='close'){run('UPDATE vacancies SET published=NULL,version=version+1,updated_at=? WHERE id=?',[date('c'),$id]);}
   else {
    $published=$action==='publish'?json_encode($data,JSON_THROW_ON_ERROR):($current['published']??null);
    $values=[...array_values($data),$published,date('c')];
    if($id)run('UPDATE vacancies SET title=?,location=?,description=?,qualifications=?,instructions=?,deadline=?,published=?,updated_at=?,version=version+1 WHERE id=?',[...$values,$id]);
    else {run('INSERT INTO vacancies(title,location,description,qualifications,instructions,deadline,published,updated_at) VALUES(?,?,?,?,?,?,?,?)',$values);$id=(int)db()->lastInsertRowID();}
   }
   db()->exec('COMMIT');
  }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
  redirect('/manage/careers.php?id='.$id.'&saved=1');
 }catch(InvalidArgumentException $e){http_response_code(422);$error=$e->getMessage();$v=array_merge($v,$data??[]);}
}
layout_start('Careers management'); ?>
<p><a href="/manage/">← Dashboard</a></p><h1>Careers management</h1><nav class="section-tabs"><a href="/manage/careers.php">New vacancy</a><a href="/careers.php">View public Careers page</a></nav>
<p>Save a draft, review its preview, then publish. Draft edits do not change the published version. Vacancies close automatically after 23:59 on their closing date in Kenya time. You can close one early without deleting its record.</p>
<?php if($error): ?><p role="alert" class="error"><?= h($error) ?></p><?php elseif(isset($_GET['saved'])): ?><p role="status" class="notice">Vacancy saved.</p><?php endif ?>
<form method="post" class="contact-card"><?= csrf() ?><input type="hidden" name="version" value="<?= (int)$v['version'] ?>">
<?php foreach(['title'=>'Job title','location'=>'Location','description'=>'About the role','qualifications'=>'Qualifications and experience','instructions'=>'Application instructions','deadline'=>'Closing date (Kenya time)'] as $field=>$label): ?><label><?= h($label) ?><?php if(in_array($field,['description','qualifications','instructions'],true)): ?><textarea name="<?= $field ?>" rows="5" maxlength="<?= ['description'=>6000,'qualifications'=>4000,'instructions'=>3000][$field] ?>"><?= h($v[$field]) ?></textarea><?php else: ?><input name="<?= $field ?>" type="<?= $field==='deadline'?'date':'text' ?>" maxlength="180" value="<?= h($v[$field]) ?>"><?php endif ?></label><?php endforeach ?>
<p>Application instructions should include the approved email address or delivery location, required documents and job reference. Text is displayed as written; HTML is not supported.</p><button class="button secondary" name="action" value="draft">Save draft</button> <button class="button" name="action" value="publish">Publish vacancy</button><?php if($v['published']): ?> <button class="button secondary" name="action" value="close">Close vacancy now</button><?php endif ?></form>
<?php if($id): ?><details class="contact-card"><summary>Preview saved draft</summary><?= vacancy_card($v+['id'=>$id]) ?></details><?php endif ?>
<h2>Saved vacancies</h2><?php $items=rows(run('SELECT id,title,published,updated_at FROM vacancies ORDER BY id DESC'));foreach($items as $r):$live=$r['published']?json_decode($r['published'],true):null; ?><article class="contact-card"><h3><a href="?id=<?= (int)$r['id'] ?>"><?= h($r['title']) ?></a></h3><p><?= $live?(vacancy_open($live)?'Published':'Closed · deadline passed'):'Draft / unpublished' ?> · Updated <?= h($r['updated_at']) ?></p></article><?php endforeach ?><?php if(!$items): ?><p>No vacancies have been created. The public page shows no current vacancies.</p><?php endif ?>
<?php layout_end(); ?>
