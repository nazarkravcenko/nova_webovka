import cookie from 'cookie';
import { WebSocketServer } from 'ws';

export class RealtimeHub {
  constructor(server, sessionService) {
    this.sessionService = sessionService;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.clients = new Set();
    this.bind();
  }

  bind() {
    this.wss.on('connection', (socket, request) => {
      const cookies = cookie.parse(request.headers.cookie || '');
      const session = this.sessionService.find(cookies.sid);
      socket.role = session?.role || 'guest';
      this.clients.add(socket);

      socket.send(JSON.stringify({ type: 'hello', role: socket.role, online: this.clients.size }));
      this.broadcast({ type: 'presence', online: this.clients.size });

      socket.on('close', () => {
        this.clients.delete(socket);
        this.broadcast({ type: 'presence', online: this.clients.size });
      });
    });
  }

  broadcast(payload, adminOnly = false) {
    const message = JSON.stringify({ ...payload, at: new Date().toISOString() });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN && (!adminOnly || client.role === 'admin')) {
        client.send(message);
      }
    }
  }
}
