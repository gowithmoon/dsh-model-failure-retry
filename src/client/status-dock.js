import { StatusDock } from './StatusDock.jsx';

/**
 * Dock the in-session status line (#7) above the composer of every session.
 * Needs the optional `sessions` service: stop goes through the session's
 * `conversation` service, the same cancel DSH's own stop button uses.
 * @param {object} ctx client Cordis context
 * @param {string} ns locale namespace
 */
export function installStatusDock(ctx, ns) {
  ctx.inject(['slots', 'sessions'], (sub) => {
    sub.effect(() => sub.slots.inject('conversation.input.dock', () => sub.slots.register({
      name: 'conversation.input.dock',
      id: 'model-failure-retry-status',
      order: 5,
      locale: ns,
      inject: (sessionId) => ({
        onStop: async () => {
          const conversation = sub.sessions.scope(sessionId)?.get('conversation');
          await conversation?.cancel();
        },
      }),
    }, StatusDock)), 'model-failure-retry: status dock');
  });
}
