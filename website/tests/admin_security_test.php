<?php
require dirname(__DIR__).'/site/api/common.php';
set_exception_handler(function(Throwable $e): void {fwrite(STDERR,$e->getMessage()."\n");exit(1);});
function expect(bool $condition,string $name): void {if(!$condition)throw new RuntimeException($name);}
$key='12345678901234567890';
// RFC 6238 Appendix B SHA-1 reference vectors, including dates beyond 2038.
foreach([59=>'94287082',1111111109=>'07081804',1111111111=>'14050471',1234567890=>'89005924',2000000000=>'69279037',20000000000=>'65353130'] as $time=>$code) {
    expect(admin_totp($key,intdiv($time,30),8)===$code,'RFC vector '.$time);
}
expect(admin_base32($key)==='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ','Base32 setup key');
$counter=intdiv(1234567890,30);$code=admin_totp($key,$counter);
expect(admin_totp_counter($key,$code,1234567890)===$counter,'Current time step');
expect(admin_totp_counter($key,admin_totp($key,$counter-1),1234567890)===$counter-1,'Previous time step');
expect(admin_totp_counter($key,admin_totp($key,$counter+1),1234567890)===$counter+1,'Next time step');
expect(admin_totp_counter($key,admin_totp($key,$counter-2),1234567890)===null,'Reject outside time window');
foreach(['','12345','1234567','<script>','12345x'] as $bad)expect(admin_totp_counter($key,$bad,1234567890)===null,'Malformed code');
echo "Authenticator RFC vectors, Base32, time-window and malformed-code checks passed.\n";
