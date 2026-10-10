const assert = require('node:assert/strict');
const test = require('node:test');
const { SETTINGS_ROUTES, routeToSettingsTab, hasSettingsChanges } = require('../utils/settingsNavigation');

test('settings routes resolve to their tab', () => {
    assert.equal(routeToSettingsTab(SETTINGS_ROUTES.appearance), 'appearance');
    assert.equal(routeToSettingsTab(SETTINGS_ROUTES.connection), 'connection');
    assert.equal(routeToSettingsTab(SETTINGS_ROUTES.data), 'data');
    assert.equal(routeToSettingsTab('/settings'), null);
});

test('save state enables only when the settings draft changes', () => {
    const saved = { theme: 'light', tiktokId: 'shop-a', printerAddress: '' };
    assert.equal(hasSettingsChanges(saved, { ...saved }), false);
    assert.equal(hasSettingsChanges(saved, { ...saved, theme: 'dark' }), true);
});
