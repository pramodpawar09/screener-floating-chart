import { loadSettings, saveSettings } from '../shared/settings.js';
import { TIMEFRAMES, TIMEFRAME_ORDER } from '../shared/timeframes.js';
import { getProviderStatus } from '../services/api-client.js';

const $ = (id) => document.getElementById(id);
const numberFields = ['hoverDelay', 'hideDelay', 'width', 'height'];

async function init() {
  const tfSelect = $('defaultTimeframe');
  for (const id of TIMEFRAME_ORDER) tfSelect.append(new Option(TIMEFRAMES[id].label, id));

  const s = await loadSettings();
  $('enabled').checked = s.enabled;
  $('theme').value = s.theme;
  tfSelect.value = s.defaultTimeframe;
  for (const f of numberFields) $(f).value = s[f];

  // Settings are stored immediately; the content script applies them live via storage.onChanged.
  $('enabled').addEventListener('change', (e) => saveSettings({ enabled: e.target.checked }));
  $('theme').addEventListener('change', (e) => saveSettings({ theme: e.target.value }));
  tfSelect.addEventListener('change', (e) => saveSettings({ defaultTimeframe: e.target.value }));
  for (const f of numberFields) {
    $(f).addEventListener('change', async (e) => {
      const next = await saveSettings({ [f]: e.target.value });
      e.target.value = next[f]; // show the clamped value
    });
  }

  $('test').addEventListener('click', async () => {
    const out = $('provider-status');
    $('test').disabled = true;
    out.className = 'muted';
    out.textContent = 'Testing…';
    try {
      const r = await getProviderStatus();
      out.className = r.ok ? 'ok' : 'err';
      out.textContent = r.ok ? `Connected (${r.latencyMs} ms).` : `Failed: ${r.message}`;
    } catch (e) {
      out.className = 'err';
      out.textContent = `Failed: ${e.message}`;
    } finally {
      $('test').disabled = false;
    }
  });
}
init();
