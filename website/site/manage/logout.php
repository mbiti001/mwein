<?php
require dirname(__DIR__) . '/api/common.php';
require_post(); require_admin(); check_csrf();
run('DELETE FROM admin_sessions WHERE token=?',[admin_session_token()]);
admin_event('logout');
$_SESSION = [];
$secure=parse_url(config()['origin'], PHP_URL_SCHEME)==='https';
setcookie(session_name(), '', ['expires'=>time()-3600, 'path'=>$secure?'/':'/manage', 'secure'=>$secure, 'httponly'=>true, 'samesite'=>'Strict']);
session_destroy(); redirect('/manage/login.php');
