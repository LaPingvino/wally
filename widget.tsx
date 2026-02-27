import React from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApi } from 'matrix-widget-api';
import { IssueBoardWidget } from './app/widget/IssueBoardWidget';

const params = new URLSearchParams(window.location.search);
const widgetId = params.get('widgetId') ?? undefined;
const parentUrl = params.get('parentUrl') ?? undefined;

const widgetApi = new WidgetApi(widgetId, parentUrl);

widgetApi.requestCapabilityToReceiveState('eu.kiefte.issue');
widgetApi.requestCapabilityToReceiveState('eu.kiefte.issues.schema');
widgetApi.requestCapabilityToSendState('eu.kiefte.issue');
widgetApi.requestCapabilityToSendState('eu.kiefte.issues.schema');
widgetApi.requestCapabilityToReceiveState('m.room.power_levels');

// Timeline event capabilities for comments, reactions, and mentions
widgetApi.requestCapabilityToReceiveEvent('m.room.message');
widgetApi.requestCapabilityToSendEvent('m.room.message');
widgetApi.requestCapabilityToReceiveEvent('m.reaction');
widgetApi.requestCapabilityToSendEvent('m.reaction');

widgetApi.start();

let rendered = false;

widgetApi.once('ready', () => {
  rendered = true;
  const root = createRoot(document.getElementById('widget-root')!);
  root.render(<IssueBoardWidget widgetApi={widgetApi} />);
});

// Fallback: if the Widget API hasn't started after 4s, show a helpful message.
// Two cases:
//   - window.parent === window: opened directly in browser, no Matrix host
//   - window.parent !== window: embedded as plain iframe (e.g. Element Web "Custom widget" UI)
//     but without the Matrix Widget API handshake (no parentUrl/widgetId params → ready never fires)
setTimeout(() => {
  if (rendered) return;
  const isInIframe = window.parent !== window;
  const hasParentUrl = !!parentUrl;
  const root = createRoot(document.getElementById('widget-root')!);
  root.render(
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', gap: 16, padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif',
      color: '#444' }}>
      <div style={{ fontSize: 32 }}>📋</div>
      <div style={{ fontWeight: 600, fontSize: 18 }}>Matrix Issue Tracker Widget</div>
      {isInIframe && !hasParentUrl && (
        <div style={{ maxWidth: 520, color: '#c62828', lineHeight: 1.6, fontSize: 14 }}>
          The widget API is not active. This widget was embedded as a plain iframe — it must be
          registered as a room state event to work (see below).
        </div>
      )}
      <div style={{ maxWidth: 520, color: '#555', fontSize: 13, lineHeight: 1.7, textAlign: 'left' }}>
        <p style={{ marginBottom: 8 }}>
          Send the following state event in the room where you want the widget. Any Matrix client with
          developer tools works (Gomuks, Element Web, etc.).
        </p>
        <pre style={{ background: '#f5f5f5', padding: '10px 14px', borderRadius: 4,
          fontSize: 12, overflowX: 'auto', margin: 0 }}>{
`Event type:  im.vector.modular.widgets
State key:   eu.kiefte.issue-tracker
Content:
{
  "type": "m.custom",
  "url": "${window.location.origin + window.location.pathname}?roomId=$matrix_room_id&userId=$matrix_user_id",
  "name": "Issue Tracker",
  "id": "eu.kiefte.issue-tracker"
}`
        }</pre>
        <p style={{ marginTop: 10, color: '#777' }}>
          <strong>Gomuks:</strong> open Developer Tools (⋮ menu → Developer tools), go to "Send custom event",
          set type to <code>im.vector.modular.widgets</code>, state key to <code>eu.kiefte.issue-tracker</code>,
          paste the content above.
        </p>
        <p style={{ marginTop: 6, color: '#777' }}>
          <strong>Element Web:</strong> use the <code>/addwidget</code> slash command in the room chat:
        </p>
        <pre style={{ background: '#f5f5f5', padding: '6px 14px', borderRadius: 4, fontSize: 12, overflowX: 'auto', margin: '4px 0' }}>{
          `/addwidget ${window.location.origin + window.location.pathname}?roomId=$matrix_room_id&userId=$matrix_user_id`
        }</pre>
        <p style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
          Or use the{' '}
          <a href="https://codeberg.org/lapingvino/cinny" style={{ color: '#1976d2' }}>cinny fork</a>'s
          built-in "Enable widget" button in the issue board toolbar.
          Also see{' '}
          <a href="https://github.com/lapingvino/matrix-issue-widget" style={{ color: '#1976d2' }}>matrix-issue-widget on GitHub</a>.
        </p>
      </div>
    </div>
  );
}, 4000);
