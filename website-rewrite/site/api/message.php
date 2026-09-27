<?php
require __DIR__ . '/notifications.php';
require_post();
same_origin();
if (limited('message', 5, 900)) { http_response_code(429); header('Retry-After: 900'); exit('Too many messages. Please try again in 15 minutes or email info@mweinmedical.co.ke.'); }
$categories = ['General enquiry', 'WhatsApp follow-up', 'Care arrangement', 'Insurance enquiry', 'Partnership or support', 'Official correspondence'];
$name = post('name'); $contact = post('contact'); $category = post('category'); $message = post('message');
$validContact = filter_var($contact, FILTER_VALIDATE_EMAIL) || (preg_match('/^\+?[0-9 ()-]{8,24}$/D', $contact) && whatsapp_contact($contact) !== '');
if (post('website') !== '' || strlen($name) < 2 || strlen($name) > 120 || strlen($contact) > 254 || !$validContact || !in_array($category, $categories, true) || strlen($message) < 10 || strlen($message) > 4000 || post('consent') !== 'yes') {
    http_response_code(422); layout_start('Check your message');
    echo '<h1>Please check your details</h1><p>Enter your name, a valid email or WhatsApp number with country code, a request type, and a message between 10 and 4,000 characters. Confirm that we may use these details to respond.</p><p>Use your browser’s Back button to correct the form.</p>'; layout_end(); exit;
}
$reference = strtoupper(bin2hex(random_bytes(6)));
run('INSERT INTO messages(reference,created_at,name,contact,category,message) VALUES (?,?,?,?,?,?)', [$reference, date('c'), $name, $contact, $category, $message]);
// Alert failure must never undo or obscure a saved enquiry.
try { notify_enquiry((int)db()->lastInsertRowID()); } catch (Throwable $e) { error_log('Mwein enquiry alert failed; message remains saved'); }
// Aggregate only a validated public page label, never enquiry text or contact details.
try {require_once __DIR__.'/outcomes.php';record_enquiry_source(post('source'));} catch(Throwable $e){error_log('Mwein aggregate enquiry count failed');}
// POST/redirect/GET prevents refresh from submitting a second message.
redirect('/message-received.php?ref=' . $reference);
