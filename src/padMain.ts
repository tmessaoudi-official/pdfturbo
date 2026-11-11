// pad.html's entry (phone-signature-pad plan step 4): the light phone signature pad. It deliberately does NOT register
// the service worker — the phone must not download the editor's precache (Decisions Log 2026-11-10 11:06/11:11).
import './styles/pad.css';
import { initI18n } from './utils/i18n';
import { mountPadPage, padLanguageFromHash } from './pad/padPage';

document.addEventListener('DOMContentLoaded', async () => {
  // The PC's QR carries its language in the fragment (step 5a); forced for this page, not stored.
  await initI18n({ lng: padLanguageFromHash(location.hash) ?? undefined }); // also sets <html lang/dir> and translates [data-i18n]
  const root = document.getElementById('padRoot');
  if (!root) throw new Error('pad.html has no #padRoot');
  mountPadPage(root);
});
