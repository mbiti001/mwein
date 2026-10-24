<?php
require __DIR__.'/api/careers.php';careers_tables();
$shell=file_get_contents(__DIR__.'/careers.html');preg_match('~<main id="main">(.*?)</main>~s',$shell,$match);$body=$match[1];$vacancies=open_vacancies();
if($vacancies){$section='<section class="wrap" id="opportunities" aria-labelledby="vacancies-title"><p class="eyebrow">CURRENT OPPORTUNITIES</p><h2 id="vacancies-title">Open vacancies</h2>';foreach($vacancies as $v)$section.=vacancy_card($v);$section.='</section>';$body=preg_replace_callback('~<section class="wrap note" id="opportunities".*?</section>~s',fn()=>$section,$body);}
$body='<link rel="stylesheet" href="/assets/careers.css?v=1">'.$body;
public_content('Healthcare Careers in Mungatsi, Busia',$body,config()['origin'].'/careers.php','Careers at Mwein Medical Services in Mungatsi, Busia. View current vacancies, qualifications, closing dates and application instructions.');
