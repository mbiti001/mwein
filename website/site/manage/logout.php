<?php
require dirname(__DIR__) . '/api/common.php';
require_post(); require_admin(); check_csrf();
$_SESSION = [];
setcookie(session_name(), '', ['expires'=>time()-3600, 'path'=>'/manage', 'secure'=>parse_url(config()['origin'], PHP_URL_SCHEME)==='https', 'httponly'=>true, 'samesite'=>'Strict']);
session_destroy(); redirect('/manage/login.php');
