/**
 * Mobile Gestures - Swipe navigation + Viewport stability
 */

let touchStartX = 0;
let touchStartY = 0;

// Swipe from left edge → open sidebar
document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
});

document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    
    // Swipe right from left edge (>100px horizontal, <50px vertical)
    if (touchStartX < 30 && dx > 100 && Math.abs(dy) < 50) {
        const sidebar = document.getElementById('app-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar && !sidebar.classList.contains('open')) {
            sidebar.classList.add('open');
            if (backdrop) {
                backdrop.classList.add('active');
                backdrop.hidden = false;
            }
        }
    }
    
    // Swipe left from right edge → close sidebar
    if (dx < -100 && Math.abs(dy) < 50) {
        const sidebar = document.getElementById('app-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            if (backdrop) {
                backdrop.classList.remove('active');
                backdrop.hidden = true;
            }
        }
    }
});

// Viewport stability fix - prevent iOS jump
function fixViewportStability() {
    // Replace h-screen with min-h-[100dvh] for mobile
    const observer = new MutationObserver(() => {
        document.querySelectorAll('[style*="height: 100vh"]').forEach(el => {
            el.style.height = '100dvh';
        });
    });
    observer.observe(document.body, { attributes: true, subtree: true });
}

// Init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixViewportStability);
} else {
    fixViewportStability();
}