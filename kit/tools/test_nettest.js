'use strict';
// eDrive's internet check (apps/edrive/nettest.js) with a stand-in resolver, HTTPS and route table: what the
// Diagnostic page says when the head unit can or cannot reach ABRP's server. No network used:
//   node kit/tools/test_nettest.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nt = require(path.join(__dirname, '..', '..', 'apps', 'edrive', 'nettest.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nettest-'));
const route = (rows) => { const f = path.join(dir, 'route' + Math.random()); fs.writeFileSync(f, 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n' + rows.join('\n') + '\n'); return f; };
let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log('ok   ' + name); };

(async () => {
    await check('reachable: any HTTP status counts (the server answered)', async () => {
        const r = await nt.test({ routeFile: route(['wwan0\t00000000\t0100000A\t0003\t0\t0\t0\t00000000']), env: {},
            lookup: async () => ({ address: '1.2.3.4' }), get: async () => ({ status: 401, ms: 420 }) });
        assert(r.reachable && r.route === 'wwan0');
        assert.strictEqual(nt.text(r), 'Internet (ABRP, api.iternio.com): reachable, HTTP 401 in 0.4 s  ·  default route wwan0');
    });
    await check('no name resolution: not reachable, HTTPS not tried', async () => {
        let tried = false;
        const r = await nt.test({ routeFile: route(['socnet0.73\t0A000000\t00000000\t0001\t0\t0\t0\t00FFFFFF']), env: { HTTPS_PROXY: 'x' },
            lookup: async () => ({ error: 'ENOTFOUND' }), get: async () => { tried = true; return { status: 200 }; } });
        assert(!r.reachable && !tried);
        assert.strictEqual(nt.text(r), 'Internet (ABRP, api.iternio.com): not reachable, name not resolved (ENOTFOUND)  ·  no default route  ·  proxy HTTPS_PROXY');
    });
    await check('resolved but no connection: the connection error', async () => {
        const r = await nt.test({ routeFile: path.join(dir, 'none'), env: {}, lookup: async () => ({ address: '1.2.3.4' }), get: async () => ({ error: 'ETIMEDOUT', ms: 8000 }) });
        assert(!r.reachable && r.route === undefined);
        assert.strictEqual(nt.text(r), 'Internet (ABRP, api.iternio.com): not reachable, no connection (ETIMEDOUT)');
    });
    await check('before the first result: testing', async () => assert(/testing/.test(nt.text(null))));
    await check('run only while wanted, again after AGAIN_MS', async () => {
        const n = nt.start({ info() {}, warn() {} }, () => false);
        n.tick();
        assert.strictEqual(n.last(), null, 'nothing run while not wanted');
    });
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('nettest checks passed (' + ok + ').');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
