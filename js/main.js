document.addEventListener("DOMContentLoaded", () => {

    // ======== DARK MODE TOGGLE ========
    const toggle = document.getElementById("darkToggle");
    const applyDarkModeState = (isDark) => {
        if (isDark) {
            document.body.classList.add("dark-mode");
            if (toggle) toggle.textContent = 'Light';
        } else {
            document.body.classList.remove("dark-mode");
            if (toggle) toggle.textContent = 'Dark';
        }
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            const enabled = !document.body.classList.contains('dark-mode');
            applyDarkModeState(enabled);
            localStorage.setItem('darkMode', enabled);
            toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        });

        // Load saved dark mode preference
        const saved = localStorage.getItem('darkMode') === 'true';
        applyDarkModeState(saved);
        toggle.setAttribute('aria-pressed', saved ? 'true' : 'false');
    }

    // ======== APPOINTMENT FORM ========
    // Appointment form handling: only intercept if the form has data-wa="true"
    const form = document.getElementById("appointmentForm");
    if (form) {
        const dateEl = document.getElementById("date");
        if (dateEl) dateEl.min = new Date().toISOString().split("T")[0];

        // small toast helper
        const showToast = (msg) => {
            const t = document.createElement('div');
            t.className = 'toast';
            t.textContent = msg;
            Object.assign(t.style, {
                position: 'fixed',
                right: '20px',
                bottom: '24px',
                background: 'rgba(0,0,0,0.85)',
                color: 'white',
                padding: '0.6rem 1rem',
                borderRadius: '6px',
                zIndex: 1200,
                fontWeight: 600,
            });
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 4000);
        };

        // Only attach the WhatsApp redirect behavior when explicitly requested
        if (form.dataset.wa === 'true' || form.hasAttribute('data-wa')) {
            form.addEventListener("submit", e => {
                e.preventDefault();

                // Collect form data
                const name = document.getElementById("name")?.value.trim() || '';
                const phone = document.getElementById("phone")?.value.trim() || '';
                const email = document.getElementById("email")?.value.trim() || "";
                const service = document.getElementById("service")?.value || '';
                const date = document.getElementById("date")?.value || '';
                const notes = document.getElementById("notes")?.value.trim() || "";

                // Validate inputs
                if (!name || !phone || !service || !date) {
                    showToast("Please fill in all required fields.");
                    return;
                }

                // Format the message for WhatsApp
                const msg = `🏥 *APPOINTMENT REQUEST*\n\n` +
                    `📋 *Service:* ${service}\n` +
                    `👤 *Name:* ${name}\n` +
                    `📱 *Phone:* ${phone}\n` +
                    (email ? `📧 *Email:* ${email}\n` : "") +
                    `📅 *Preferred Date:* ${date}\n` +
                    (notes ? `📝 *Notes:* ${notes}\n` : "") +
                    `\n_Sent from Mwein Medical Services Website_`;

                // Open WhatsApp with the message
                window.open(
                    `https://wa.me/254707711888?text=${encodeURIComponent(msg)}`,
                    "_blank"
                );

                // Reset form and show toast
                form.reset();
                showToast("Opening WhatsApp to send your request...");
            });
        }
    }

    // =====================
    // SHOP: CSV import/export
    // =====================
    const productStorageKey = 'shopProducts';

    function parseCSV(text) {
        // Very small CSV parser: assumes header row and commas, no quoted commas
        const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = lines.slice(1).map(line => {
            const cols = line.split(',').map(c => c.trim());
            const obj = {};
            headers.forEach((h, i) => obj[h] = cols[i] || '');
            return obj;
        });
        return rows;
    }

    function saveProducts(products) {
        localStorage.setItem(productStorageKey, JSON.stringify(products));
    }

    function loadProducts() {
        try { return JSON.parse(localStorage.getItem(productStorageKey)) || []; }
        catch (e) { return []; }
    }

    function renderProducts() {
        const grid = document.getElementById('productGrid');
        if (!grid) return;
        const products = loadProducts();
        grid.innerHTML = '';
        if (!products.length) {
            grid.innerHTML = '<p style="text-align:center;color:var(--gray-light);">No products yet. Upload a CSV to add products.</p>';
            return;
        }
        products.forEach(p => {
            const card = document.createElement('div');
            card.className = 'product-card service-card';
            card.innerHTML = `
                <h3>${escapeHtml(p.title || p.name || 'Unnamed Product')}</h3>
                <p style="font-weight:600; color:var(--primary); margin:0.25rem 0;">${escapeHtml(p.price || p.cost || '')}</p>
                <p style="color:var(--gray); margin-top:0.5rem;">${escapeHtml(p.description || p.desc || '')}</p>
                <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
                    <button class="btn-primary" onclick="addToCart('${escapeHtml(p.title || p.name || 'Product').replace(/'/g, "\\'")}', ${parseFloat(p.price||p.cost||0) || 0})">Add to cart</button>
                    <button class="btn-tertiary" onclick="window.open('https://wa.me/254707711888?text=' + encodeURIComponent('Hi, is "' + (p.title||p.name||'this product') + '" available?'), '_blank')">Ask on WhatsApp</button>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[c];
        });
    }

    // Wire up CSV upload UI if present
    const csvInput = document.getElementById('productsCsv');
    if (csvInput) {
        const importBtn = document.getElementById('importCsvBtn');
        const clearBtn = document.getElementById('clearProductsBtn');
        const exportBtn = document.getElementById('exportCsvBtn');

        importBtn && importBtn.addEventListener('click', () => {
            const f = csvInput.files[0];
            if (!f) { alert('Please choose a CSV file first.'); return; }
            const reader = new FileReader();
            reader.onload = () => {
                const rows = parseCSV(reader.result);
                if (!rows.length) { alert('No products found in CSV. Ensure the file has a header row and product rows.'); return; }
                const existing = loadProducts();
                const combined = existing.concat(rows);
                saveProducts(combined);
                renderProducts();
                alert(`Imported ${rows.length} products.`);
            };
            reader.readAsText(f);
        });

        clearBtn && clearBtn.addEventListener('click', () => {
            if (!confirm('Clear all products from local storage?')) return;
            saveProducts([]);
            renderProducts();
        });

        exportBtn && exportBtn.addEventListener('click', () => {
            const products = loadProducts();
            if (!products.length) { alert('No products to export.'); return; }
            const headers = Object.keys(products[0]);
            const csv = [headers.join(',')].concat(products.map(r => headers.map(h => `"${(r[h]||'').replace(/"/g,'""')}"`).join(','))).join('\n');
            const blob = new Blob([csv], {type: 'text/csv'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'products.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        });

        // Initial render
        renderProducts();
    }
});

