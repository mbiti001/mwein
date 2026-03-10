# 🚀 Mwein Medical - Command Cheat Sheet

## Quick Reference Guide for Common Tasks

---

## 🏁 Getting Started (LOCAL DEVELOPMENT)

### 1. Clone Repository
```bash
git clone https://github.com/mbiti001/mwein.git
cd mwein
```

### 2. Install Node.js
Download from https://nodejs.org (LTS version)
Verify: `node --version` (should be 14+)

### 3. Setup Backend
```bash
cd backend
npm install
```

### 4. Start Backend Locally
```bash
npm start
# Server runs on http://localhost:3000
```

### 5. For Development (Auto-reload)
```bash
npm run dev
# Uses nodemon to auto-restart on changes
```

---

## 🔑 Admin Account Setup

### First Time Setup
1. Open browser: `http://localhost:3000/admin-login.html`
2. Click **"Create account"**
3. Enter: email, username, password
4. Click **Login**
5. Access dashboard

### Reset Password
```bash
# Delete old database
rm backend/data/mwein-analytics.db

# Restart server
npm start

# Create new account
```

---

## 📊 Testing Analytics

### Track Visitor
```bash
curl -X POST http://localhost:3000/api/track/visitor \
  -H "Content-Type: application/json" \
  -d '{
    "page_url": "/test",
    "referrer": "google.com",
    "user_agent": "Mozilla/5.0"
  }'
```

### Track Action
```bash
curl -X POST http://localhost:3000/api/track/action \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "button_click",
    "page": "/test",
    "details": {"button": "subscribe"}
  }'
```

### Track Form Submission
```bash
curl -X POST http://localhost:3000/api/track/form-submission \
  -H "Content-Type: application/json" \
  -d '{
    "form_name": "contact",
    "email": "user@example.com",
    "phone": "254700000000",
    "message": "Test message"
  }'
```

### Get Analytics (with token)
```bash
# First, login to get token from admin dashboard

curl -X GET http://localhost:3000/api/analytics/dashboard \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 🐛 Troubleshooting Commands

### Check Node.js Version
```bash
node --version
npm --version
```

### Kill Process on Port 3000
```bash
lsof -i :3000
kill -9 <PID>
```

### Clear npm Cache
```bash
npm cache clean --force
```

### Reinstall Dependencies
```bash
rm -rf node_modules package-lock.json
npm install
```

### View Database
```bash
sqlite3 backend/data/mwein-analytics.db
.tables                    # Show tables
SELECT * FROM visitors;    # View visitors
SELECT COUNT(*) FROM page_views;  # Count page views
.exit                      # Exit
```

### View Server Logs (with PM2)
```bash
pm2 logs mwein-backend
```

### Restart Server (with PM2)
```bash
pm2 restart mwein-backend
pm2 stop mwein-backend
pm2 start mwein-backend
```

---

## 🚀 Deployment Commands

### Deploy to Safaricom (SSH)
```bash
# SSH into server
ssh mweinmed@mweinmedical.co.ke

# Navigate to backend
cd ~/public_html/backend

# Install dependencies
npm install --production

# Start with PM2
npm install -g pm2
pm2 start server.js --name "mwein-backend"
pm2 startup
pm2 save
```

### Upload via FTP
```bash
# Using lftp (macOS)
lftp -u mweinmed,PASSWORD ftp.mweinmedical.co.ke
> cd public_html
> mirror -e backend/
> quit
```

### Upload via SFTP
```bash
sftp mweinmed@mweinmedical.co.ke
> put -r backend
> quit
```

---

## 🔐 Environment Setup

### Local .env
```
PORT=3000
JWT_SECRET=local-development-secret
DATABASE_PATH=./data/mwein-analytics.db
NODE_ENV=development
```

### Production .env
```
PORT=3000
JWT_SECRET=CHANGE_THIS_TO_RANDOM_STRING_32_CHARS_MIN
DATABASE_PATH=./data/mwein-analytics.db
NODE_ENV=production
```

### Generate Secure JWT Secret
```bash
# macOS/Linux
openssl rand -hex 32

# or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📁 Useful File Operations

### Check File Structure
```bash
tree -L 2              # Show directory tree
ls -la                 # List with details
du -sh *               # Directory sizes
```

### Backup Database
```bash
cp backend/data/mwein-analytics.db backend/data/mwein-analytics-backup.db
```

### Export Analytics Data
```bash
sqlite3 backend/data/mwein-analytics.db "SELECT * FROM page_views" > analytics.csv
```

### Compress for Backup
```bash
tar -czf mwein-backup.tar.gz mwein/
zip -r mwein-backup.zip mwein/
```

---

## 💻 Git Commands

### View Changes
```bash
git status
git log --oneline
git diff
```

### Make Changes
```bash
git add .
git commit -m "Your message"
git push
```

### Revert Changes
```bash
git checkout <filename>     # Undo file changes
git reset HEAD <filename>   # Unstage file
git revert <commit>         # Undo commit
```

