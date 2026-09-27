<?php
require __DIR__.'/feedback.php';feedback_tables();header('Content-Type: application/json; charset=utf-8');
$s=rows(run("SELECT COUNT(*) AS count,AVG(rating) AS average FROM feedback WHERE kind='review' AND status='approved'"))[0];
echo json_encode(['count'=>(int)$s['count'],'average'=>$s['count']?round((float)$s['average'],1):null]);
