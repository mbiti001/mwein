<?php
require __DIR__.'/api/content.php';content_tables();header('Content-Type: application/xml; charset=utf-8');
echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
foreach(['','services.html','contact.html','insurers.html','blog.php','partners.html','privacy-policy.html'] as $path)echo '<url><loc>'.h(config()['origin'].'/'.$path).'</loc></url>';
foreach(rows(run("SELECT id,published_at FROM posts WHERE published IS NOT NULL AND published!=''")) as $p)echo '<url><loc>'.h(config()['origin'].'/blog.php?id='.(int)$p['id']).'</loc></url>';
echo '</urlset>';
