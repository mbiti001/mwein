"""Real HTTP/database tests. Run: PHP_BIN=/path/to/php python3 tests/backend_test.py"""
import os, re, sqlite3, subprocess, tempfile, time, unittest, urllib.request, urllib.parse, urllib.error, http.cookiejar, socket
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PHP = os.environ.get('PHP_BIN', 'php')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
class WebsiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='mwein-website-test-')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); cls.port = sock.getsockname()[1]
        cls.origin = f'http://127.0.0.1:{cls.port}'
        cls.password = ' Test-only password 917! '
        setup = subprocess.run([PHP, str(ROOT/'tools/setup.php'), cls.tmp.name, cls.origin, 'admin@example.test'], input=cls.password+'\n', text=True, capture_output=True)
        assert 'created' in setup.stdout, setup.stdout + setup.stderr
        cls.mail_dir=Path(cls.tmp.name)/'mail'; cls.mail_dir.mkdir()
        env = dict(os.environ, MWEIN_WEB_CONFIG=cls.tmp.name+'/config.php', MWEIN_TEST_MAIL_DIR=str(cls.mail_dir))
        cls.logs = open(cls.tmp.name+'/server.log', 'w+')
        cls.server = subprocess.Popen([PHP, '-S', f'127.0.0.1:{cls.port}', '-t', str(ROOT/'site')], env=env, stdout=cls.logs, stderr=cls.logs)
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.origin+'/contact.html'); break
            except OSError: time.sleep(.1)
        cls.store = sqlite3.connect(cls.tmp.name+'/website.sqlite')
    @classmethod
    def tearDownClass(cls):
        cls.server.terminate(); cls.server.wait(); cls.store.close(); cls.logs.close(); cls.tmp.cleanup()
    def setUp(self):
        self.store.execute('DELETE FROM limits'); self.store.commit()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect())
    def req(self, path, data=None, origin=None, extra=None):
        headers={'Origin':origin or self.origin, **(extra or {})}
        req=urllib.request.Request(self.origin+path, data=None if data is None else urllib.parse.urlencode(data).encode(), headers=headers)
        try: response=self.client.open(req)
        except urllib.error.HTTPError as e: response=e
        return response.code, response.read().decode(), response.headers
    def login(self):
        code, text, headers = self.req('/manage/login.php'); self.assertEqual(code,200)
        if headers['Set-Cookie']:
            self.assertIn('HttpOnly',headers['Set-Cookie']); self.assertIn('SameSite=Strict',headers['Set-Cookie'])
        csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        code, text, headers=self.req('/manage/login.php', {'csrf':csrf,'email':'admin@example.test','password':self.password})
        self.assertEqual(code,303,text)
        return self.req('/manage/')[1]
    def payload(self): return {'name':'Test visitor','contact':'visitor@example.test','category':'General enquiry','message':'Please explain your opening hours.','consent':'yes','website':''}
    def test_unique_sessions_consent_and_privacy(self):
        self.assertEqual(self.req('/api/visit.php',{'path':'/'})[0],204)
        self.assertNotIn('mwein_visitor',str(self.req('/api/visit.php',{'path':'/'})[2]))
        payload={'path':'/','consent':'yes','referrer':'https://www.google.com/search?q=private'}
        code,_,headers=self.req('/api/visit.php',payload);self.assertEqual(code,204)
        self.assertIn('mwein_visitor',str(headers))
        self.req('/api/visit.php',payload)
        self.assertEqual(self.store.execute('SELECT count(*) FROM analytics_visitors').fetchone()[0],1)
        self.assertEqual(self.store.execute('SELECT count(*),sum(views) FROM analytics_sessions').fetchone(),(1,2))
        self.assertEqual(self.store.execute('SELECT source FROM analytics_sessions').fetchone()[0],'www.google.com')
        self.store.execute('UPDATE analytics_sessions SET last_seen=last_seen-1900');self.store.commit()
        self.req('/api/visit.php',payload)
        self.assertEqual(self.store.execute('SELECT count(*) FROM analytics_sessions').fetchone()[0],2)
        for extra in [{'DNT':'1'},{'Sec-GPC':'1'},{'User-Agent':'ExampleBot'}]:self.req('/api/visit.php',payload,extra=extra)
        self.assertEqual(self.store.execute('SELECT sum(views) FROM analytics_sessions').fetchone()[0],3)
        self.assertIn('expires=',str(self.req('/api/visit.php',{'forget':'yes'})[2]))
        self.assertEqual(self.req('/manage/analytics.php')[0],303)
        self.login();self.assertIn('Unique browsers',self.req('/manage/analytics.php')[1])
    def test_local_country_lookup(self):
        import ipaddress
        geo=Path(self.tmp.name)/'geo';geo.mkdir(exist_ok=True)
        for version,first,last in [(4,'8.8.8.0','8.8.8.255'),(6,'2001:4860::','2001:4860:ffff:ffff:ffff:ffff:ffff:ffff')]:
            (geo/f'country-v{version}.bin').write_bytes(ipaddress.ip_address(first).packed+ipaddress.ip_address(last).packed+b'US')
        script=Path(self.tmp.name)/'geo-test.php'
        script.write_text("<?php require $argv[1]; echo country_for_ip('8.8.8.8').'|'.country_for_ip('2001:4860::8888').'|'.country_for_ip('127.0.0.1').'|'.country_for_ip('bad');")
        result=subprocess.run([PHP,str(script),str(ROOT/'site/api/analytics.php')],env=dict(os.environ,MWEIN_WEB_CONFIG=self.tmp.name+'/config.php'),capture_output=True,text=True)
        self.assertEqual(result.stdout,'US|US|Unknown|Unknown')
    def test_internal_browser_exclusion_and_logout(self):
        self.req('/api/visit.php',{'path':'/','consent':'yes'})
        before=self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0]
        text=self.login();csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        self.assertIn('Unique visitors today',text)
        for path in ['/', '/services.html']:
            code,_,headers=self.req('/api/visit.php',{'path':path,'consent':'yes'})
            self.assertEqual(code,204);self.assertEqual(headers['X-Mwein-Analytics'],'excluded')
        self.req('/manage/logout.php',{'csrf':csrf})
        self.assertEqual(self.req('/api/visit.php',{'path':'/','consent':'yes'})[2]['X-Mwein-Analytics'],'excluded')
        self.assertEqual(self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0],before)
        self.assertEqual(self.req('/manage/')[0],303) # Exclusion is never an authentication credential.
        self.store.execute('DELETE FROM analytics_sessions');self.store.execute('DELETE FROM analytics_visitors');self.store.commit()
    def test_consent_identifies_current_visit_without_double_pageview(self):
        self.req('/api/visit.php',{'path':'/'})
        before=self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0]
        self.req('/api/visit.php',{'path':'/','consent':'yes','identify_only':'yes'})
        self.assertEqual(self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0],before)
        self.req('/api/visit.php',{'path':'/services.html','consent':'yes'})
        self.assertEqual(self.store.execute('SELECT COUNT(DISTINCT visitor) FROM analytics_sessions').fetchone()[0],1)
        # A forged marker cannot silently suppress a visitor.
        self.req('/api/visit.php',{'path':'/','consent':'yes'},extra={'Cookie':'mwein_internal=9999999999.'+'0'*64})
        self.assertEqual(self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0],before+2)
        self.store.execute('DELETE FROM analytics_sessions');self.store.execute('DELETE FROM analytics_visitors');self.store.commit()
    def test_archive_analytics_preserves_totals_and_business_data(self):
        self.req('/api/visit.php',{'path':'/','consent':'yes'})
        self.req('/api/message.php',self.payload())
        before=self.store.execute('SELECT COALESCE(SUM(count),0) FROM views').fetchone()[0]
        messages=self.store.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        self.login();_,text,_=self.req('/manage/analytics.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        self.assertEqual(self.req('/manage/analytics.php',{'action':'archive','csrf':'wrong'})[0],403)
        self.assertEqual(self.req('/manage/analytics.php',{'action':'archive','csrf':csrf})[0],303)
        import json
        row=self.store.execute('SELECT summary,backup FROM analytics_archives ORDER BY id DESC LIMIT 1').fetchone()
        self.assertEqual(json.loads(row[0])['page_views'],before)
        self.assertTrue((Path(self.tmp.name)/'backups'/row[1]/'website.sqlite').exists())
        for table in ['views','analytics_visitors','analytics_sessions']:self.assertEqual(self.store.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
        self.assertEqual(self.store.execute('SELECT COUNT(*) FROM messages').fetchone()[0],messages)
        self.assertIn('Previous counting periods',self.req('/manage/analytics.php')[1])
        self.assertEqual(self.req('/manage/analytics.php',{'action':'archive','csrf':csrf})[0],429)
    def test_content_publish_draft_links_and_media(self):
        self.assertEqual(self.req('/manage/posts.php')[0],303)
        self.login()
        _,text,_=self.req('/manage/post.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        data={'csrf':csrf,'version':'0','action':'draft','title':'Test facility update','summary':'Project summary','body':'## Test heading\n\n<script>alert(1)</script> Important news.','category':'Updates','links':'Watch | https://www.youtube.com/watch?v=abcdefghijk'}
        self.assertEqual(self.req('/manage/post.php',data|{'csrf':'wrong'})[0],403)
        self.assertEqual(self.req('/manage/post.php',data|{'links':'Bad | javascript:alert(1)'})[0],422)
        code,_,headers=self.req('/manage/post.php',data);self.assertEqual(code,303)
        id=int(re.search(r'id=(\d+)',headers['Location'])[1]);path='/manage/post.php?id='+str(id)
        self.assertEqual(self.req('/blog.php?id='+str(id))[0],404)
        self.assertNotIn('blog.php?id='+str(id)+'</loc>',self.req('/sitemap.php')[1])
        self.assertNotIn('Test facility update',self.req('/api/latest.php')[1])
        self.assertIn('&lt;script&gt;',self.req('/manage/preview.php?id='+str(id))[1])
        self.assertEqual(self.req(path,data|{'version':'1','action':'publish'})[0],303)
        public=self.req('/blog.php?id='+str(id))[1]
        self.assertIn('data-video="abcdefghijk"',public);self.assertNotIn('<iframe',public);self.assertIn('og:type" content="article',public)
        self.assertIn('Test facility update',self.req('/api/latest.php')[1]);self.assertIn('blog.php?id='+str(id)+'</loc>',self.req('/sitemap.php')[1])
        self.assertEqual(self.req('/api/visit.php',{'path':'post:'+str(id),'consent':'no'})[0],204)
        self.assertEqual(self.req('/api/visit.php',{'path':'post:99999999','consent':'no'})[0],400)
        self.assertEqual(self.req('/api/message.php',self.payload()|{'source':'post:'+str(id)})[0],303)
        self.assertEqual(self.store.execute('SELECT count FROM enquiry_sources WHERE source=?',('post:'+str(id),)).fetchone()[0],1)
        self.assertIn('Test facility update',public);self.assertNotIn('<script>alert(1)',public);self.assertIn('noopener noreferrer',public)
        self.assertEqual(self.req(path,data|{'version':'1','action':'publish'})[0],422)
        self.assertEqual(self.req(path,data|{'version':'2','title':'Unpublished edit'})[0],303)
        self.assertNotIn('Unpublished edit',self.req('/blog.php?id='+str(id))[1])
        self.assertIn('Unpublished edit',self.req('/manage/preview.php?id='+str(id))[1])
        self.assertEqual(self.req(path,data|{'version':'3','action':'unpublish'})[0],303)
        self.assertEqual(self.req('/blog.php?id='+str(id))[0],404)
        self.assertIn('No updates match',self.req('/blog.php?q=not-found-xyz')[1])
        # Real multipart upload: server must validate and re-encode image data.
        _,text,_=self.req('/manage/media.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        import base64
        image=(ROOT/'site/assets/mwein-wordmark.png').read_bytes()
        def upload(blob,filename):
            boundary='MweinTestBoundary'
            body=(f'--{boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n{csrf}\r\n--{boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\nTest graphic\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode()+blob+f'\r\n--{boundary}--\r\n'.encode()
            request=urllib.request.Request(self.origin+'/manage/media.php',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
            try: response=self.client.open(request)
            except urllib.error.HTTPError as e:response=e
            return response.code,response.read()
        self.assertEqual(upload(b'<?php echo 1; ?>','evil.png')[0],422)
        result=upload(image,'test.png');self.assertEqual(result[0],303,result[1])
        mid=self.store.execute('SELECT max(id) FROM media').fetchone()[0]
        self.assertEqual(self.req('/media.php?id='+str(mid))[0],404)
        data['images[]']=str(mid);data['cover']=str(mid);data['captions['+str(mid)+']']='A <safe> caption'
        data['body']='## News heading\n\n**Important** update\n\n- First item\n- Second item'
        self.assertEqual(self.req(path,data|{'version':'4','action':'publish'})[0],303)
        rendered=self.req('/blog.php?id='+str(id))[1];self.assertIn('A &lt;safe&gt; caption',rendered);self.assertIn('<strong>Important</strong>',rendered);self.assertIn('<li>First item</li>',rendered);self.assertIn('og:image" content="'+self.origin+'/media.php?id='+str(mid),rendered)
        response=self.client.open(self.origin+'/media.php?id='+str(mid));self.assertEqual(response.headers['Content-Type'],'image/jpeg');self.assertTrue(response.read().startswith(bytes([255,216])))
        self.assertEqual(self.req('/manage/maintenance.php',{'csrf':csrf,'action':'backup'})[0],303)
        import json
        report=json.loads((Path(self.tmp.name)/'backup-status.json').read_text());self.assertEqual(len(report['media_sha256']),1)
    def test_backup_restore_and_access(self):
        self.assertEqual(self.req('/manage/maintenance.php')[0],303)
        self.login()
        _,text,_=self.req('/manage/maintenance.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        self.assertEqual(self.req('/manage/maintenance.php',{'csrf':'bad','action':'backup'})[0],403)
        self.assertEqual(self.req('/manage/maintenance.php',{'csrf':csrf,'action':'backup'})[0],303)
        import json
        report=json.loads((Path(self.tmp.name)/'backup-status.json').read_text())
        folder=Path(self.tmp.name)/'backups'/report['snapshot']
        restored=sqlite3.connect(folder/'website.sqlite')
        self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(restored.execute('SELECT count(*) FROM messages').fetchone()[0],report['counts']['messages'])
        restored.close()
        self.assertEqual((folder/'config.php').read_bytes(),(Path(self.tmp.name)/'config.php').read_bytes())
    def test_new_enquiry_alert_and_failure(self):
        import json
        before=set(self.mail_dir.iterdir())
        self.assertEqual(self.req('/api/message.php',self.payload())[0],303)
        sent=list(set(self.mail_dir.iterdir())-before);self.assertEqual(len(sent),1)
        mail=json.loads(sent[0].read_text())
        self.assertEqual(mail['to'],'admin@example.test')
        self.assertEqual(mail['from'],'info@mweinmedical.co.ke')
        self.assertNotIn('visitor@example.test',mail['body']);self.assertNotIn(self.payload()['message'],mail['body'])
        moved=self.mail_dir.with_name('alerts-offline');self.mail_dir.rename(moved)
        try:self.assertEqual(self.req('/api/message.php',self.payload())[0],303)
        finally:moved.rename(self.mail_dir)
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.assertEqual(self.store.execute('SELECT state FROM notifications WHERE message_id=?',(id,)).fetchone()[0],'failed')
        self.login();_,text,_=self.req('/manage/maintenance.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        before=set(self.mail_dir.iterdir())
        self.assertEqual(self.req('/manage/maintenance.php',{'csrf':csrf,'action':'retry'})[0],303)
        self.assertEqual(self.req('/manage/maintenance.php',{'csrf':csrf,'action':'retry'})[0],303)
        self.assertEqual(len(set(self.mail_dir.iterdir())-before),1)
    def test_password_byte_limit(self):
        self.login();_,text,_=self.req('/manage/settings.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        original=(Path(self.tmp.name)/'config.php').read_bytes()
        for password in ['a'*73,'é'*37]:
            result=self.req('/manage/settings.php',{'csrf':csrf,'current':self.password,'password':password,'confirmation':password})
            self.assertIn('16–72 bytes',result[1])
            self.assertEqual((Path(self.tmp.name)/'config.php').read_bytes(),original)
        for script in ['setup.php','reset-password.php']:
            args=[PHP,str(ROOT/'tools'/script)]
            args+= [self.tmp.name+'/too-long',self.origin,'admin@example.test'] if script=='setup.php' else [self.tmp.name+'/config.php']
            subprocess.run(args,input='a'*73+'\n',text=True,capture_output=True)
            self.assertEqual((Path(self.tmp.name)/'config.php').read_bytes(),original)
        password='a'*72
        try:
            self.assertEqual(self.req('/manage/settings.php',{'csrf':csrf,'current':self.password,'password':password,'confirmation':password})[0],303)
            self.assertEqual(self.req('/manage/')[0],303)
        finally:(Path(self.tmp.name)/'config.php').write_bytes(original)
    def test_message_persistence_and_receipt(self):
        code,text,headers=self.req('/api/message.php', self.payload()); self.assertEqual(code,303,text)
        self.assertEqual(self.req(headers['Location'])[0],200)
        self.assertEqual(self.store.execute('SELECT name FROM messages ORDER BY id DESC').fetchone()[0], 'Test visitor')
        self.assertEqual(self.req('/message-received.php?ref=000000000000')[0],404)
    def test_receipt_routing_and_mixed_list_text(self):
        for category,email in [('General enquiry','info@mweinmedical.co.ke'),('Official correspondence','info@mweinmedical.co.ke'),('Partnership or support','info@mweinmedical.co.ke')]:
            code,_,headers=self.req('/api/message.php',self.payload()|{'category':category})
            self.assertEqual(code,303)
            receipt=self.req(headers['Location'])[1]
            self.assertIn('mailto:'+email+'?subject=',receipt)
            self.assertNotIn('admin@mweinmedical.co.ke',receipt)
            self.assertIn('favicon-16.png?v=mwein-tab02',receipt)
        result=subprocess.run([PHP,'-r',"require $argv[1]; echo content_body(\"- One point\\nKeep this sentence intact.\");",str(ROOT/'site/api/content.php')],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Keep this sentence intact.',result.stdout)
        self.assertNotIn('<li>ep',result.stdout)
    def test_one_time_setup(self):
        import hashlib
        path=Path(self.tmp.name)/'config.php'
        original=path.read_text()
        token='test-bootstrap-token'
        script="<?php $p=$argv[1]; $c=require $p; $c['setup_token_hash']=$argv[2]; $c['setup_expires']=time()+3600; file_put_contents($p, '<?php return '.var_export($c,true).';');"
        installer=Path(self.tmp.name)/'bootstrap.php'; installer.write_text(script)
        subprocess.run([PHP,str(installer),str(path),hashlib.sha256(token.encode()).hexdigest()],check=True)
        try:
            _,text,_=self.req('/manage/setup.php'); csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
            self.assertEqual(self.req('/manage/setup.php',{'csrf':csrf,'action':'unlock','code':'wrong'})[0],403)
            self.assertEqual(self.req('/manage/setup.php',{'csrf':csrf,'action':'unlock','code':token})[0],303)
            _,text,_=self.req('/manage/setup.php'); self.assertIn('Confirm password',text)
            self.assertEqual(self.req('/manage/setup.php',{'csrf':csrf,'action':'password','password':self.password,'confirmation':self.password})[0],303)
            self.assertEqual(self.req('/manage/setup.php')[0],404)
            self.assertNotIn('setup_token_hash',path.read_text())
        finally: path.write_text(original)
    def test_email_recovery_tokens(self):
        import json, hashlib
        original=(Path(self.tmp.name)/'config.php').read_text()
        self.store.execute('DELETE FROM password_resets');self.store.commit()
        before=set(self.mail_dir.iterdir())
        _,text,_=self.req('/manage/forgot.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        generic=self.req('/manage/forgot.php',{'csrf':csrf,'email':'unknown@example.test'})[1]
        self.assertEqual(set(self.mail_dir.iterdir()),before)
        known=self.req('/manage/forgot.php',{'csrf':csrf,'email':'admin@example.test'})[1]
        self.assertEqual(generic,known)
        sent=list(set(self.mail_dir.iterdir())-before);self.assertEqual(len(sent),1)
        mail=json.loads(sent[0].read_text());self.assertEqual(mail['from'],'admin@mweinmedical.co.ke');token=re.search('token=([a-f0-9]{64})',mail['body'])[1]
        self.assertNotIn(token,str(self.store.execute('SELECT * FROM password_resets').fetchall()))
        self.req('/manage/reset.php?token='+token)
        _,text,_=self.req('/manage/reset.php');self.assertIn('Confirm password',text)
        csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        self.assertEqual(self.req('/manage/reset.php',{'csrf':'bad','password':'A fresh test password 9!','confirmation':'A fresh test password 9!'})[0],403)
        try:
            self.assertEqual(self.req('/manage/reset.php',{'csrf':csrf,'password':'A fresh test password 9!','confirmation':'A fresh test password 9!'})[0],303)
            self.req('/manage/reset.php?token='+token)
            self.assertIn('invalid, expired or already used',self.req('/manage/reset.php')[1])
        finally:(Path(self.tmp.name)/'config.php').write_text(original)
        self.store.execute('UPDATE password_resets SET used=0,expires=0');self.store.commit()
        self.req('/manage/reset.php?token='+token)
        self.assertNotIn('Confirm password',self.req('/manage/reset.php')[1])
    def test_replies_notes_search_and_duplicate_send(self):
        import json
        self.req('/api/message.php',self.payload())
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.assertEqual(self.req('/manage/message.php?id='+str(id))[0],303)
        self.login(); path='/manage/message.php?id='+str(id)
        _,text,_=self.req(path);csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        keys=re.findall('name="request_key" value="([a-f0-9]+)"',text)
        payload={'csrf':csrf,'request_key':keys[1],'action':'reply','body':'Thank you. We are open 24 hours.'}
        before=set(self.mail_dir.iterdir())
        self.assertEqual(self.req(path,payload)[0],303)
        self.assertEqual(self.req(path,payload)[0],303)
        sent=list(set(self.mail_dir.iterdir())-before);self.assertEqual(len(sent),1)
        self.assertEqual(json.loads(sent[0].read_text())['to'],'visitor@example.test')
        self.assertEqual(json.loads(sent[0].read_text())['from'],'info@mweinmedical.co.ke')
        self.assertEqual(self.req(path,{'csrf':csrf,'request_key':keys[2],'action':'note','body':'<script>private note</script>'})[0],303)
        text=self.req(path)[1];self.assertIn('&lt;script&gt;private note',text);self.assertIn('Accepted by mail server',text)
        self.assertIn('Test visitor',self.req('/manage/?q=visitor%40example.test')[1])
        self.assertIn('No messages here yet',self.req('/manage/?q=unfindable-zz')[1])
        self.assertEqual(self.req('/manage/message.php?id=9999999')[0],404)
        _,text,_=self.req(path);key=re.findall('name="request_key" value="([a-f0-9]+)"',text)[0]
        self.assertEqual(self.req(path,{'csrf':csrf,'request_key':key,'action':'status','status':'spam'})[0],303)
        self.assertEqual(self.store.execute('SELECT status FROM messages WHERE id=?',(id,)).fetchone()[0],'spam')
    def test_mail_failure_and_phone_reply_guard(self):
        self.req('/api/message.php',self.payload())
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.login();path='/manage/message.php?id='+str(id)
        _,text,_=self.req(path);csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1];key=re.findall('name="request_key" value="([a-f0-9]+)"',text)[1]
        moved=self.mail_dir.with_name('mail-offline');self.mail_dir.rename(moved)
        try:
            result=self.req(path,{'csrf':csrf,'request_key':key,'action':'reply','body':'Test failure draft.'})
            self.assertIn('did not accept your reply',result[1])
            self.assertEqual(self.store.execute('SELECT delivery FROM activity WHERE request_key=?',(key,)).fetchone()[0],'failed')
        finally:moved.rename(self.mail_dir)
        self.req('/api/message.php',self.payload()|{'contact':'+254700000000'})
        phoneid=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        phonepath='/manage/message.php?id='+str(phoneid)
        _,text,_=self.req(phonepath);key=re.findall('name="request_key" value="([a-f0-9]+)"',text)[0]
        self.assertNotIn('Send email reply',text)
        self.assertEqual(self.req(phonepath,{'csrf':csrf,'request_key':key,'action':'reply','body':'Must not send'})[0],422)
    def test_official_reply_sender(self):
        import json
        self.req('/api/message.php',self.payload()|{'category':'Official correspondence'})
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.login();path='/manage/message.php?id='+str(id)
        _,text,_=self.req(path);csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1];key=re.findall('name="request_key" value="([a-f0-9]+)"',text)[1]
        before=set(self.mail_dir.iterdir())
        self.assertEqual(self.req(path,{'csrf':csrf,'request_key':key,'action':'reply','body':'Official test reply.'})[0],303)
        sent=list(set(self.mail_dir.iterdir())-before)
        self.assertEqual(json.loads(sent[0].read_text())['from'],'admin@mweinmedical.co.ke')
    def test_contact_hierarchy_and_whatsapp(self):
        for page in (ROOT/'site').glob('*.html'):
            self.assertNotIn('tel:',page.read_text(),str(page))
        text=(ROOT/'site/contact.html').read_text()
        self.assertLess(text.index('id="send-message"'),text.index('id="email-options"'))
        self.assertLess(text.index('id="email-options"'),text.index('ALTERNATIVE CONTACT'))
        self.assertIn('WhatsApp follow-up',text)
        self.assertNotIn('Call-back request',text)
        self.assertEqual(self.req('/api/message.php',self.payload()|{'contact':'0707711888','category':'WhatsApp follow-up'})[0],303)
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.login();text=self.req('/manage/message.php?id='+str(id))[1]
        self.assertIn('https://wa.me/254707711888',text)
        self.assertNotIn('tel:',text)
    def test_validation_origin_and_spam(self):
        self.assertEqual(self.req('/api/message.php')[0],405)
        self.assertEqual(self.req('/api/message.php',self.payload(),origin='https://evil.example')[0],403)
        for change in [{'contact':'bad'},{'consent':''},{'category':'invalid'},{'website':'spam'}]:
            self.assertEqual(self.req('/api/message.php', self.payload()|change)[0],422)
        self.assertEqual(self.req('/api/message.php',self.payload())[0],303)
        self.assertEqual(self.req('/api/message.php',self.payload())[0],429)
    def test_access_csrf_escape_status_logout(self):
        self.assertEqual(self.req('/manage/')[0],303)
        self.req('/api/message.php',self.payload()|{'name':'<script>alert(1)</script>'})
        text=self.login(); self.assertIn('&lt;script&gt;', text); self.assertNotIn('<script>alert(1)',text)
        csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        id=self.store.execute('SELECT max(id) FROM messages').fetchone()[0]
        self.assertEqual(self.req('/manage/', {'id':id,'status':'closed','csrf':'wrong'})[0],403)
        self.assertEqual(self.req('/manage/', {'id':id,'status':'closed','csrf':csrf})[0],303)
        self.assertEqual(self.store.execute('SELECT status FROM messages WHERE id=?',(id,)).fetchone()[0],'closed')
        self.assertEqual(self.req('/manage/?status=closed&page=999')[0],200)
        self.assertEqual(self.req('/manage/logout.php',{'csrf':csrf})[0],303)
        self.assertEqual(self.req('/manage/')[0],303)
    def test_login_throttle(self):
        _,text,_=self.req('/manage/login.php'); csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        for _ in range(8): self.assertEqual(self.req('/manage/login.php', {'csrf':csrf,'email':'admin@example.test','password':'wrong'})[0],401)
        self.assertEqual(self.req('/manage/login.php', {'csrf':csrf,'email':'admin@example.test','password':'wrong'})[0],429)
    def test_login_network_headers_and_account_limit(self):
        _,text,_=self.req('/manage/login.php'); csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        payload={'csrf':csrf,'email':'unknown@example.test','password':'wrong'}
        for i in range(8):
            self.assertEqual(self.req('/manage/login.php',payload,extra={'X-Forwarded-For':f'192.0.2.{i}'})[0],401)
        result=self.req('/manage/login.php',payload,extra={'X-Forwarded-For':'198.51.100.1'})
        self.assertEqual(result[0],429);self.assertEqual(result[2]['Retry-After'],'900')
        self.store.execute('DELETE FROM limits');self.store.commit()
        # Different source networks still share the single admin-account budget.
        script=Path(self.tmp.name)/'account-limit-test.php'
        script.write_text("<?php require $argv[1]; for($i=0;$i<40;$i++){$_SERVER['REMOTE_ADDR']='192.0.2.'.$i; if(limited('login-account',40,900,'website-admin'))exit(1);}")
        result=subprocess.run([PHP,str(script),str(ROOT/'site/api/common.php')],env=dict(os.environ,MWEIN_WEB_CONFIG=self.tmp.name+'/config.php'),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.req('/manage/login.php',payload)[0],429)
        self.assertEqual(self.req('/manage/login.php',payload|{'email':'admin@example.test','password':self.password})[0],429)
        self.store.execute('UPDATE limits SET expires=0');self.store.commit()
        self.assertIn('Website dashboard',self.login())
    def test_login_malformed_credentials_and_private_headers(self):
        _,text,headers=self.req('/manage/login.php');csrf=re.search('name="csrf" value="([a-f0-9]+)"',text)[1]
        self.assertEqual(headers['Referrer-Policy'],'no-referrer');self.assertIn('no-store',headers['Cache-Control'])
        for email,password in [('unknown@example.test','wrong'),('admin@example.test','wrong'),('admin@example.test','x'*100),('admin@example.test','bad\x00password')]:
            result=self.req('/manage/login.php',{'csrf':csrf,'email':email,'password':password})
            self.assertEqual(result[0],401);self.assertIn('The email or password is incorrect.',result[1])
        self.assertEqual(self.req('/manage/login.php',{'email':'admin@example.test','password':self.password})[0],403)
    def test_analytics_aggregation_privacy(self):
        self.store.execute('DELETE FROM views'); self.store.commit()
        for path in ['/', '/index.html', '/contact.html']:
            self.assertEqual(self.req('/api/visit.php',{'path':path})[0],204)
        for header in [{'DNT':'1'}, {'Sec-GPC':'1'}, {'User-Agent':'ExampleBot'}]:
            self.assertEqual(self.req('/api/visit.php',{'path':'/'},extra=header)[0],204)
        self.assertEqual(self.req('/api/visit.php',{'path':'/manage/'})[0],400)
        self.assertEqual(self.req('/api/visit.php',{'path':'/?secret=test'})[0],400)
        self.assertEqual(self.req('/api/visit.php',{'path':'/'},origin='https://evil.example')[0],403)
        self.assertEqual(self.store.execute('SELECT SUM(count) FROM views').fetchone()[0],3)
        self.assertEqual(self.store.execute("SELECT count FROM views WHERE path='/'").fetchone()[0],2)
        self.assertNotIn('127.0.0.1',str(self.store.execute('SELECT * FROM limits').fetchall()))
        self.assertIn('Most viewed pages',self.login())
    def test_password_reset_revokes_session(self):
        self.login()
        result=subprocess.run([PHP,str(ROOT/'tools/reset-password.php'),self.tmp.name+'/config.php'],input='A replacement password 927!\n',text=True,capture_output=True)
        self.assertIn('updated',result.stdout)
        self.assertEqual(self.req('/manage/')[0],303)
        subprocess.run([PHP,str(ROOT/'tools/reset-password.php'),self.tmp.name+'/config.php'],input=self.password+'\n',text=True,capture_output=True,check=True)

    def feedback_payload(self, kind='review', post_id=0):
        path='/reviews.php' if kind=='review' else '/blog.php?id='+str(post_id)
        code,text,_=self.req(path);self.assertEqual(code,200,text)
        token=re.search('name="token" value="([^"]+)"',text)[1]
        return {'kind':kind,'post_id':post_id,'token':token,'display_name':'Local visitor','body':'A useful visit, but the waiting time could improve.','rating':'1','experience':'yes','consent':'yes','website':''}
    def test_feedback_validation_moderation_replay_and_average(self):
        import json
        payload=self.feedback_payload()
        self.store.execute('DELETE FROM feedback');self.store.execute('DELETE FROM feedback_moderation');self.store.commit()
        self.assertEqual(self.req('/manage/feedback.php')[0],303)
        self.assertEqual(self.req('/feedback-submit.php',payload,origin='https://untrusted.test')[0],403)
        for change in [{'rating':'6'},{'rating':'0'},{'rating':'1.5'},{'consent':''},{'experience':''},{'website':'spam'},{'display_name':'x'},{'body':'short'},{'token':'bad'},{'post_id':3}]:
            self.store.execute('DELETE FROM limits');self.store.commit()
            self.assertEqual(self.req('/feedback-submit.php',{**payload,**change})[0],422,change)
        self.store.execute('DELETE FROM limits');self.store.commit()
        payload['display_name']='<script>alert(1)</script>'
        code,_,headers=self.req('/feedback-submit.php',payload);self.assertEqual(code,303);self.assertEqual(headers['Location'],'/feedback-received.php')
        self.assertEqual(self.req('/feedback-submit.php',payload)[0],303)
        self.assertEqual(self.store.execute('SELECT COUNT(*) FROM feedback').fetchone()[0],1)
        self.assertEqual(json.loads(self.req('/api/review-summary.php')[1]),{'count':0,'average':None})
        self.assertNotIn('waiting time',self.req('/reviews.php')[1])
        self.login();admin=self.req('/manage/feedback.php')[1]
        self.assertNotIn('<script>alert(1)</script>',admin);self.assertIn('&lt;script&gt;',admin)
        csrf=re.search('name="csrf" value="([a-f0-9]+)"',admin)[1]
        fid=self.store.execute('SELECT id FROM feedback').fetchone()[0]
        decision={'csrf':csrf,'id':fid,'version':1,'status':'approved','note':'Relevant critical feedback; privacy checked'}
        self.assertEqual(self.req('/manage/feedback.php',{**decision,'csrf':'wrong'})[0],403)
        self.assertEqual(self.req('/manage/feedback.php',decision)[0],303)
        self.assertEqual(self.req('/manage/feedback.php',decision)[0],409)
        public=self.req('/reviews.php')[1];self.assertIn('waiting time',public);self.assertNotIn('<script>alert(1)</script>',public)
        self.assertEqual(json.loads(self.req('/api/review-summary.php')[1]),{'count':1,'average':1})
        self.assertEqual(self.req('/manage/feedback.php',{**decision,'version':2,'status':'hidden','note':'Withdrawn at author request'})[0],303)
        self.assertEqual(json.loads(self.req('/api/review-summary.php')[1]),{'count':0,'average':None})
        self.assertEqual(self.store.execute('SELECT COUNT(*) FROM feedback_moderation WHERE feedback_id=?',(fid,)).fetchone()[0],2)
    def test_feedback_comment_isolation_unpublished_and_rate_limit(self):
        import json
        self.req('/reviews.php')
        self.store.execute('DELETE FROM feedback');self.store.execute('DELETE FROM feedback_moderation');self.store.commit()
        post={'title':'Comment test article','summary':'A test summary','body':'A published test article.','category':'News','links':'','media_ids':[]}
        self.store.execute('INSERT INTO posts(title,published,updated_at) VALUES(?,?,?)',(post['title'],json.dumps(post),'2026-09-27'))
        pid=self.store.execute('SELECT last_insert_rowid()').fetchone()[0];self.store.commit()
        payload=self.feedback_payload('comment',pid)
        self.assertEqual(self.req('/feedback-submit.php',{**payload,'post_id':pid+1})[0],422)
        self.assertEqual(self.req('/feedback-submit.php',payload)[0],303)
        self.assertNotIn('waiting time',self.req('/blog.php?id='+str(pid))[1])
        self.store.execute("UPDATE feedback SET status='approved'");self.store.commit()
        self.assertIn('waiting time',self.req('/blog.php?id='+str(pid))[1]);self.assertNotIn('waiting time',self.req('/reviews.php')[1])
        self.assertEqual(json.loads(self.req('/api/review-summary.php')[1])['count'],0)
        second=self.feedback_payload('comment',pid)
        self.store.execute('UPDATE posts SET published=NULL WHERE id=?',(pid,));self.store.commit()
        self.assertEqual(self.req('/feedback-submit.php',second)[0],404)
        self.assertEqual(self.req('/blog.php?id='+str(pid))[0],404)
        self.store.execute('DELETE FROM limits');self.store.commit()
        for _ in range(5):self.assertEqual(self.req('/feedback-submit.php',self.feedback_payload())[0],303)
        self.assertEqual(self.req('/feedback-submit.php',self.feedback_payload())[0],429)
        self.store.execute('DELETE FROM posts WHERE id=?',(pid,));self.store.commit()

    def test_confirmed_care_totals(self):
        import json
        code,body,_=self.req('/api/care-summary.php')
        self.assertEqual(code,200)
        self.assertEqual(json.loads(body),{'patients':6255,'encounters':13557,'recorded_on':'2026-09-27'})
        self.assertEqual(self.req('/manage/care-totals.php')[0],303)
        self.login()
        code,html,_=self.req('/manage/care-totals.php'); self.assertEqual(code,200)
        csrf=re.search('name="csrf" value="([a-f0-9]+)"',html)[1]
        payload={'csrf':csrf,'version':'1','patients':'6300','encounters':'13600','recorded_on':'2026-09-27','note':'Checked synthetic records <script>alert(1)</script>','confirmed':'yes'}
        self.assertEqual(self.req('/manage/care-totals.php',{**payload,'csrf':'bad'})[0],403)
        for extra in [{'patients':'-1'},{'patients':'1.5'},{'encounters':'1000000001'},{'recorded_on':'2099-01-01'},{'recorded_on':'2026-02-30'},{'confirmed':''},{'note':'no'}]:
            self.assertEqual(self.req('/manage/care-totals.php',{**payload,**extra})[0],422,extra)
        self.assertEqual(self.req('/manage/care-totals.php',payload)[0],303)
        self.assertEqual(json.loads(self.req('/api/care-summary.php')[1]),{'patients':6300,'encounters':13600,'recorded_on':'2026-09-27'})
        self.assertEqual(self.req('/manage/care-totals.php',payload)[0],409)
        html=self.req('/manage/care-totals.php')[1]
        self.assertNotIn('<script>alert(1)</script>',html);self.assertIn('&lt;script&gt;',html)
        self.assertIn('6,255',html);self.assertIn('6,300',html)
        # Legitimate downward corrections remain possible; the previous entry is retained.
        self.assertEqual(self.req('/manage/care-totals.php',{**payload,'version':'2','patients':'6255','encounters':'13557','note':'Corrected synthetic double-count'})[0],303)
        self.assertEqual(self.store.execute('SELECT COUNT(*) FROM care_totals_history').fetchone()[0],3)
        public=json.loads(self.req('/api/care-summary.php')[1]);self.assertNotIn('note',public);self.assertNotIn('actor',public)
        self.assertEqual(self.req('/api/care-summary.php',{})[0],405)

if __name__=='__main__': unittest.main(verbosity=2)
