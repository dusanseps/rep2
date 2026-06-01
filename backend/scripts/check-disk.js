const { execSync } = require('child_process');

// Jednoduchy kontrolny skript pre cron/monitoring.
// Exit code 1 pri prekroceni limitu.

const threshold = Number(process.env.DISK_ALERT_PERCENT || 85);
const pathToCheck = process.env.DISK_CHECK_PATH || '/';

function getUsagePercent(path) {
  const output = execSync(`df -P ${path}`).toString('utf8').trim().split('\n');
  if (output.length < 2) throw new Error('Unable to read df output');
  const columns = output[1].split(/\s+/);
  const used = columns[4];
  return Number(String(used).replace('%', ''));
}

try {
  const usedPct = getUsagePercent(pathToCheck);
  const payload = {
    ok: usedPct < threshold,
    path: pathToCheck,
    usedPercent: usedPct,
    threshold,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload));
  if (usedPct >= threshold) process.exit(1);
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(2);
}
