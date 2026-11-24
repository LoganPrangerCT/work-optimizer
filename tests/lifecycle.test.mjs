import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../src/server.mjs';
import {openStore} from '../src/store.mjs';

test('heartbeat registers active client and returns active client count and ttl', async () => {
  const store = openStore(':memory:');
  const server = createServer(store, null, {autoExit: false, ttl: 30000});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'heartbeat'})
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.activeClients, 1);
    assert.equal(data.ttl, 30000);
    assert.equal(server.activeClients.has('tab-1'), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('heartbeat accepts Content-Type with charset parameter', async () => {
  const store = openStore(':memory:');
  const server = createServer(store, null, {autoExit: false});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json; charset=utf-8'},
      body: JSON.stringify({clientId: 'tab-beacon', action: 'heartbeat'})
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('tab close unregisters client and triggers shutdown after grace period', async () => {
  const store = openStore(':memory:');
  let shutdownReason = null;
  const server = createServer(store, null, {
    autoShutdown: true,
    autoExit: false,
    gracePeriod: 100,
    startupTimeout: 0,
    ttl: 0,
    onShutdown: (reason) => { shutdownReason = reason; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    // Register tab
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'heartbeat'})
    });
    assert.equal(server.activeClients.size, 1);

    // Close tab
    const closeRes = await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'close'})
    });
    assert.equal(closeRes.status, 200);
    const closeData = await closeRes.json();
    assert.equal(closeData.status, 'closing');
    assert.equal(closeData.activeClients, 0);
    assert.equal(server.activeClients.size, 0);

    // Wait for grace period to expire
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(shutdownReason, 'No active tabs remaining');
  } finally {
    try { await new Promise(resolve => server.close(resolve)); } catch {}
    store.close();
  }
});

test('reconnecting within grace period cancels shutdown', async () => {
  const store = openStore(':memory:');
  let shutdownTriggered = false;
  const server = createServer(store, null, {
    autoShutdown: true,
    autoExit: false,
    gracePeriod: 300,
    startupTimeout: 0,
    ttl: 0,
    onShutdown: () => { shutdownTriggered = true; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    // Register tab
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'heartbeat'})
    });

    // Close tab (simulating page reload)
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'close'})
    });
    assert.equal(server.activeClients.size, 0);

    // Reconnect after 100ms (well before 300ms grace period expires)
    await new Promise(resolve => setTimeout(resolve, 100));
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'heartbeat'})
    });
    assert.equal(server.activeClients.size, 1);

    // Wait past the original grace period
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(shutdownTriggered, false, 'Shutdown should have been cancelled by reconnection');
  } finally {
    try { await new Promise(resolve => server.close(resolve)); } catch {}
    store.close();
  }
});

test('closing one tab with other active tabs does not trigger shutdown', async () => {
  const store = openStore(':memory:');
  let shutdownTriggered = false;
  const server = createServer(store, null, {
    autoShutdown: true,
    autoExit: false,
    gracePeriod: 150,
    startupTimeout: 0,
    ttl: 0,
    onShutdown: () => { shutdownTriggered = true; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    // Open two tabs
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'heartbeat'})
    });
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-2', action: 'heartbeat'})
    });
    assert.equal(server.activeClients.size, 2);

    // Close only tab 1
    const res = await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-1', action: 'close'})
    });
    const data = await res.json();
    assert.equal(data.activeClients, 1);
    assert.equal(server.activeClients.has('tab-2'), true);

    // Wait past grace period
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(shutdownTriggered, false, 'Server should not shut down while tab-2 remains active');
  } finally {
    try { await new Promise(resolve => server.close(resolve)); } catch {}
    store.close();
  }
});

test('inactivity TTL shuts down server when heartbeats stop', async () => {
  const store = openStore(':memory:');
  let shutdownReason = null;
  const server = createServer(store, null, {
    autoShutdown: true,
    autoExit: false,
    ttl: 200,
    gracePeriod: 50,
    startupTimeout: 0,
    onShutdown: (reason) => { shutdownReason = reason; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    // Register tab
    await fetch(address + '/api/heartbeat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({clientId: 'tab-silent', action: 'heartbeat'})
    });
    assert.equal(server.activeClients.size, 1);

    // Do not send heartbeats; wait past TTL
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.match(shutdownReason || '', /TTL expired/);
  } finally {
    try { await new Promise(resolve => server.close(resolve)); } catch {}
    store.close();
  }
});

test('startup timeout shuts down server if no tab connects', async () => {
  const store = openStore(':memory:');
  let shutdownReason = null;
  const server = createServer(store, null, {
    autoShutdown: true,
    autoExit: false,
    startupTimeout: 200,
    ttl: 0,
    gracePeriod: 50,
    onShutdown: (reason) => { shutdownReason = reason; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // Do not connect any client; wait past startup timeout
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.match(shutdownReason || '', /Startup timeout/);
  } finally {
    try { await new Promise(resolve => server.close(resolve)); } catch {}
    store.close();
  }
});

test('GET /api/state with clientId registers heartbeat', async () => {
  const store = openStore(':memory:');
  const server = createServer(store, null, {autoExit: false});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    const res = await fetch(address + '/api/state?clientId=state-tab');
    assert.equal(res.status, 200);
    assert.equal(server.activeClients.has('state-tab'), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
