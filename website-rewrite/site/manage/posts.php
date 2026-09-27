<?php
require dirname(__DIR__).'/api/content.php';require_admin();content_tables();
$items=rows(run('SELECT id,title,category,published_at,published,updated_at FROM posts ORDER BY updated_at DESC LIMIT 100'));
layout_start('Blog publishing'); ?>
<p><a href="/manage/">← Dashboard</a></p><h1>Blog publishing</h1><nav class="section-tabs"><a class="button" href="/manage/post.php">Write a post</a><a href="/manage/media.php">Media library</a><a href="/manage/feedback.php">Comments & reviews</a><a href="/blog.php">View public blog</a></nav><p>Save your work as a draft, preview it, then publish when ready. Saving edits to a published post keeps its current public version unchanged until you publish again.</p>
<?php foreach($items as $p): ?><article class="contact-card"><p class="eyebrow"><?= $p['published']?'PUBLISHED · edits may be pending':'DRAFT' ?></p><h2><a href="/manage/post.php?id=<?= (int)$p['id'] ?>"><?= h($p['title']?:'Untitled draft') ?></a></h2><p><?= h($p['category']) ?> · Updated <?= h($p['updated_at']) ?></p></article><?php endforeach ?>
<?php layout_end(); ?>
