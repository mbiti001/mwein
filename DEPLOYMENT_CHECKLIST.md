# 🏗️ Mwein Medical - Architecture & Deployment Checklist

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSERS                             │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │         Mwein Medical Website                        │       │
│  │  (HTML/CSS/JavaScript)                               │       │
│  │                                                      │       │
│  │  - index.html (homepage)                            │       │
│  │  - services.html, appointments.html, etc            │       │
│  │  - js/main.js (analytics tracking)                  │       │
│  │  - css/style.css (animations & styles)              │       │
│  └──────────────────────────────────────────────────────┘       │
│                          │                                       │
│                 Automatic tracking                               │
│                 (page visits, clicks,                            │
│                  form submissions)                               │
│                          ▼                                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    INTERNET / NETWORK                            │
│                                                                   │
│  HTTPS Requests → https://mweinmedical.co.ke/...                │
│  Analytics → https://api.mweinmedical.co.ke/api/track/...       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   SAFARICOM cPanel HOSTING                       │
│                   (mweinmedical.co.ke)                           │
│                                                                   │
│  ┌──────────────────┐      ┌──────────────────────────────────┐ │
│  │ Frontend Files   │      │   Backend (Node.js)             │ │
│  │                  │      │                                  │ │
│  │ /public_html/    │      │ /home/mweinmed/backend/         │ │
│  │ - index.html     │      │                                  │ │
│  │ - css/style.css  │      │ ┌────────────────────────────┐  │ │
│  │ - js/main.js     │      │ │ server.js                  │  │ │
│  │ - assets/        │      │ │ (Express.js)               │  │ │
│  │ - shop.html      │      │ │                            │  │ │
│  └──────────────────┘      │ ├────────────────────────────┤  │ │
│                            │ │ API Routes:                │  │ │
│                            │ │ POST /api/track/visitor    │  │ │
│                            │ │ POST /api/track/action     │  │ │
│                            │ │ POST /api/track/form-sub   │  │ │
│                            │ │ GET /api/analytics/*       │  │ │
│                            │ │ POST /api/auth/login       │  │ │
│                            │ │ POST /api/auth/register    │  │ │
│                            │ │                            │  │ │
│                            │ ├────────────────────────────┤  │ │
│                            │ │ SQLite Database            │  │ │
│                            │ │ data/mwein-analytics.db    │  │ │
│                            │ │                            │  │ │
│                            │ │ Tables:                    │  │ │
│                            │ │ - admins                   │  │ │
│                            │ │ - visitors                 │  │ │
│                            │ │ - page_views               │  │ │
│                            │ │ - user_actions             │  │ │
│                            │ │ - form_submissions         │  │ │
│                            │ └────────────────────────────┘  │ │
│                            │                                  │ │
│                            │ ┌────────────────────────────┐  │ │
│                            │ │ Admin Dashboard            │  │ │
│                            │ │ admin-dashboard.html       │  │ │
│                            │ │ admin-login.html           │  │ │
│                            │ └────────────────────────────┘  │ │
│                            └──────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   ADMIN DEVICE (Your Computer)                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │        Admin Dashboard (Browser)                     │       │
│  │        https://api.mweinmedical.co.ke/admin          │       │
│  │                                                      │       │
│  │  Login → View Analytics:                            │       │
│  │  - Total Visitors (today/week/month)                │       │
│  │  - Page Views Breakdown                            │       │
│  │  - Recent Visitors (IP, Location)                   │       │
│  │  - User Actions (clicks, interactions)              │       │
│  │  - Form Submissions (emails, inquiries)             │       │
│  │  - Device/Browser Statistics                        │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Deployment Checklist

### ✅ Phase 1: Frontend Preparation
- [x] Website modernization complete (HTML/CSS/JS)
- [x] CSS beautification with animations
- [x] Dark mode persistence
- [x] Mobile responsive design
- [x] CSV product import/export
- [x] Accessibility improvements (ARIA)
- [x] Meta tags & SEO optimization

### ✅ Phase 2: Backend Development
- [x] Node.js/Express server created
- [x] SQLite database schema designed
- [x] Admin authentication (JWT)
- [x] Analytics API endpoints
- [x] Visitor tracking system
- [x] User action logging
- [x] Form submission tracking
- [x] Admin dashboard UI

### 🔲 Phase 3: Local Testing (DO THIS FIRST)
- [ ] Install Node.js
- [ ] Navigate to `backend/` directory
- [ ] Run `npm install`
- [ ] Run `npm start`
- [ ] Register admin account
- [ ] Test analytics tracking
- [ ] Verify dashboard displays data
- [ ] Test all API endpoints

**→ Follow BACKEND/QUICK_START.md for detailed steps**

### 🔲 Phase 4: Production Deployment (Then Deploy)
- [ ] Contact Safaricom to verify Node.js support
- [ ] Access cPanel with credentials
- [ ] Create NodeJS application in cPanel
- [ ] Upload backend files via FTP
- [ ] Run `npm install --production`
- [ ] Create data directory with proper permissions
- [ ] Update `.env` with production settings
- [ ] Configure SSL/HTTPS certificate
- [ ] Set up subdomain (optional): `api.mweinmedical.co.ke`
- [ ] Update frontend to use production API URL
- [ ] Test endpoints with curl from production
- [ ] Monitor for errors in logs

**→ Follow BACKEND/DEPLOYMENT_GUIDE.md for detailed steps**

### 🔲 Phase 5: Frontend Update
- [ ] Update `js/main.js` API endpoint:
  ```javascript
  // Change from:
  const ANALYTICS_API = 'http://localhost:3000/api/track';
  // To:
  const ANALYTICS_API = 'https://api.mweinmedical.co.ke/api/track';
  ```
- [ ] Test tracking on live site
- [ ] Verify data appears in admin dashboard
- [ ] Check for CORS errors in browser console

### 🔲 Phase 6: Admin Access Setup
- [ ] Register primary admin account
- [ ] Secure `.env` file (never expose JWT_SECRET)
- [ ] Change default admin password
- [ ] Create additional admin accounts if needed
- [ ] Test login from different devices
- [ ] Bookmark admin dashboard URL
- [ ] Set reminder to review analytics weekly

### 🔲 Phase 7: Monitoring & Maintenance
- [ ] Setup daily analytics review routine
- [ ] Configure database backups (weekly)
- [ ] Monitor server logs for errors
- [ ] Track visitor trends over time
- [ ] Analyze popular pages and content
- [ ] Follow up on form submissions (leads)
- [ ] Update content based on user behavior

---

## 🎯 Quick Deployment Timeline

### If Node.js IS Available on Safaricom:
**Total Time: ~2 hours**
1. Local testing: 30 minutes
2. Upload to cPanel: 15 minutes
3. Configure environment: 15 minutes
4. Test production: 30 minutes
5. Go live: 5 minutes

### If Node.js NOT Available:
**Total Time: ~1 hour**
1. Setup Firebase Functions: 30 minutes
2. Deploy backend to Firebase: 15 minutes
3. Update frontend API URL: 10 minutes
4. Go live: 5 minutes

---

## 🔑 Important Credentials & Paths

```
SAFARICOM CPANEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Host: mweinmedical.co.ke:2083
User: mweinmed
Password: [YOUR_PASSWORD]

WEBSITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Frontend: https://mweinmedical.co.ke
Backend API: https://api.mweinmedical.co.ke
Admin Panel: https://api.mweinmedical.co.ke/admin-login.html

GITHUB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Repo: https://github.com/mbiti001/mwein
Branch: main
```

---

## 📁 File Locations

```
Frontend Files (Safaricom /public_html/)
├── index.html
├── services.html
├── appointments.html
├── contact.html
├── shop.html
├── css/
│   └── style.css ← INCLUDES: animations, transitions
├── js/
│   └── main.js ← INCLUDES: analytics tracker
├── blog/
├── assets/
│   ├── favicons/
│   └── images/
└── backend/ ← Backend folder

Backend Files (Safaricom /home/mweinmed/backend/)
├── server.js ← Main API server
├── package.json ← Dependencies
├── .env ← Configuration
├── admin-dashboard.html ← Admin UI
├── admin-login.html ← Login page
├── tracker.js ← Tracker script
├── data/
│   └── mwein-analytics.db ← SQLite database
└── README.md ← API docs
```

---

## 🚨 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| **Backend won't start** | Node.js not installed | Install Node.js from nodejs.org |
| **CORS errors** | Frontend calling wrong URL | Update ANALYTICS_API in js/main.js |
| **Port already in use** | Another process on port 3000 | Change PORT in .env or kill process |
| **Admin login fails** | No admin account registered | Register via "Create account" button |
| **No data in dashboard** | Tracking not enabled | Verify tracker is loading in browser |
| **Database errors** | File permissions | Run `chmod 755 data/` |
| **Safaricom says no Node.js** | Hosting limitation | Use Firebase/Vercel alternative |

---

## 📞 When Things Go Wrong

### Step 1: Check Logs
```bash
# SSH into server
ssh mweinmed@mweinmedical.co.ke

# View Node.js logs
tail -f logs/server.log

# Or with PM2:
pm2 logs mwein-backend
```

### Step 2: Verify Connectivity
```bash
# Test backend is running
curl https://api.mweinmedical.co.ke/api/analytics/dashboard

# Test from browser console
fetch('https://api.mweinmedical.co.ke/api/track/visitor', {
    method: 'POST',
    body: JSON.stringify({page_url: '/test'})
})
```

### Step 3: Reset Everything
```bash
# Restart server
pm2 restart mwein-backend

# Or delete and restart
rm data/mwein-analytics.db
npm start
```

---

## 🎉 Success Criteria

Your deployment is successful when:

✅ Frontend loads at https://mweinmedical.co.ke  
✅ Admin login page accessible at https://api.mweinmedical.co.ke/admin-login.html  
✅ Can register admin account  
✅ Can login to admin dashboard  
✅ Admin dashboard shows "Total Visitors" > 0  
✅ Clicking buttons generates data in "Recent Actions"  
✅ Submitting forms generates data in "Form Submissions"  
✅ Page view counts increase as pages are visited  
✅ No CORS errors in browser console  
✅ All metrics updating in real-time  

---

## 📚 Next Actions

1. **Read** `BACKEND/QUICK_START.md` for local testing
2. **Test** backend locally on your machine
3. **Read** `BACKEND/DEPLOYMENT_GUIDE.md` for production
4. **Verify** Node.js support with Safaricom
5. **Deploy** backend to production
6. **Update** frontend API URLs
7. **Go Live** with analytics tracking
8. **Monitor** your first day of data

Ready? Start with **BACKEND/QUICK_START.md** → 🚀
