<?php
require __DIR__.'/care-totals.php';
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { header('Allow: GET'); http_response_code(405); exit; }
$current = care_totals_current();
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['patients'=>(int)$current['patients'],'encounters'=>(int)$current['encounters'],'recorded_on'=>$current['recorded_on']], JSON_THROW_ON_ERROR);
