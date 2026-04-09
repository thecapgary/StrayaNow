let _config = null;

export async function getConfig() {
  if (_config) return _config;
  _config = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  return _config;
}
