<?php
require dirname(__DIR__).'/site/api/content.php';
$im=imagecreatetruecolor(5,5);ob_start();imagejpeg($im);$raw=ob_get_clean();
$tag="\xff\xe1\x00\x08SECRET";
$clean=strip_jpeg_metadata(substr($raw,0,2).$tag.substr($raw,2));
if(str_contains($clean,'SECRET')||!imagecreatefromstring($clean))exit(1);
foreach([$raw.'trailing',substr($raw,0,-2),substr($raw,0,-2).$tag."\xff\xd9"] as $bad){try{strip_jpeg_metadata($bad);exit(2);}catch(InvalidArgumentException $e){}}
echo "JPEG metadata and malformed-scan checks passed\n";
