import type { IncomingMessage, ServerResponse } from 'node:http';

export const PEER_HEADER: string;
export function preparePeer(req: Pick<IncomingMessage, 'headers'> & { socket?: { remoteAddress?: string } }): void;
export function createStaticServer(clientRoot: string): (req: IncomingMessage, res: ServerResponse) => boolean;
export function toRequest(req: IncomingMessage, res: ServerResponse, port: number): Request;
export function sendResponse(response: Response, res: ServerResponse): Promise<void>;
export function createRequestHandler(options: {
  app: { fetch(request: Request): Response | Promise<Response> };
  serveStatic: (req: IncomingMessage, res: ServerResponse) => boolean;
  port: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
