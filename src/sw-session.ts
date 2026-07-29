type PendingSession = { baseUrl?: string; accessToken?: string };

let pending: PendingSession | undefined;
let waitingForControl = false;

/**
 * Hand the current session to the service worker, which is the only thing that
 * can attach the auth header to authenticated-media (MSC3916) requests.
 *
 * The subtlety is `navigator.serviceWorker.controller`: it is null until a
 * worker actually controls THIS page — on a first load, and again for a while
 * after the worker updates. Dropping the session in that window (what line 3
 * used to do) is silent and permanent: the worker never learns the token, every
 * avatar request 401s, and room icons render initials instead of pictures for
 * the rest of the session. The worker does ask for a session when it sees an
 * unauthenticated media request, but that ask times out after 3s and then
 * serves the request WITHOUT auth — so a slow answer still costs a picture.
 *
 * So never drop it: with no controller yet, remember the session and send it the
 * moment `controllerchange` says we are controlled. Latest call wins.
 */
export function pushSessionToSW(baseUrl?: string, accessToken?: string) {
  if (!('serviceWorker' in navigator)) return;

  const { controller } = navigator.serviceWorker;
  if (controller) {
    controller.postMessage({
      type: 'setSession',
      accessToken,
      baseUrl,
    });
    return;
  }

  pending = { baseUrl, accessToken };
  if (waitingForControl) return;
  waitingForControl = true;
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      waitingForControl = false;
      const session = pending;
      pending = undefined;
      if (session) pushSessionToSW(session.baseUrl, session.accessToken);
    },
    { once: true }
  );
}