### Create Branch
```bash
git branch feature-name
git checkout feature-name
git push -u origin feature-name
```

---

## 📦 npm Commands

### Install Dependencies
```bash
npm install
npm install --save package-name
npm install --save-dev package-name
```

### List Installed Packages
```bash
npm list
npm outdated  # Check for updates
```

### Update Packages
```bash
npm update
npm install @latest
```

### Run Scripts
```bash
npm start          # Start server
npm run dev        # Development mode
npm test           # Run tests (if configured)
```

---

## 🌐 Server Management

### SSH into Server
```bash
ssh mweinmed@mweinmedical.co.ke
ssh -p 22 mweinmed@mweinmedical.co.ke  # Specify port
```

### Check Server Status
```bash
ps aux | grep node
ps aux | grep npm
ps aux | grep pm2
```

### View Error Logs
```bash
tail -f /var/log/npm-err.log
tail -f server.log
```

### Monitor System
```bash
top              # CPU/Memory usage
df -h            # Disk usage
netstat -an      # Network status
```

---

## 📊 Database Commands

### SQLite3 CLI
```bash
sqlite3 database.db           # Open database
.tables                        # List tables
.schema table_name             # Show table schema
SELECT * FROM table_name;      # View data
INSERT INTO ...;               # Add data
UPDATE ... WHERE ...;          # Modify data
DELETE FROM ... WHERE ...;     # Delete data
.backup backup.db              # Backup
.exit                          # Exit
```

### Database Export
```bash
sqlite3 database.db ".dump" > backup.sql
sqlite3 database.db ".mode csv" "SELECT * FROM table" > export.csv
```

---

## 🔍 Testing URLs

### Local
```
Frontend: http://localhost:3000
API: http://localhost:3000/api/
Admin Login: http://localhost:3000/admin-login.html
Dashboard: http://localhost:3000/admin-dashboard.html
```

### Production (after deployment)
```
Frontend: https://mweinmedical.co.ke
API: https://api.mweinmedical.co.ke/api/
Admin Login: https://api.mweinmedical.co.ke/admin-login.html
Dashboard: https://api.mweinmedical.co.ke/admin-dashboard.html
```

---

## 🛡️ Security Checks

### Change Admin Password
```javascript
// In admin-login.html console:
fetch('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    email: 'newemail@example.com',
    username: 'newadmin',
    password: 'newpassword'
  })
})
```

### Reset JWT Secret
Edit `.env`:
```
JWT_SECRET=your-new-random-secret-key
```
Then restart server.

### Enable HTTPS
```bash
# Request SSL certificate
# Update CORS in server.js
# Update API URLs in js/main.js to use https://
```

---

## 📝 Useful Alias Commands

Add to `.bashrc` or `.zshrc`:

```bash
# Backend shortcuts
alias mwein-dev="cd ~/Downloads/mwein && npm start"
alias mwein-backend="cd ~/Downloads/mwein/backend"
alias mwein-logs="tail -f ~/Downloads/mwein/logs/server.log"
alias mwein-db="sqlite3 ~/Downloads/mwein/backend/data/mwein-analytics.db"

# Git shortcuts
alias gst="git status"
alias gadd="git add ."
alias gcommit="git commit -m"
alias gpush="git push"
```

---

## 🆘 Common Issues & Fixes

### Port Already in Use
```bash
lsof -i :3000
kill -9 <PID>
```

### Module Not Found
```bash
npm install
npm cache clean --force
rm -rf node_modules && npm install
```

### Database Locked
```bash
rm backend/data/mwein-analytics.db
npm start  # Recreate database
```

### CORS Error
Update domain in `backend/server.js`:
```javascript
app.use(cors({
    origin: 'https://yourdomain.com',
    credentials: true
}));
```

### Can't Connect to Server
```bash
# Check if running
ps aux | grep node

# Check if port listening
netstat -an | grep 3000

# Restart
npm start
```

---

## 📞 Quick Help

### I don't know what to do
→ Read `backend/QUICK_START.md`

### Backend won't start
→ Check `npm start` output
→ Run `node --version` (need 14+)
→ Run `npm install`

### Analytics not working
→ Check browser console (F12)
→ Verify backend is running
→ Check API endpoint URL

### Need to deploy
→ Read `backend/DEPLOYMENT_GUIDE.md`
→ Follow step by step
→ Contact Safaricom if issues

---

## 🎯 Common Workflow

```bash
# 1. Start work
cd ~/Downloads/mwein/backend
npm start

# 2. Make changes
# ... edit files ...

# 3. Test locally
# ... verify in browser ...

# 4. Commit changes
git add .
git commit -m "description"
git push

# 5. Deploy to production
# ... follow DEPLOYMENT_GUIDE ...

# 6. Monitor
# ... check admin dashboard ...
```

---

**Need help with a specific task?**

Check the relevant documentation:
- `backend/QUICK_START.md` - Local setup
- `backend/README.md` - API reference
- `backend/DEPLOYMENT_GUIDE.md` - Production guide
- `DOCUMENTATION_INDEX.md` - Full index
