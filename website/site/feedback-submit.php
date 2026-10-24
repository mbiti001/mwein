<?php
require __DIR__.'/api/feedback.php';require_post();same_origin();feedback_tables();
$kind=post('kind');$postId=filter_var(post('post_id'),FILTER_VALIDATE_INT);$token=post('token');
if(!in_array($kind,['comment','review'],true)||$postId===false||($kind==='review'&&$postId!==0)||($kind==='comment'&&$postId<1)||!feedback_token_valid($token,$kind,$postId)){
    http_response_code(422);public_content('Reload the feedback form','<section class="wrap page-head"><h1>Please reload the form.</h1><p>The form has expired or its details changed. Your submission has not been saved.</p><a href="/reviews.php">Visitor reviews</a> · <a href="/blog.php">Blog</a></section>',config()['origin'].'/reviews.php');exit;
}
if($kind==='comment'&&!scalar(run("SELECT id FROM posts WHERE id=? AND published IS NOT NULL AND published!=''",[$postId]))){http_response_code(404);exit('This post is no longer available for comments.');}
$key=hash('sha256',$token);
if(scalar(run('SELECT id FROM feedback WHERE request_key=?',[$key])))redirect('/feedback-received.php');
if(limited('public-feedback',5,900)){http_response_code(429);header('Retry-After: 900');exit('Too many submissions. Please try again in 15 minutes.');}
$name=post('display_name');$body=post('body');$rating=$kind==='review'?filter_var(post('rating'),FILTER_VALIDATE_INT):0;
if(post('website')!==''||strlen($name)<2||strlen($name)>60||strlen($body)<10||strlen($body)>2000||!preg_match('//u',$name.$body)||post('consent')!=='yes'||($kind==='review'&&($rating===false||$rating<1||$rating>5||post('experience')!=='yes'))){
    http_response_code(422);$error='<section class="wrap feedback-section"><h1>Check your feedback</h1><p role="alert">Use a display name of 2–60 characters and a message of 10–2,000 characters. Confirm publication consent'.($kind==='review'?', select 1–5 stars and confirm this is your own visit experience':'').'. Your submission has not been saved.</p>'.feedback_form($kind,$postId,['display_name'=>substr($name,0,60),'body'=>substr($body,0,2000),'rating'=>post('rating')]).'</section>';
    public_content('Check your feedback',$error,config()['origin'].'/reviews.php');exit;
}
// Unique request key prevents repeated clicks or a lost response from creating duplicates.
run('INSERT INTO feedback(reference,request_key,kind,post_id,display_name,body,rating,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING',[bin2hex(random_bytes(12)),$key,$kind,$postId,$name,$body,$rating,date('c')]);
redirect('/feedback-received.php');
