document.addEventListener("DOMContentLoaded", () => {

    // ======== DARK MODE TOGGLE ========
    const toggle = document.getElementById("darkToggle");
    if (toggle) {
        toggle.onclick = () => {
            document.body.classList.toggle("dark-mode");
            localStorage.setItem("darkMode", document.body.classList.contains("dark-mode"));
        }
        
        // Load saved dark mode preference
        if (localStorage.getItem("darkMode") === "true") {
            document.body.classList.add("dark-mode");
        }
    }

    // ======== APPOINTMENT FORM ========
    const form = document.getElementById("appointmentForm");
    if (!form) return;

    // Set minimum date to today
    document.getElementById("date").min =
        new Date().toISOString().split("T")[0];

    form.addEventListener("submit", e => {
        e.preventDefault();

        // Collect form data
        const name = document.getElementById("name").value.trim();
        const phone = document.getElementById("phone").value.trim();
        const email = document.getElementById("email")?.value.trim() || "";
        const service = document.getElementById("service").value;
        const date = document.getElementById("date").value;
        const notes = document.getElementById("notes")?.value.trim() || "";

        // Validate inputs
        if (!name || !phone || !service || !date) {
            alert("Please fill in all required fields.");
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

        // Reset form
        form.reset();
        alert("Opening WhatsApp. Your appointment request will be sent shortly!");
    });
});

