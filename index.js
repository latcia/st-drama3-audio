import { registerTtsProvider } from '../../tts/index.js';
import { Drama3TtsProvider, PROVIDER } from './provider.js';
import { mountSurface } from './surface.js';

registerTtsProvider(PROVIDER, Drama3TtsProvider);
export function activate() { mountSurface(); }
// Upstream SillyTavern loads the module directly. Tauri managed mode must
// register through the manifest activation hook.
if (!window.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activate, { once: true });
    else activate();
}
