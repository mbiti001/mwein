<?php
// Deterministic sizing only: preserve the owner's approved full wordmark.
$root=dirname(__DIR__).'/site';$source=imagecreatefrompng($root.'/assets/mwein-wordmark.png');
$left=imagesx($source);$top=imagesy($source);$right=0;$bottom=0;
for($y=0;$y<imagesy($source);$y++)for($x=0;$x<imagesx($source);$x++)if(((imagecolorat($source,$x,$y)>>24)&127)<120){$left=min($left,$x);$right=max($right,$x);$top=min($top,$y);$bottom=max($bottom,$y);}
$w=$right-$left+1;$h=$bottom-$top+1;$pngs=[];
foreach([16,32,48,180] as $size){
 $im=imagecreatetruecolor($size,$size);imagealphablending($im,false);imagesavealpha($im,true);imagefill($im,0,0,imagecolorallocatealpha($im,0,0,0,127));
 $padding=$size===16?0:($size===180?8:1);$targetW=$size-2*$padding;$targetH=max(1,(int)round($h*$targetW/$w));
 imagecopyresampled($im,$source,$padding,(int)floor(($size-$targetH)/2),$left,$top,$targetW,$targetH,$w,$h);
 ob_start();imagepng($im);$png=ob_get_clean();file_put_contents($root.'/assets/'.($size===180?'apple-touch-icon.png':'favicon-'.$size.'.png'),$png);if($size!==180)$pngs[$size]=$png;
}
$header=pack('vvv',0,1,count($pngs));$entries='';$body='';$offset=6+16*count($pngs);
foreach($pngs as $size=>$png){$entries.=pack('CCCCvvVV',$size,$size,0,0,1,32,strlen($png),$offset);$body.=$png;$offset+=strlen($png);}
file_put_contents($root.'/favicon.ico',$header.$entries.$body);
echo "True square 16, 32, 48px icons and 180px touch icon built from cropped approved wordmark.\n";
