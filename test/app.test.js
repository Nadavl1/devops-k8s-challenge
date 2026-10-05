const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { once } = require('node:events');
const app = require('../app');

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('GET /my-app returns the greeting', async () => {
    const response = await fetch(`${baseUrl}/my-app`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Hello, World!');
});

test('GET /ready reports readiness', async () => {
    const response = await fetch(`${baseUrl}/ready`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Ready');
});

test('GET /live reports liveness', async () => {
    const response = await fetch(`${baseUrl}/live`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Alive');
});