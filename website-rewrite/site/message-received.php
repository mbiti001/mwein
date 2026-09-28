<?php
require __DIR__ . '/api/mail.php';
$reference = is_string($_GET['ref'] ?? null) ? $_GET['ref'] : '';
if (!preg_match('/^[A-F0-9]{12}$/D', $reference)) { http_response_code(404); exit; }
$receipt = rows(run('SELECT category FROM messages WHERE reference=?', [$reference]))[0]??null;
if (!$receipt) { http_response_code(404); exit; }
layout_start('Message received');
echo '<section class="confirmation"><p class="eyebrow">MESSAGE RECEIVED</p><h1>Thank you for<br><em>getting in touch.</em></h1><p>Your message has been saved for our team. Your reference is <strong>' . h($reference) . '</strong>.</p><p>This inbox is not monitored for emergencies. For urgent care, visit the clinic. Do not wait for an online reply. Walk-ins are welcome; no booking is needed.</p><div class="actions"><button type="button" class="button secondary" data-copy-reference="' . h($reference) . '">Copy reference</button><a class="button" href="mailto:' . h('info@mweinmedical.co.ke') . '?subject=Enquiry%20' . h($reference) . '">Follow up by email</a><a href="https://wa.me/254707711888?text=' . rawurlencode("Hello, I am following up on website enquiry ".$reference) . '">Follow up by WhatsApp</a></div><p>Keep this reference for follow-up. This confirms receipt, not an appointment.</p><a href="/contact.html">Back to contact</a></section>';
echo '<script src="/assets/site.js?v=ux02" defer></script>';layout_end();
