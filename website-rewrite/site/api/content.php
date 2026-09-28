<?php
require_once __DIR__.'/common.php';
function content_tables(): void {
    db()->exec("CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Facility news',links TEXT NOT NULL DEFAULT '',media_ids TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,published TEXT,published_at TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media(id INTEGER PRIMARY KEY AUTOINCREMENT,file TEXT NOT NULL UNIQUE,alt TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public_media(post_id INTEGER NOT NULL,media_id INTEGER NOT NULL,PRIMARY KEY(post_id,media_id));
    CREATE TABLE IF NOT EXISTS content_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);");
    if(!in_array('presentation',array_column(rows(run('PRAGMA table_info(posts)')),'name'),true))db()->exec("ALTER TABLE posts ADD COLUMN presentation TEXT NOT NULL DEFAULT '{}'");
    if(!scalar(run("SELECT value FROM content_meta WHERE key='seeded'"))) {
        db()->exec('BEGIN IMMEDIATE');
        try {
            if(!scalar(run("SELECT value FROM content_meta WHERE key='seeded'"))) {
                $seed=['title'=>'Building our new facility: working towards Level 3','summary'=>'Construction is underway for our planned facility upgrade in Mungatsi, Busia.','body'=>"Mwein Medical Services is building a new facility in preparation for a planned upgrade to Level 3. The project reflects our commitment to serving the community in Mungatsi, Busia.\n\nConstruction is underway. The proposed Level 3 upgrade remains subject to the required approvals. We will share confirmed project milestones and opening information as the development progresses.\n\nOur commitment remains the same: Exceptional care close to you.",'category'=>'Facility development','links'=>'Donors and partners | https://mweinmedical.co.ke/partners.html','media_ids'=>[]];
                run('INSERT INTO posts(title,summary,body,category,links,published,published_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[$seed['title'],$seed['summary'],$seed['body'],$seed['category'],$seed['links'],json_encode($seed),'2026-09-23T12:00:00+03:00',date('c')]);
                run("INSERT INTO content_meta(key,value) VALUES('seeded','yes')");
            }db()->exec('COMMIT');
        }catch(Throwable $e){db()->exec('ROLLBACK');throw $e;}
    }
}
function resource_links(string $text): array {
    $out=[];
    foreach(explode("\n",trim($text)) as $line){if(trim($line)==='')continue;
        $parts=explode('|',$line,2);$label=trim(count($parts)===2?$parts[0]:'Read more');$url=trim(count($parts)===2?$parts[1]:$parts[0]);
        $u=parse_url($url);
        if(strlen($label)>120||strlen($url)>1500||!filter_var($url,FILTER_VALIDATE_URL)||($u['scheme']??'')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass']))throw new InvalidArgumentException('Use HTTPS links, one per line, as Label | https://example.com.');
        $out[]=[$label,$url];if(count($out)>10)throw new InvalidArgumentException('Use at most ten resource links.');
    }return $out;
}
function youtube_id(string $url): string {
    $u=parse_url($url);$host=strtolower($u['host']??'');$path=$u['path']??'';$id='';
    if($host==='youtu.be')$id=ltrim($path,'/');
    elseif(in_array($host,['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'],true)) {
        if($path==='/watch'){parse_str($u['query']??'',$q);$id=is_string($q['v']??null)?$q['v']:'';}
        elseif(preg_match('~^/(?:embed|shorts)/([^/]+)$~D',$path,$m))$id=$m[1];
    }
    return preg_match('/^[A-Za-z0-9_-]{11}$/D',$id)?$id:'';
}
function post_options(array $p): array {return isset($p['options'])?(array)$p['options']:(json_decode($p['presentation']??'{}',true)?:[]);}
function post_images(array $p): array {
    $ids=$p['media_ids']??[];$cover=(int)(post_options($p)['cover']??0);
    if(in_array($cover,$ids,true))$ids=[$cover,...array_values(array_diff($ids,[$cover]))];return $ids;
}
function inline_text(string $text): string {
    return preg_replace('/\*\*([^*\n]+)\*\*/','<strong>$1</strong>',h($text));
}
function content_body(string $text): string {
    $html='';foreach(preg_split('/\n\s*\n/',trim($text)) as $para){
        if(str_starts_with($para,'## '))$html.='<h2>'.h(substr($para,3)).'</h2>';
        elseif(preg_match('/^(- [^\n]+)(\n- [^\n]+)*$/D',$para)){$html.='<ul>';foreach(explode("\n",$para) as $line)$html.='<li>'.inline_text(substr($line,2)).'</li>';$html.='</ul>';}
        else $html.='<p>'.nl2br(inline_text($para)).'</p>';
    }return $html;
}
function render_article(array $p,bool $preview=false): string {
    $html='<article class="wrap prose"><p class="eyebrow">'.h($p['category']).'</p><h1>'.h($p['title']).'</h1><p class="lead">'.h($p['summary']).'</p>';
    foreach(post_images($p) as $id){$m=rows(run('SELECT * FROM media WHERE id=?',[(int)$id]))[0]??null;if($m)$html.='<figure><img class="post-image" loading="lazy" src="'.($preview?'/manage/media.php?view=':'/media.php?id=').(int)$id.'" alt="'.h($m['alt']).'">'.(!empty(post_options($p)['captions'][$id])?'<figcaption>'.h(post_options($p)['captions'][$id]).'</figcaption>':'').'</figure>';}
    $html.=content_body($p['body']);$links=resource_links($p['links']);
    if($links){$html.='<h2>Related links & videos</h2><ul>';foreach($links as [$label,$url]){$html.='<li><a href="'.h($url).'" target="_blank" rel="noopener noreferrer">'.h($label).' ↗</a> <small>(opens another website)</small>';
        $video=youtube_id($url);if($video)$html.='<div class="video-panel" data-video="'.h($video).'"><p>Load this video to connect to YouTube. YouTube may process viewing data.</p><button type="button" class="button video-load" data-title="'.h($label).'">Load video</button></div>';$html.='</li>'; }$html.='</ul>';}
    return $html.'<p><a class="button" href="/contact.html'.(!empty($p['id'])?'?from=post:'.(int)$p['id']:'').'#send-message">Ask our team →</a></p></article>';
}
function public_content(string $title,string $body,string $url,string $description='News and updates from Mwein Medical Services.',array $article=[]): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    $shell=file_get_contents(dirname(__DIR__).'/index.html');
    $shell=preg_replace_callback('~<main id="main">.*?</main>~s',fn()=>'<main id="main">'.$body.'</main>',$shell);
    $shell=preg_replace_callback('~<title>.*?</title>~s',fn()=>'<title>'.h($title).' | Mwein Medical Services</title>',$shell);
    $shell=preg_replace_callback('~(<meta (?:name="description"|property="og:description") content=")[^"]*~',fn($m)=>$m[1].h($description),$shell);
    $shell=preg_replace_callback('~(<meta property="og:title" content=")[^"]*~',fn($m)=>$m[1].h($title),$shell);
    $shell=preg_replace_callback('~(<link rel="canonical" href=")[^"]*~',fn($m)=>$m[1].h($url),$shell);
    $shell=preg_replace_callback('~(<meta property="og:url" content=")[^"]*~',fn($m)=>$m[1].h($url),$shell);
    if($article){
        $shell=str_replace('property="og:type" content="website"','property="og:type" content="article"',$shell);
        $mid=post_images($article)[0]??0;
        if($mid){$m=rows(run('SELECT alt FROM media WHERE id=?',[$mid]))[0]??null;if($m){
            $shell=preg_replace_callback('~(<meta property="og:image" content=")[^"]*~',fn($m)=>$m[1].h(config()['origin'].'/media.php?id='.(int)$mid),$shell);
            $shell=preg_replace_callback('~(<meta property="og:image:alt" content=")[^"]*~',fn($match)=>$match[1].h($m['alt']),$shell);
        }}
    }
    $shell=str_replace('aria-current="page" ','',$shell);
    if(str_contains($url,'/blog.php'))$shell=str_replace('href="blog.php">Blog','aria-current="page" href="blog.php">Blog',$shell);
    $shell=preg_replace('~(href|src)="(?![a-z]+:|/|#|\?)([^"]+)"~i','$1="/$2"',$shell);
    echo $shell;
}
function serve_image(array $m): never {
    $path=config()['data_dir'].'/media/'.$m['file'];
    if(!is_file($path)){http_response_code(404);exit;}
    header('Content-Type: image/jpeg');header('Content-Disposition: inline; filename="facility-image.jpg"');header('X-Content-Type-Options: nosniff');readfile($path);exit;
}

function strip_jpeg_metadata(string $data): string {
    if(substr($data,0,2)!=="\xff\xd8")throw new InvalidArgumentException('Invalid JPEG image.');
    $out=substr($data,0,2);$pos=2;$size=strlen($data);
    while($pos<$size) {
        $start=$pos;if(ord($data[$pos])!==255)throw new InvalidArgumentException('Invalid JPEG segment.');
        while($pos<$size&&ord($data[$pos])===255)$pos++;
        if($pos>=$size)break;$marker=ord($data[$pos++]);
        if($marker===0xc2)throw new InvalidArgumentException('Please let the browser prepare this progressive JPEG.');
        if($marker===0xda){
            if($pos+2>$size)break;$len=unpack('n',substr($data,$pos,2))[1];
            if($len<2||$pos+$len>$size)throw new InvalidArgumentException('Invalid JPEG scan.');
            $scan=$pos+$len;
            while($scan<$size){
                if(ord($data[$scan++])!==255)continue;
                while($scan<$size&&ord($data[$scan])===255)$scan++;
                if($scan>=$size)break;$next=ord($data[$scan++]);
                if($next===0||($next>=0xd0&&$next<=0xd7))continue;
                if($next===0xd9&&$scan===$size)return $out.substr($data,$start);
                throw new InvalidArgumentException('Please let the browser prepare this JPEG.');
            }throw new InvalidArgumentException('Incomplete JPEG image.');
        }
        if($marker===0xd9)return $out."\xff\xd9";
        if($pos+2>$size)break;$len=unpack('n',substr($data,$pos,2))[1];
        if($len<2||$pos+$len>$size)throw new InvalidArgumentException('Invalid JPEG length.');
        if(!(($marker>=0xe1&&$marker<=0xef)||$marker===0xfe))$out.=substr($data,$start,$pos+$len-$start);
        $pos+=$len;
    }throw new InvalidArgumentException('Incomplete JPEG image.');
}
