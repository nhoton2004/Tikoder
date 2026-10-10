const SETTINGS_ROUTES = Object.freeze({
    appearance: '/settings/appearance',
    connection: '/settings/connection',
    data: '/settings/data'
});

function routeToSettingsTab(pathname) {
    return Object.entries(SETTINGS_ROUTES).find(([, path]) => path === pathname)?.[0] || null;
}

function hasSettingsChanges(snapshot, draft) {
    return JSON.stringify(snapshot) !== JSON.stringify(draft);
}

module.exports = { SETTINGS_ROUTES, routeToSettingsTab, hasSettingsChanges };
