<?php
require __DIR__.'/api/content.php';content_tables();$id=(int)($_GET['id']??0);
if(!scalar(run('SELECT media_id FROM public_media WHERE media_id=? LIMIT 1',[$id]))){http_response_code(404);exit;}
$m=rows(run('SELECT * FROM media WHERE id=?',[$id]))[0]??null;if(!$m){http_response_code(404);exit;}serve_image($m);
