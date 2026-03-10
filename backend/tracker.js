// =====================================
// MWEIN MEDICAL - ANALYTICS TRACKER
// Add this to your main website pages
// =====================================

const ANALYTICS_API = 'http://localhost:3000/api/track';

// Track page visit
function trackPageVisit() {
    fetch(`${ANALYTICS_API}/visitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            page_url: window.location.pathname,
            referrer: document.referrer || 'direct',
            user_agent: navigator.userAgent
        }),
        keepalive: true
    }).catch(err => console.log('Analytics: visitor tracking error (non-critical)'));
}

// Track user actions (clicks, forms, etc)
function trackAction(actionType, page, details) {
    fetch(`${ANALYTICS_API}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action_type: actionType,
            page: page || window.location.pathname,
            details: details
        }),
        keepalive: true
    }).catch(err => console.log('Analytics: action tracking error (non-critical)'));
}

// Track form submissions
function trackFormSubmission(formName, formData) {
    fetch(`${ANALYTICS_API}/form-submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            form_name: formName,
            email: formData.email || null,
            phone: formData.phone || null,
            message: formData.message || null
        }),
        keepalive: true
    }).catch(err => console.log('Analytics: form tracking error (non-critical)'));
}

// Initialize tracker on page load
window.addEventListener('load', () => {
    // Track page visit
    trackPageVisit();

    // Track all button clicks
    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
            trackAction('click', window.location.pathname, {
                element: e.target.tagName,
                text: e.target.textContent?.substring(0, 50),
                href: e.target.href || null
            });
        }
    });

    // Track form submissions
    document.addEventListener('submit', (e) => {
        const form = e.target;
        const formName = form.name || form.id || 'unknown';
        
        const formData = new FormData(form);
        const data = {
            email: formData.get('email'),
            phone: formData.get('phone'),
            message: formData.get('message')
        };

        trackFormSubmission(formName, data);
    });
});

// Track page unload for session timing
window.addEventListener('beforeunload', () => {
    trackAction('page_leave', window.location.pathname, {
        time_on_page: Math.round((Date.now() - performance.timing.navigationStart) / 1000)
    });
});
