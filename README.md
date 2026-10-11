# Open Voice

Open Voice provides browser-based speech captions and text-to-speech. The optional custom-voice feature uses ElevenLabs Instant Voice Cloning. The server binds to `127.0.0.1` so the API key and voice endpoints are only available from this computer.

The app also includes a full-screen signboard, high-contrast mode, an emergency-message composer with optional GPS coordinates, and experimental local sound-awareness alerts. On first successful online visit, a service worker caches the app shell and local images for later offline visits. Offline speech recognition is available only in browsers that support Web Speech on-device recognition and have the selected language pack installed; select **On-device only** and prepare the language before use.

## Important capability and safety limits

- Emergency messages are prepared for you to share. The browser app does not dispatch emergency services, send SMS silently, or verify delivery. Location is requested only after you choose **Add my location**. Follow local emergency procedures in an actual emergency.
- Sound awareness uses local microphone levels and frequency energy as an experimental prompt. It does not recognize specific alarms or crying and can miss real hazards or alert on ordinary sounds. Do not use it instead of certified smoke/carbon-monoxide alarms or other safety systems. Vibration and camera flash require browser/device support and user permission.
- Browser speech recognition may use an online service unless on-device processing is explicitly selected and available. The app does not automatically identify speakers; its optional speaker labels are manual.
- Carrier real-time text (RTT) for phone calls is not available to this web app. Use the RTT/accessibility features provided by your phone and carrier.
- Offline mode caches the web app and its local images, not the ElevenLabs voice features or any network-dependent browser services.

## Run locally

1. Install Node.js 20 or newer.
2. Create an ElevenLabs API key with access to voice cloning and text-to-speech.
3. Copy `.env.example` to `.env` and replace the example value with your API key. Do not share or commit `.env`.
4. From this folder, start the app:
   - Windows PowerShell: `npm.cmd start`
   - Other terminals: `npm start`
5. Open `http://127.0.0.1:3000` in your browser.
6. In the text-to-speech card, open **Set up my voice**, record a sample or choose an audio file, confirm that you have permission to clone it, then create your voice.

The browser's built-in speech recognition and voices remain available. Custom-voice cloning and speaking require an internet connection and an ElevenLabs account; provider usage limits or charges may apply. The recording is sent to ElevenLabs to create the voice. Use only your own voice or a recording you have explicit permission to clone. Removing the custom voice in the app also requests deletion from ElevenLabs; review the provider's terms and privacy policy for their data handling.

The local server is intended for personal use on this computer. Do not expose it to the public internet without adding user authentication, request protections, and production hosting controls.

Run the local checks with `npm.cmd test` in Windows PowerShell or `npm test` in other terminals.
