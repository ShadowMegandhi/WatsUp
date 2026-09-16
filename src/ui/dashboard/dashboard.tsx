/**
 * Dashboard shell. Phase 4 fills this in with the six sections and the
 * calendar; for now it exists so the build target and the options_page entry
 * in the manifest resolve to something real.
 */

import { render } from 'preact';

const App = () => (
  <main style="font:14px/1.6 system-ui,sans-serif;max-width:52ch;margin:3rem auto;padding:0 16px">
    <h1 style="font-size:17px">LEARN Tracker</h1>
    <p style="color:#6b7280">
      The dashboard arrives in Phase 4. Right now the work is in the popup: open
      the extension and run the connection probe.
    </p>
  </main>
);

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
