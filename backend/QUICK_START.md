# Backend Quick Start - Local Development

## Setup (5 minutes)

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org) - choose LTS version

### 2. Navigate to Backend Directory
```bash
cd backend
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Create Data Directory
```bash
mkdir -p data
```

### 5. Configure Environment
Edit `.env` (already has defaults):
```
PORT=3000
JWT_SECRET=your-secret-key
DATABASE_PATH=./data/mwein-analytics.db
```

### 6. Start the Server
```bash
npm start
```

✅ Server running on `http://localhost:3000`

---

## Access Admin Dashboard

### 1. Register Admin Account
- Open admin login: `open backend/admin-login.html` 
- Click "Create account"
- Enter: email, username, password

### 2. Login to Dashboard
- Use registered credentials
- View real-time analytics

---

## Test Analytics Tracking

### Option 1: Local Test HTML
Create `test-analytics.html`:
```html
<!DOCTYPE html>
<html>
<head>
    <title>Analytics Test</title>
</head>
<body>
    <h1>Analytics Test Page</h1>
    <button>Click me to track</button>
    <a href="#">Track link click</a>
    <form onsubmit="return false">
        <input type="email" placeholder="Email" value="test@example.com">
        <button type="submit">Test Form</button>
    </form>
    
    <script>
        const API = 'http://localhost:3000/api/track';
        
        // Track page visit
        fetch(`${API}/visitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page_url: '/test',
                referrer: 'direct',
                user_agent: navigator.userAgent
            })
        });
        
        // Track clicks
        document.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
                fetch(`${API}/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action_type: 'click',
                        page: '/test',
                        details: { element: e.target.tagName }
                    })
                });
            }
        });
        
        // Track form
        document.querySelector('form').addEventListener('submit', () => {
            fetch(`${API}/form-submission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    form_name: 'test_form',
                    email: 'test@example.com',
                    phone: '254700000000',
                    message: 'Test submission'
                })
            });
        });
    </script>
</body>
</html>
```

Run: `open test-analytics.html` → interact with page → check dashboard

### Option 2: Use cURL (Terminal)
```bash
# Track visitor
curl -X POST http://localhost:3000/api/track/visitor \
  -H "Content-Type: application/json" \
  -d '{
    "page_url": "/test-page",
    "referrer": "google.com",
    "user_agent": "Mozilla/5.0"
  }'

# Track action
curl -X POST http://localhost:3000/api/track/action \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "button_click",
    "page": "/test-page",
    "details": {"button": "subscribe"}
  }'

# Track form
curl -X POST http://localhost:3000/api/track/form-submission \
  -H "Content-Type: application/json" \
  -d '{
    "form_name": "contact",
    "email": "user@example.com",
    "phone": "254700000000",
    "message": "Test message"
  }'
```

---

## View Analytics via Dashboard

1. Login to admin dashboard
2. See real-time data:
   - **Dashboard Stats**: Total visitors, page views, actions, submissions
   - **Page Views**: Breakdown by page with view counts
   - **Recent Visitors**: IP addresses, pages visited, referrers
   - **Recent Actions**: Click history, form interactions
   - **Form Submissions**: Email, phone, messages from users

---

## Integrate with Live Frontend

Update `js/main.js` line with ANALYTICS_API:
```javascript
// Change:
const ANALYTICS_API = 'http://localhost:3000/api/track';

// To (production):
const ANALYTICS_API = 'https://api.mweinmedical.co.ke/api/track';
// Or if backend is in subdirectory:
const ANALYTICS_API = 'https://mweinmedical.co.ke/backend/api/track';
```

---

## Troubleshooting

**Port 3000 already in use?**
```bash
lsof -i :3000  # Find what's using it
kill -9 <PID>  # Kill the process
# Or change PORT in .env
```

**Database errors?**
```bash
rm -rf data/mwein-analytics.db  # Delete old db
npm start  # Recreate from scratch
```

**CORS errors?**
- Ensure backend is running
- Check domain in CORS config
- Try from same localhost for testing

**Analytics not showing?**
- Check browser console for errors
- Verify backend URL is correct
- Ensure backend is running on correct port
- Check Network tab in DevTools

---

## Development Tips

### Enable Auto-Reload
```bash
npm run dev  # Uses nodemon to auto-restart on file changes
```

### View Database Directly
```bash
# Install SQLite viewer (optional)
brew install sqlite3

# Browse database
sqlite3 data/mwein-analytics.db
.tables  # Show all tables
SELECT * FROM page_views;  # View page views
```

### Add New Analytics Endpoint
Edit `backend/server.js`, add route:
```javascript
app.get('/api/analytics/custom', authenticateToken, (req, res) => {
    db.all('SELECT * FROM visitors LIMIT 10', (err, rows) => {
        res.json(rows);
    });
});
```

### Change Admin Credentials
```javascript
// In admin-login.html login form, you can register new admin
// Or reset database: rm data/mwein-analytics.db && npm start
```

---

## Next Steps

1. ✅ Backend running locally
2. **Test integration** with frontend pages
3. **Deploy to Safaricom** using DEPLOYMENT_GUIDE.md
4. **Monitor live analytics** on production

Ready? Let's deploy! 🚀
