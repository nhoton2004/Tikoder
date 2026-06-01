(() => {
    const cta = document.querySelector('[data-main-cta]');
    if (!cta) return;
    fetch('/api/me', { credentials: 'same-origin' })
        .then((res) => res.json())
        .then((data) => {
            if (data && data.loggedIn) {
                cta.textContent = 'Tiếp tục Dashboard';
                cta.setAttribute('href', '/app');
            }
        })
        .catch(() => {});
})();
