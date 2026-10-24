<?php
function enquiry_services(): array {return ['Consultation / medical examination','Chronic illness care','Pharmacy / medicine refill','Family planning','Pregnancy / maternity care','Child health / vaccination','Laboratory testing','Ultrasound','Minor procedures','Screening / health education','Counselling','Home-based care','Other / not sure'];}
function service_select(string $selected=''): string {
 $html='<label for="enquiry-service">Service (optional)</label><select name="service" id="enquiry-service"><option value="">Choose a service, if relevant</option>';
 foreach(enquiry_services() as $s)$html.='<option'.($s===$selected?' selected':'').'>'.h($s).'</option>';
 return $html.'</select>';
}
