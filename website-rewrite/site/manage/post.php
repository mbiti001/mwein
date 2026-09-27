<?php
require dirname(__DIR__).'/api/content.php';require_admin();content_tables();
$id=(int)($_GET['id']??0);$p=$id?(rows(run('SELECT * FROM posts WHERE id=?',[$id]))[0]??null):['title'=>'','summary'=>'','body'=>'','category'=>'Facility news','links'=>'','media_ids'=>'[]','version'=>0,'published'=>null];
if(!$p){http_response_code(404);exit('Post not found');}$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
    require_post();check_csrf();
    try {
        $action=post('action');if(!in_array($action,['draft','publish','unpublish'],true))throw new InvalidArgumentException('Choose a valid action.');
        $data=['title'=>post('title'),'summary'=>post('summary'),'body'=>post('body'),'category'=>post('category'),'links'=>post('links'),'media_ids'=>[]];
        if(strlen($data['title'])<3||strlen($data['title'])>180||strlen($data['summary'])>500||strlen($data['body'])<10||strlen($data['body'])>10000||strlen($data['category'])<2||strlen($data['category'])>80)throw new InvalidArgumentException('Use a title of 3–180 characters, category of 2–80, summary up to 500 and body of 10–10,000.');
        resource_links($data['links']);
        $selected=$_POST['images']??[];if(!is_array($selected)||count($selected)>12)throw new InvalidArgumentException('Select up to twelve images.');
        foreach($selected as $media){$mid=filter_var($media,FILTER_VALIDATE_INT);if(!$mid||!scalar(run('SELECT id FROM media WHERE id=?',[$mid])))throw new InvalidArgumentException('An image is unavailable.');$data['media_ids'][]=$mid;}
        $data['media_ids']=array_values(array_unique($data['media_ids']));
        $cover=(int)post('cover');if($cover&&!in_array($cover,$data['media_ids'],true))throw new InvalidArgumentException('Select the cover image in Images too.');
        $captions=$_POST['captions']??[];if(!is_array($captions))throw new InvalidArgumentException('Invalid captions.');
        $data['options']=['cover'=>$cover,'captions'=>[]];
        foreach($data['media_ids'] as $mid){$caption=$captions[$mid]??'';if(!is_string($caption)||strlen($caption)>400)throw new InvalidArgumentException('Keep captions under 400 characters.');$data['options']['captions'][$mid]=trim($caption);}

        db()->exec('BEGIN IMMEDIATE');
        try {
            if($id){$current=rows(run('SELECT * FROM posts WHERE id=?',[$id]))[0];if((int)post('version')!==(int)$current['version'])throw new InvalidArgumentException('This post was changed in another tab. Copy your draft before reloading.');}
            $published=$action==='publish'?json_encode($data):($action==='unpublish'?'':($p['published']??''));
            $date=$action==='publish'?($p['published_at']??date('c')):($p['published_at']??'');
            $values=[$data['title'],$data['summary'],$data['body'],$data['category'],$data['links'],json_encode($data['media_ids']),$published,$date,date('c')];
            if($id)run('UPDATE posts SET title=?,summary=?,body=?,category=?,links=?,media_ids=?,published=?,published_at=?,updated_at=?,version=version+1 WHERE id=?',[...$values,$id]);
            else {run('INSERT INTO posts(title,summary,body,category,links,media_ids,published,published_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',$values);$id=(int)db()->lastInsertRowID();}
            run('UPDATE posts SET presentation=? WHERE id=?',[json_encode($data['options']),$id]);
            if($action!=='draft'){run('DELETE FROM public_media WHERE post_id=?',[$id]);if($action==='publish')foreach($data['media_ids'] as $mid)run('INSERT INTO public_media(post_id,media_id) VALUES(?,?)',[$id,$mid]);}
            db()->exec('COMMIT');
        }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
        redirect('/manage/post.php?id='.$id.'&saved='.$action);
    }catch(InvalidArgumentException $e){http_response_code(422);$error=$e->getMessage();$p=array_merge($p,$data??[]);$p['media_ids']=json_encode($data['media_ids']??[]);}
}
$media=rows(run('SELECT * FROM media ORDER BY id DESC LIMIT 100'));$chosen=json_decode($p['media_ids'],true)?:[];
layout_start('Edit facility post'); echo '<link rel="stylesheet" href="/assets/content.css?v=2">'; ?>
<p><a href="/manage/posts.php">← Blog publishing</a></p><h1><?= $id?'Edit post':'Write a post' ?></h1>
<?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php elseif(isset($_GET['saved'])): ?><p class="notice">Saved as <?= h($_GET['saved']) ?>.</p><?php endif ?>
<?php if($id): ?><p><a href="/manage/preview.php?id=<?= $id ?>" target="_blank" rel="noopener">Preview saved draft ↗</a><?php if($p['published']): ?> · <a href="/blog.php?id=<?= $id ?>">View published post</a><?php endif ?></p><?php endif ?>
<form method="post" class="contact-card" id="post-editor"><?= csrf() ?><input type="hidden" name="version" value="<?= (int)$p['version'] ?>"><label>Title<input name="title" required minlength="3" maxlength="180" value="<?= h($p['title']) ?>"></label><label>Category<input name="category" required maxlength="80" value="<?= h($p['category']) ?>" placeholder="Facility news, Community, Events"></label><label>Short introduction<textarea name="summary" maxlength="500" rows="3"><?= h($p['summary']) ?></textarea></label><div class="editor-toolbar" role="group" aria-label="Text formatting"><button type="button" class="button secondary" data-format="heading">Heading</button><button type="button" class="button secondary" data-format="bold">Bold</button><button type="button" class="button secondary" data-format="list">Bullet list</button></div><label>Post text<textarea name="body" required minlength="10" maxlength="10000" rows="16"><?= h($p['body']) ?></textarea></label><p>Use blank lines between paragraphs. Start a section heading with ## followed by a space. Use **bold** for emphasis and - for bullet points. HTML is displayed as text.</p><label>Links and YouTube videos<textarea name="links" rows="4" maxlength="3500" placeholder="Watch our facility update | https://www.youtube.com/watch?v=…"><?= h($p['links']) ?></textarea></label><p>One HTTPS link per line: Label | URL. YouTube watch, share and Shorts links offer a click-to-load player. Other links open externally.</p><fieldset><legend>Images</legend><p><a href="/manage/media.php" target="_blank" rel="noopener">Upload images in the media library</a>, then save and reload this post to see them.</p><label>Cover image<select name="cover"><option value="0">First selected image</option><?php foreach($media as $m): ?><option value="<?= (int)$m['id'] ?>" <?= (int)(post_options($p)['cover']??0)===(int)$m['id']?'selected':'' ?>><?= h($m['alt']) ?></option><?php endforeach ?></select></label><div class="editor-images"><?php foreach($media as $m): ?><div class="image-choice"><img loading="lazy" src="/manage/media.php?view=<?= (int)$m['id'] ?>" alt="<?= h($m['alt']) ?>"><label><input type="checkbox" name="images[]" value="<?= (int)$m['id'] ?>" <?= in_array((int)$m['id'],$chosen,true)?'checked':'' ?>> <?= h($m['alt']) ?> (#<?= (int)$m['id'] ?>)</label><label>Caption for image #<?= (int)$m['id'] ?><input name="captions[<?= (int)$m['id'] ?>]" maxlength="400" value="<?= h(post_options($p)['captions'][$m['id']]??'') ?>"></label></div><?php endforeach ?></div></fieldset><p>Before publishing, check facts, image permissions and links. Keep identifiable patient information out of public posts.</p><button class="button secondary" name="action" value="draft">Save draft</button> <button class="button" name="action" value="publish">Publish this version</button><?php if($p['published']): ?> <button class="button secondary" name="action" value="unpublish">Unpublish</button><?php endif ?></form>
<p id="editor-status" role="status">Changes are saved only when you choose Save draft or Publish.</p><script src="/assets/editor.js?v=1" defer></script><?php layout_end(); ?>
