/**
 * Phase 1 popup: the probe console.
 *
 * This is scaffolding with a purpose. It exists so the cookie-auth assumption
 * can be verified against a real UW account before any of the product is built
 * on top of it. Phase 5 replaces this view with the real "This Week" list.
 */

import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Command, CommandReply, ProbeReport, ProbeStep, RuntimeStatus } from '@shared/messages';
import { LEARN_ORIGIN } from '@shared/constants';

const send = async (command: Command): Promise<CommandReply> =>
  (await chrome.runtime.sendMessage(command)) as CommandReply;

const App = () => {
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const reply = await send({ type: 'get-status' });
    if (reply.type === 'status') setStatus(reply.status);
  }, []);

  useEffect(() => {
    void refreshStatus();
    void send({ type: 'get-probe-result' }).then((reply) => {
      if (reply.type === 'probe-result') setReport(reply.report);
    });
  }, [refreshStatus]);

  const probe = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const reply = await send({ type: 'probe' });
      if (reply.type === 'probe-result') setReport(reply.report);
      else if (reply.type === 'error') setError(reply.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      void refreshStatus();
    }
  }, [refreshStatus]);

  const copy = useCallback(() => {
    if (report !== null) void navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  }, [report]);

  const authFailed = report?.steps.some((s) => s.outcome === 'auth-redirect') ?? false;

  return (
    <>
      <header>
        <h1>LEARN Tracker</h1>
        <span class="phase">Phase 1 &middot; connection probe</span>
      </header>

      <main>
        <p class="intro">
          Checks whether this extension can read your LEARN data using your
          existing sign-in. Nothing is sent anywhere; results stay on this device.
        </p>

        {authFailed && (
          <div class="banner">
            LEARN redirected us to the sign-in page.{' '}
            <a href={`${LEARN_ORIGIN}/d2l/home`} target="_blank" rel="noreferrer">
              Sign in to LEARN
            </a>
            , then run the probe again.
          </div>
        )}

        <button type="button" onClick={probe} disabled={running}>
          {running ? 'Probing…' : 'Run probe'}
        </button>

        {status !== null && (
          <div class="status">
            <span class={`chip ${status.learnTabOpen ? 'good' : ''}`}>
              {status.learnTabOpen ? 'LEARN tab open' : 'No LEARN tab'}
            </span>
            <span class={`chip ${status.relayConnected ? 'good' : ''}`}>
              {status.relayConnected ? 'Relay connected (Tier A)' : 'Relay idle (Tier B)'}
            </span>
          </div>
        )}

        {error !== null && <p class="note bad">{error}</p>}

        {report !== null && (
          <>
            <div class="status">
              <span class="chip">tier: {report.tier}</span>
              <span class="chip">{report.finishedAt - report.startedAt} ms total</span>
              <span class="chip">{new Date(report.finishedAt).toLocaleTimeString()}</span>
            </div>
            {report.steps.map((step, i) => (
              <Step key={`${step.label}-${i}`} step={step} />
            ))}
          </>
        )}
      </main>

      <footer>
        <span>Not affiliated with the University of Waterloo</span>
        {report !== null && (
          <a href="#" onClick={(e) => { e.preventDefault(); copy(); }}>
            Copy report
          </a>
        )}
      </footer>
    </>
  );
};

const Step = ({ step }: { step: ProbeStep }) => {
  const tone = step.outcome === 'ok' ? 'ok' : step.outcome === 'auth-redirect' ? 'warn' : 'bad';
  const rl = step.rateLimit;
  const hasRateLimit = rl.remaining !== null || rl.cost !== null || rl.reset !== null;

  return (
    <div class="step">
      <div class="step-head">
        <span class={`dot ${tone}`} />
        <span class="step-label">{step.label}</span>
        {step.durationMs > 0 && <span class="chip">{step.durationMs} ms</span>}
        {step.status !== null && <span class="chip">{step.status}</span>}
      </div>

      {step.path !== '' && <div class="meta">{step.path}</div>}

      {hasRateLimit && (
        <div class="meta">
          rate limit — remaining: {rl.remaining ?? 'n/a'}, cost: {rl.cost ?? 'n/a'}, reset:{' '}
          {rl.reset ?? 'n/a'}
        </div>
      )}

      {step.note !== null && (
        <div class={`note ${step.outcome === 'ok' ? '' : 'bad'}`}>{step.note}</div>
      )}

      {step.bodyPreview !== '' && <pre>{step.bodyPreview}</pre>}
    </div>
  );
};

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
