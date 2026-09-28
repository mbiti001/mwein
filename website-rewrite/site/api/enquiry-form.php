<?php
require_once __DIR__.'/content.php';
function enquiry_error(array $errors, int $status=422): never {
    http_response_code($status);
    header('X-Robots-Tag: noindex, nofollow');
    $html='<section class="wrap confirmation"><h1>Check your enquiry</h1><div class="form-errors" tabindex="-1" role="alert"><p>We could not complete this submission. Please check the following:</p><ul>';
    foreach($errors as $key=>$error) $html.='<li><a href="#enquiry-'.h($key).'">'.h($error).'</a></li>';
    $html.='</ul></div><form class="enquiry-form" method="post" action="/api/message.php">';
    foreach(['name'=>'Your name','contact'=>'Email or WhatsApp number','category'=>'How can we help?','message'=>'Your message'] as $key=>$label) {
        $invalid=isset($errors[$key])?' aria-invalid="true" aria-describedby="error-'.$key.'"':'';
        $html.='<label for="enquiry-'.$key.'">'.$label.'</label>';
        if($key==='category') {
            $html.='<select id="enquiry-category" name="category" required'.$invalid.'><option value="">Choose a request type</option>';
            foreach(['General enquiry','WhatsApp follow-up','Care arrangement','Insurance enquiry','Partnership or support','Official correspondence'] as $category) $html.='<option'.(post($key)===$category?' selected':'').'>'.h($category).'</option>';
            $html.='</select>';
        } elseif($key==='message') $html.='<textarea id="enquiry-message" name="message" minlength="10" maxlength="4000" rows="5" required'.$invalid.'>'.h(post($key)).'</textarea>';
        else $html.='<input id="enquiry-'.$key.'" name="'.$key.'" maxlength="'.($key==='name'?120:254).'" '.($key==='name'?'autocomplete="name" minlength="2"':'').' value="'.h(post($key)).'" required'.$invalid.'>';
        if(isset($errors[$key])) $html.='<p class="field-error" id="error-'.$key.'">'.h($errors[$key]).'</p>';
    }
    $html.='<input type="hidden" name="request_key" value="'.h(post('request_key')).'"><input type="hidden" name="source" value="'.h(post('source')).'"><div class="trap" aria-hidden="true"><label>Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label></div><label class="consent" id="enquiry-consent"><input type="checkbox" name="consent" value="yes" required'.(post('consent')==='yes'?' checked':'').'><span>I agree that Mwein may use these details to respond to my enquiry. <a href="/privacy-policy.html">Read the website privacy notice.</a></span></label>';
    if(isset($errors['consent'])) $html.='<p class="field-error">'.h($errors['consent']).'</p>';
    $html.='<button class="button" type="submit">Send enquiry</button><p class="small">This sends a message; it does not book an appointment. Do not include medical records or payment details.</p></form></section>';
    public_content('Check your enquiry',$html,config()['origin'].'/contact.html','Correct and send your enquiry to Mwein.'); exit;
}
