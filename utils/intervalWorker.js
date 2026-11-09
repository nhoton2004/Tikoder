'use strict';
// Stop scheduling and wait for the current drain before shutdown.
function intervalWorker(task, interval, onError) {
    let pending;
    let stopped = false;
    const tick = () => {
        if (stopped || pending) return;
        pending = Promise.resolve().then(task).catch(onError).finally(() => { pending = null; });
    };
    tick();
    const timer = setInterval(tick, interval);
    timer.unref();
    return async () => { stopped = true; clearInterval(timer); await pending; };
}
module.exports = { intervalWorker };
