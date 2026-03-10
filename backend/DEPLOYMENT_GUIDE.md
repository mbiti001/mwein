# Mwein Medical - Backend Deployment Guide for Safaricom cPanel

## Overview
This guide explains how to deploy the Node.js/Express backend on Safaricom shared hosting using cPanel.

## Pre-Deployment Checklist
- [ ] Safaricom cPanel access credentials (user: `mweinmed`)
- [ ] Node.js availability on your hosting (verify with Safaricom support)
- [ ] FTP/SFTP access enabled
- [ ] Domain setup: `mweinmedical.co.ke`

## Step 1: Check Node.js Support

Contact Safaricom support or check your cPanel:
1. Login to cPanel
2. Look for "NodeJS Selector" or similar
3. If available, Node.js is installed

**If Node.js is NOT available**, see "Alternative Solutions" below.

## Step 2: Deploy Backend (With Node.js)

### Option A: cPanel NodeJS Selector

1. **Login to cPanel** at `mweinmedical.co.ke:2083`
2. **Find "NodeJS Selector"** or **"NodeJS Domains"**
3. **Create New Application**:
   - **Node.js version**: 16 or higher
   - **Application root**: `/home/mweinmed/backend` or `/home/mweinmed/mwein/backend`
   - **Application URL**: `api.mweinmedical.co.ke` (recommended) or subdirectory
   - **Application startup file**: `server.js`
4. **Upload Files**:
   - Upload `backend/` folder to your web root via FTP
   - Ensure `package.json` and `server.js` are present
5. **Install Dependencies**:
   - Via cPanel terminal or SSH:
   ```bash
   cd /home/mweinmed/backend
   npm install
   ```
6. **Create data directory**:
   ```bash
   mkdir data
   chmod 755 data
   ```
7. **Configure Environment**:
   - Edit `.env` with production settings
   - Change `JWT_SECRET` to a secure random string
8. **Start Application**:
   - In cPanel NodeJS Selector, click "Create Application" → Start

### Option B: Manual SSH Deployment

If you have SSH access:

```bash
# SSH into your account
ssh mweinmed@mweinmedical.co.ke

# Navigate to webroot
cd ~/public_html

# Clone or upload backend
git clone https://github.com/mbiti001/mwein.git
cd mwein/backend

# Install dependencies
npm install --production

# Create data directory
mkdir data

# Start with PM2 (if available)
npm install -g pm2
pm2 start server.js --name "mwein-backend"
pm2 startup
pm2 save
```

## Step 3: Configure Frontend for Backend

Update your frontend to use the correct backend URL:

### In `index.html` (and all pages):
```html
<!-- Add before </head> -->
<script>
    // Configure analytics endpoint
    window.ANALYTICS_API = 'https://api.mweinmedical.co.ke/api/track';
    // or if on subdirectory:
    // window.ANALYTICS_API = 'https://mweinmedical.co.ke/backend/api/track';
</script>
```

### Update `js/main.js`:
Change line with:
```javascript
const ANALYTICS_API = 'http://localhost:3000/api/track';
```

To:
```javascript
const ANALYTICS_API = window.ANALYTICS_API || 'https://api.mweinmedical.co.ke/api/track';
```

## Step 4: Setup Admin Dashboard

1. **Access Admin Login**:
   - Go to `https://api.mweinmedical.co.ke/admin-login.html`
   - Or upload `admin-login.html` and `admin-dashboard.html` to your public_html

2. **Register First Admin**:
   - Click "Create account"
   - Enter email, username, password
   - Create admin account

3. **Login**:
   - Enter credentials
   - Access analytics dashboard

## Step 5: SSL/HTTPS Configuration

For production security:

1. **In cPanel**:
   - Go to "SSL/TLS Status"
   - Install AutoSSL certificate (usually free with Safaricom)
   - Enable HTTPS redirect

2. **Update Backend `.env`**:
   ```
   NODE_ENV=production
   JWT_SECRET=your-strong-random-secret-key-here
   ```

3. **Ensure CORS allows your domain**:
   - In `backend/server.js`, update CORS:
   ```javascript
   app.use(cors({
       origin: 'https://mweinmedical.co.ke',
       credentials: true
   }));
   ```

## Alternative Solutions (No Node.js)

If Safaricom doesn't support Node.js on shared hosting, use one of these:

### Option 1: Firebase Functions (Recommended for Easiest)
- Deploy backend to Firebase for free tier
- Frontend still hosted on Safaricom
- Works instantly without cPanel changes

```bash
npm install -g firebase-tools
firebase init
firebase deploy
```

### Option 2: Vercel (Alternative)
- Similar to Firebase
- Easy deployment from GitHub
- Free tier available

### Option 3: PHP Backend (Local Alternative)
- Rewrite backend in PHP
- Compatible with all shared hosts
- More work but guaranteed to work

### Option 4: Upgrade Hosting
- Contact Safaricom about VPS or dedicated hosting with Node.js
- Usually requires upgrade to managed VPS plan

## Monitoring & Maintenance

### Check Backend Status
```bash
# SSH into server
ssh mweinmed@mweinmedical.co.ke

# Check if running
ps aux | grep node

# View logs (if using PM2)
pm2 logs mwein-backend

# Restart if needed
pm2 restart mwein-backend
```

### Backup Database
```bash
# Regular backups of SQLite database
cp ~/backend/data/mwein-analytics.db ~/backups/mwein-analytics-$(date +%Y%m%d).db
```

### Monitor Analytics Data
- Access admin dashboard regularly
- Watch for unusual activity
- Backup important data

## Troubleshooting

**Backend won't start?**
- Check Node.js version: `node --version`
- Check for errors: `npm start` in terminal
- Ensure port 3000 is not blocked

**CORS errors in frontend?**
- Update domain in backend `server.js`
- Ensure https:// if using SSL

**Database locked?**
- Restart Node.js application
- Check file permissions on `data/` folder

**Admin login fails?**
- Register account first
- Check `.env` JWT_SECRET is set
- Verify database exists

## Production Checklist
- [ ] Change JWT_SECRET to random string
- [ ] Enable HTTPS
- [ ] Set NODE_ENV=production
- [ ] Configure CORS for your domain
- [ ] Setup database backups
- [ ] Monitor error logs
- [ ] Rate limit admin login endpoints
- [ ] Regularly update npm packages

## Support
Contact Safaricom support for:
- Node.js availability verification
- SSH/SFTP access issues
- SSL certificate installation
- Port forwarding or subdomain setup

For development issues, refer to backend README.md
