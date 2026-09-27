<?php
require_once __DIR__.'/content.php';
function feedback_tables(): void {
    content_tables();
    db()->exec("CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
      request_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('comment','review')),
      post_id INTEGER NOT NULL DEFAULT 0, display_name TEXT NOT NULL, body TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5), created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden')),
      version INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS feedback_public ON feedback(kind,status,post_id,id);
      CREATE TABLE IF NOT EXISTS feedback_moderation(id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_id INTEGER NOT NULL, created_at TEXT NOT NULL, previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL, note TEXT NOT NULL);");
}
function feedback_token(string $kind,int $postId): string {
    $value=(time()+7200).'.'.bin2hex(random_bytes(16));
    return $value.'.'.hash_hmac('sha256','feedback|'.$kind.'|'.$postId.'|'.$value,config()['secret']);
}
function feedback_token_valid(string $token,string $kind,int $postId): bool {
    if(!preg_match('/^([0-9]{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/D',$token,$m))return false;
    if((int)$m[1]<time()||(int)$m[1]>time()+7200)return false;
    return hash_equals(hash_hmac('sha256','feedback|'.$kind.'|'.$postId.'|'.$m[1].'.'.$m[2],config()['secret']),$m[3]);
}
function feedback_form(string $kind,int $postId=0,array $values=[]): string {
    $review=$kind==='review';
    ob_start(); ?>
    <form class="feedback-form" method="post" action="/feedback-submit.php">
      <input type="hidden" name="kind" value="<?= h($kind) ?>"><input type="hidden" name="post_id" value="<?= $postId ?>"><input type="hidden" name="token" value="<?= h(feedback_token($kind,$postId)) ?>">
      <p class="feedback-privacy" id="feedback-help">Your chosen display name and message<?= $review?' and rating':'' ?> may be public after review. Use a nickname if you prefer. Do not include diagnoses, medical records, phone numbers or other private details. For care or a private complaint, <a href="/contact.html#send-message">contact our team</a>.</p>
      <label>Display name or nickname<input name="display_name" required maxlength="60" autocomplete="off" value="<?= h($values['display_name']??'') ?>"></label>
      <?php if($review): ?><fieldset class="rating-choice"><legend>Your overall experience</legend><div class="rating-options"><?php foreach([1=>'Poor',2=>'Fair',3=>'Good',4=>'Very good',5=>'Excellent'] as $n=>$label): ?><label><input type="radio" name="rating" value="<?= $n ?>" required <?= ($values['rating']??'')===(string)$n?'checked':'' ?>><span><b><?= $n ?> <span aria-hidden="true">★</span></b><small><?= $label ?></small></span></label><?php endforeach ?></div></fieldset><?php endif ?>
      <label><?= $review?'Tell us about your experience':'Your comment' ?><textarea name="body" required minlength="10" maxlength="2000" rows="5" aria-describedby="feedback-help"><?= h($values['body']??'') ?></textarea></label>
      <div class="feedback-trap" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <?php if($review): ?><label class="feedback-check"><input type="checkbox" name="experience" value="yes" required>I am sharing my own experience of visiting Mwein Medical Services.</label><?php endif ?>
      <label class="feedback-check"><input type="checkbox" name="consent" value="yes" required>I agree to storage and public display of my submission after moderation, as described in the <a href="/privacy-policy.html#public-feedback">privacy notice</a>.</label>
      <p class="feedback-policy">Positive and critical feedback are welcome. We review for privacy, spam and abuse before publication. Website submissions are not verified patient reviews.</p>
      <button class="button" type="submit">Submit <?= $review?'review':'comment' ?></button><p class="feedback-submit-status" role="status"></p>
    </form>
    <?php return ob_get_clean();
}
function feedback_cards(array $items): string {
    $html='';foreach($items as $item){$html.='<article class="feedback-card"><div><strong>'.h($item['display_name']).'</strong><time datetime="'.h(substr($item['created_at'],0,10)).'">'.h(date('j M Y',strtotime($item['created_at']))).'</time></div>';
        if($item['kind']==='review')$html.='<p class="feedback-stars" aria-label="'.(int)$item['rating'].' out of 5 stars">'.str_repeat('★',(int)$item['rating']).'<span aria-hidden="true">'.str_repeat('☆',5-(int)$item['rating']).'</span></p>';
        $html.='<p class="feedback-body">'.nl2br(h($item['body'])).'</p></article>';}
    return $html;
}
function blog_comments(int $postId): string {
    feedback_tables();
    $items=rows(run("SELECT * FROM feedback WHERE kind='comment' AND post_id=? AND status='approved' ORDER BY id DESC LIMIT 50",[$postId]));
    return '<section class="wrap feedback-section" id="comments"><p class="eyebrow">JOIN THE CONVERSATION</p><h2>Comments</h2><p>Comments are reviewed before publication. Please keep the conversation relevant and respectful.</p>'.($items?'<p class="small">Latest approved comments · up to 50 shown</p>'.feedback_cards($items):'<p class="feedback-empty">No published comments yet. You can be the first to contribute.</p>').'<h3>Leave a comment</h3>'.feedback_form('comment',$postId).'</section>';
}
