'use strict';
/**
 * nettest.js - whether this app can reach a server on the internet (ABRP's telemetry API, api.iternio.com), for
 * the Diagnostic page. The head unit has no internet route of its own (README 4.7: only BMW's servers, through
 * the telematics unit), so before anything is sent anywhere this says what is there:
 *   route   the default route's interface in /proc/net/route, or none
 *   proxy   which proxy variables the app's environment has (names only)
 *   dns     the host's address, or the resolver's error
 *   https   the server's HTTP status (any status: it answered), or the error (timeout, refused, unreachable, TLS)
 * Asked only while the Diagnostic page is up (start / again after AGAIN_MS), never in the background, and nothing
 * is sent but a plain GET without credentials.
 */
const dns = require('dns');
const fs = require('fs');
const https = require('https');

const HOST = 'api.iternio.com', PATH = '/1/tlm/send';
const DNS_MS = 5000, HTTPS_MS = 8000, AGAIN_MS = 120000;

function defaultRoute(file) {
    try {
        const rows = fs.readFileSync(file || '/proc/net/route', 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/));
        const d = rows.find((r) => r[1] === '00000000' && r[7] === '00000000');
        return d ? d[0] : null;
    } catch (e) { return undefined; }      // not readable here
}
const proxies = (env) => ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'no_proxy'].filter((k) => (env || process.env)[k]);

function lookup(host, ms) {
    return new Promise((res) => {
        const timer = setTimeout(() => res({ error: 'no answer in ' + ms / 1000 + ' s' }), ms);
        dns.lookup(host, (err, address) => { clearTimeout(timer); res(err ? { error: err.code || String(err.message || err) } : { address }); });
    });
}
function get(host, path, ms) {
    return new Promise((res) => {
        const t0 = Date.now();
        let done = false;
        const end = (r) => { if (!done) { done = true; res(Object.assign({ ms: Date.now() - t0 }, r)); } };
        try {
            const req = https.get({ host, path, timeout: ms, headers: { 'User-Agent': 'eDrive' } }, (resp) => { resp.resume(); end({ status: resp.statusCode }); });
            req.on('timeout', () => { req.destroy(); end({ error: 'no answer in ' + ms / 1000 + ' s' }); });
            req.on('error', (e) => end({ error: e.code || String(e.message || e) }));
        } catch (e) { end({ error: String(e.message || e) }); }
    });
}

/** The test, run now: { t, host, route, proxy, dns, https, reachable }. */
async function test(opts) {
    const o = opts || {};
    const r = { t: Date.now(), host: o.host || HOST, route: defaultRoute(o.routeFile), proxy: proxies(o.env) };
    r.dns = await (o.lookup || lookup)(r.host, DNS_MS);
    r.https = r.dns.address ? await (o.get || get)(r.host, o.path || PATH, HTTPS_MS) : { error: 'not tried (no address)' };
    r.reachable = typeof r.https.status === 'number';
    return r;
}

/** One line for the Diagnostic page. */
function text(r) {
    if (!r) return 'Internet (ABRP, ' + HOST + '): testing...';
    const route = r.route === undefined ? '' : r.route ? '  ·  default route ' + r.route : '  ·  no default route';
    const proxy = r.proxy.length ? '  ·  proxy ' + r.proxy.join(', ') : '';
    if (r.reachable) return 'Internet (ABRP, ' + r.host + '): reachable, HTTP ' + r.https.status + ' in ' + (r.https.ms / 1000).toFixed(1) + ' s' + route + proxy;
    const why = r.dns.error ? 'name not resolved (' + r.dns.error + ')' : 'no connection (' + r.https.error + ')';
    return 'Internet (ABRP, ' + r.host + '): not reachable, ' + why + route + proxy;
}

/** Runs the test while wanted() (the Diagnostic page up): at once, then again every AGAIN_MS. last() is the result. */
function start(log, wanted, onResult) {
    let res = null, busy = false, at = 0;
    const tick = () => {
        if (busy || !wanted() || Date.now() - at < AGAIN_MS) return;
        busy = true; at = Date.now();
        test().then((r) => { res = r; log.info('nettest: ' + text(r)); if (onResult) onResult(r); })
            .catch((e) => log.warn('nettest: ' + e)).then(() => { busy = false; });
    };
    const timer = setInterval(tick, 1000);
    if (timer.unref) timer.unref();
    return { last: () => res, tick, again() { at = 0; tick(); } };
}

module.exports = { test, text, start, defaultRoute, proxies, HOST, AGAIN_MS };
