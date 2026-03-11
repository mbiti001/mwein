# 🚀 QUICK DEPLOYMENT CHECKLIST
**Mwein Medical Services Website**  
**Date:** March 12, 2026

---

## ⏱️ Quick Version (Do This First)

### ✅ Immediate Pre-Deployment (30 minutes)
```
□ Pull latest changes:  git pull origin main
□ View latest commits:  git log --oneline -5
□ Check for changes:    git status
□ All files committed:  git add -A && git commit -m "pre-deployment"
□ Push to remote:       git push origin main
```

### ✅ Final Testing (15 minutes)
```
□ Clear browser cache and test home page
□ Test mobile responsiveness (resize browser)
□ Test dark mode toggle (check persistence)
□ Test navigation on 3 different pages
□ Test form submissions (contact form)
□ Check all external links work
```

### ✅ Security Check (10 minutes)
```
□ Search for TODO comments:  grep -r "TODO" --include="*.html" --include="*.js"
□ Check for console.log:     grep -r "console.log" --include="*.js"
□ Verify no hardcoded secrets
□ Verify HTTPS configuration ready
□ Check favicon displays properly
```

### ✅ Deployment (5 minutes)
```
□ Verify FTP/cPanel access working
□ Backup existing website (if any)
□ Upload files to production
□ Verify all files uploaded correctly
□ Test production site works
□ Clear CDN cache (if applicable)
```

---

## 📋 Full Version (Click to Review)

### Pre-Deployment Testing

#### Page Functionality
- [ ] **index.html** - Homepage loads, hero section visible
- [ ] **services.html** - Service cards display properly
- [ ] **about.html** - About page loads, new page works
- [ ] **appointments.html** - Form renders, submit button works
- [ ] **contact.html** - Contact info displays, map embeds
- [ ] **blog.html** - Blog hub shows post links
- [ ] **insurers.html** - Insurance information displays
- [ ] **donations.html** - Donation amounts display, buttons work
- [ ] **shop.html** - Product grid displays properly

#### Design Elements
- [ ] CSS animations play smoothly
- [ ] Dark mode toggle works and persists
- [ ] Mobile menu responsive on small screens
- [ ] Font sizes readable on all devices
- [ ] Colors accessible (contrast ratio OK)
- [ ] Images load properly
- [ ] Favicon displays in tab

#### Browser Compatibility
- [ ] Google Chrome (latest)
- [ ] Mozilla Firefox (latest)
- [ ] Apple Safari (latest)
- [ ] Microsoft Edge (latest)
- [ ] Chrome Mobile (Android)
- [ ] Safari Mobile (iOS)

#### Performance
- [ ] Homepage loads in < 3 seconds
- [ ] No console errors
- [ ] No network errors
- [ ] Network requests < 500KB total
- [ ] Lighthouse score > 80

#### Accessibility
- [ ] Tab navigation works
- [ ] Screen reader compatible (test with VoiceOver)
- [ ] Keyboard navigation functional
- [ ] Color contrast sufficient
- [ ] Links descriptive (not "click here")

### File Upload Checklist

#### Frontend Files to Upload
```
□ index.html
□ about.html (NEW)
□ services.html
□ appointments.html
□ contact.html
□ blog.html
□ blog/post-1.html through post-7.html
□ insurers.html
□ donations.html
□ shop.html
□ privacy-policy.html
□ terms-of-service.html
□ patient-rights.html
□ quality.html
□ lab-result-print.html
□ referral-print.html
□ css/style.css
□ js/main.js
□ favicon.svg
□ any other assets in /assets/
```

#### Permissions to Set
```
□ HTML files: 644 (rw-r--r--)
□ CSS files: 644 (rw-r--r--)
□ JS files: 644 (rw-r--r--)
□ Directories: 755 (rwxr-xr-x)
□ .htaccess (if using): 644
```

#### Server Configuration
```
□ HTTPS/SSL certificate valid
□ Redirects HTTP to HTTPS
□ Gzip compression enabled
□ Proper cache headers set
□ 404 error page configured
□ Directory listing disabled
```

### Post-Deployment Testing

#### Smoke Tests
- [ ] Homepage loads successfully
- [ ] All navigation links work
- [ ] Forms are functional
- [ ] Images display properly
- [ ] Styling looks correct
- [ ] Mobile responsive works

#### Analytics (If applicable)
- [ ] Analytics tracking functional
- [ ] Admin dashboard accessible
- [ ] Visitor data collecting
- [ ] Page views tracking
- [ ] Form submissions logging

#### Monitoring Setup
- [ ] Error logs accessible
- [ ] Uptime monitoring configured
- [ ] Email alerts working
- [ ] Backup routine running
- [ ] Daily health check scheduled

---

## 🎯 Deployment Troubleshooting

### If CSS not loading
```bash
# Clear cache
curl -I https://mweinmedical.co.ke/css/style.css

# Check file exists on server
ls -la public_html/css/style.css

# Verify permissions
chmod 644 public_html/css/style.css
```

### If JavaScript not working
```bash
# Check browser console for errors
# Verify main.js loaded: 
curl https://mweinmedical.co.ke/js/main.js | head -20

# Check syntax errors:
node -c public_html/js/main.js
```

### If images missing
```bash
# Verify image directory exists
ls -la public_html/assets/

# Check file permissions
chmod 644 public_html/assets/*

# Verify image paths in HTML are relative
grep -n "src=" *.html
```

### If forms not working
```bash
# Verify form action URLs are correct
grep -n "form action" *.html

# Test form submission manually
curl -X POST https://mweinmedical.co.ke/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"test","email":"test@example.com"}'
```

---

## ✨ Post-Deployment Tasks

### Immediate (Day 1)
- [ ] Test website thoroughly on production
- [ ] Monitor error logs for issues
- [ ] Collect initial user feedback
- [ ] Verify analytics collecting data
- [ ] Update status on social media

### Short-term (Week 1)
- [ ] Monitor daily analytics
- [ ] Fix any reported bugs
- [ ] Optimize performance if needed
- [ ] Update documentation
- [ ] Brief team on new features

### Long-term (Ongoing)
- [ ] Review analytics weekly
- [ ] Monitor uptime dashboard
- [ ] Perform security audits monthly
- [ ] Update content as needed
- [ ] Plan next feature releases

---

## 🆘 Emergency Contacts

**If deployment fails:**

1. Check error logs first
2. Review recent git commits
3. Contact hosting provider
4. Prepare rollback plan
5. Document what went wrong

**Rollback Command:**
```bash
git reset --hard HEAD~1
git push --force origin main
```

---

## 📞 Quick Reference

| Task | Command |
|------|---------|
| View status | `git status` |
| View commits | `git log --oneline -10` |
| Push changes | `git push origin main` |
| Check file size | `du -sh .` |
| Count files | `find . -type f \| wc -l` |
| Test load | `curl -o /dev/null -s -w "%{time_total}s" https://mweinmedical.co.ke/` |

---

**Deployment Status:** ✅ Ready  
**Last Check:** March 12, 2026  
**Estimated Deployment Time:** 1-2 hours  

**Next Step:** Review this checklist with team, then proceed to deployment!
