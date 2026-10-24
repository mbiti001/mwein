<?php
require_once __DIR__.'/content.php';
function careers_tables(): void {
    db()->exec("CREATE TABLE IF NOT EXISTS vacancies(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,location TEXT NOT NULL,description TEXT NOT NULL,qualifications TEXT NOT NULL,instructions TEXT NOT NULL,deadline TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,published TEXT,updated_at TEXT NOT NULL)");
}
function vacancy_open(array $v,?string $today=null): bool {return $v['deadline']>=($today??date('Y-m-d'));}
function open_vacancies(): array {
    $out=[];foreach(rows(run("SELECT id,published FROM vacancies WHERE published IS NOT NULL AND published!='' ORDER BY id DESC")) as $r){$v=json_decode($r['published'],true);if(vacancy_open($v))$out[]=['id'=>(int)$r['id']]+$v;}return $out;
}
function vacancy_card(array $v): string {
    return '<article class="contact-card" id="vacancy-'.(int)($v['id']??0).'"><h2>'.h($v['title']).'</h2><p>'.h($v['location']).' · Apply by '.h($v['deadline']?date('j F Y',strtotime($v['deadline'])):'[closing date not set]').' at 23:59 Kenya time</p><h3>About the role</h3><p>'.nl2br(h($v['description'])).'</p><h3>Qualifications &amp; experience</h3><p>'.nl2br(h($v['qualifications'])).'</p><h3>How to apply</h3><p>'.nl2br(h($v['instructions'])).'</p></article>';
}
