// The panel's only contact with its host: send a request, receive messages.

import type { FromWebview, ToWebview } from "../shared/protocol";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const host = acquireVsCodeApi();

export const send = (m: FromWebview): void => host.postMessage(m);

export function onMessage(handler: (m: ToWebview) => void): void {
  window.addEventListener("message", (e: MessageEvent<ToWebview>) => handler(e.data));
}
