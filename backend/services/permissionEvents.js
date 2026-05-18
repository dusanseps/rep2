const clientsByUserId = new Map();

function getClientSet(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!clientsByUserId.has(id)) clientsByUserId.set(id, new Set());
  return clientsByUserId.get(id);
}

function registerPermissionClient(userId, res) {
  const set = getClientSet(userId);
  if (!set) return;
  set.add(res);
}

function unregisterPermissionClient(userId, res) {
  const id = Number(userId);
  const set = clientsByUserId.get(id);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    clientsByUserId.delete(id);
  }
}

function broadcastPermissionUpdate(userId, payload) {
  const id = Number(userId);
  const set = clientsByUserId.get(id);
  if (!set || set.size === 0) return;

  const data = JSON.stringify({
    type: 'permissions:update',
    ...payload,
  });

  for (const res of set) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (_err) {
      unregisterPermissionClient(id, res);
    }
  }
}

module.exports = {
  registerPermissionClient,
  unregisterPermissionClient,
  broadcastPermissionUpdate,
};
