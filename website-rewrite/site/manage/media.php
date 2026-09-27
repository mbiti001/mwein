<?php
require dirname(__DIR__).'/api/content.php';require_admin();content_tables();
if(isset($_GET['view'])){$m=rows(run('SELECT * FROM media WHERE id=?',[(int)$_GET['view']]))[0]??null;if(!$m){http_response_code(404);exit;}serve_image($m);}
$error='';$stage='validation';
if($_SERVER['REQUEST_METHOD']==='POST'){
    check_csrf();
    try {
        if(limited('upload',20,3600))throw new InvalidArgumentException('Upload limit reached. Try again later.');
        $alt=post('alt');$f=$_FILES['image']??null;
        if(strlen($alt)<3||strlen($alt)>250)throw new InvalidArgumentException('Describe the image in 3–250 characters.');
        if(!$f||is_array($f['error'])||$f['error']!==UPLOAD_ERR_OK||$f['size']>5*1024*1024||!is_uploaded_file($f['tmp_name']))throw new InvalidArgumentException('Choose a JPEG, PNG or WebP image up to 5 MB (your hosting limit may be lower).');
        $info=@getimagesize($f['tmp_name']);$mime=$info['mime']??'';
        if(!$info||!in_array($mime,['image/jpeg','image/png','image/webp'],true)||$info[0]*$info[1]>16000000)throw new InvalidArgumentException('Use a valid JPEG, PNG or WebP image, at most 16 megapixels.');
        $dir=config()['data_dir'].'/media';if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new RuntimeException('Media directory');$file=bin2hex(random_bytes(24)).'.jpg';
        $stage='image conversion';
        if(function_exists('imagecreatefromstring')) {
            $im=@imagecreatefromstring(file_get_contents($f['tmp_name']));if(!$im)throw new InvalidArgumentException('This image could not be processed.');
            $scale=min(1,2000/max($info[0],$info[1]));$w=max(1,(int)($info[0]*$scale));$height=max(1,(int)($info[1]*$scale));$out=imagecreatetruecolor($w,$height);imagefill($out,0,0,imagecolorallocate($out,255,255,255));imagecopyresampled($out,$im,0,0,0,0,$w,$height,$info[0],$info[1]);
            if(!imagejpeg($out,$dir.'/'.$file,85))throw new RuntimeException('Image save');
        } else {
            if($mime!=='image/jpeg'||max($info[0],$info[1])>2000)throw new InvalidArgumentException('Wait for the browser to prepare your image, or use a JPEG no larger than 2000 pixels.');
            $clean=strip_jpeg_metadata(file_get_contents($f['tmp_name']));
            if(file_put_contents($dir.'/'.$file,$clean)===false)throw new RuntimeException('Image save');
        }
        $stage='media registration';run('INSERT INTO media(file,alt,created_at) VALUES(?,?,?)',[$file,$alt,date('c')]);redirect('/manage/media.php?saved=1');
    }catch(InvalidArgumentException $e){http_response_code(422);$error=$e->getMessage();}catch(Throwable $e){http_response_code(503);error_log('Mwein image upload: '.get_class($e));$error='Upload failed during '.$stage.'. The file was not confirmed as uploaded.';}
}
$items=rows(run('SELECT * FROM media ORDER BY id DESC LIMIT 100'));layout_start('Media library'); ?>
<link rel="stylesheet" href="/assets/content.css?v=1"><p><a href="/manage/posts.php">← Blog publishing</a></p><h1>Media library</h1><p>Upload facility photographs or graphics. Images are resized and converted to JPEG, removing embedded metadata. Use YouTube or other HTTPS links for videos. Images remain private until used in a published post.</p>
<?php if($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php elseif(isset($_GET['saved'])): ?><p class="notice">Image uploaded. Select it in your post editor.</p><?php endif ?>
<form method="post" enctype="multipart/form-data" class="contact-card"><?= csrf() ?><label>Image<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required></label><label>Image description (alt text)<input name="alt" required minlength="3" maxlength="250" value="<?= h(post('alt')) ?>"></label><p>Images are prepared in your browser before uploading. Server upload limit: <?= h(ini_get('upload_max_filesize')) ?>.</p><p>Up to 5 MB, 16 megapixels; images only. Upload only images you have permission to publish.</p><button class="button">Upload image</button></form><div class="post-grid"><?php foreach($items as $m): ?><figure class="contact-card"><img class="post-image" loading="lazy" src="/manage/media.php?view=<?= (int)$m['id'] ?>" alt="<?= h($m['alt']) ?>"><figcaption>#<?= (int)$m['id'] ?> · <?= h($m['alt']) ?></figcaption></figure><?php endforeach ?></div>
<script src="/assets/media-upload.js?v=1" defer></script><?php layout_end(); ?>
