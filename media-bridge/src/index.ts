import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MediaBridgeSession } from './session';

const PORT = parseInt(process.env.PORT || '8080', 10);
const API_SECRET = process.env.MEDIA_BRIDGE_SECRET || '';

// Store active sessions
const sessions = new Map<string, MediaBridgeSession>();

// Create HTTP server for health checks and WebSocket upgrade
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      activeSessions: sessions.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Stats endpoint (protected)
  if (req.url === '/stats') {
    const authHeader = req.headers.authorization;
    if (API_SECRET && authHeader !== `Bearer ${API_SECRET}`) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    const stats = Array.from(sessions.entries()).map(([id, session]) => ({
      sessionId: id,
      callSid: session.getCallSid(),
      duration: session.getDuration(),
      turnsCount: session.getTurnsCount()
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: stats }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const sessionId = uuidv4();
  console.log(`[${sessionId}] New WebSocket connection from ${req.socket.remoteAddress}`);

  // Validate API secret from query params or headers
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const secret = url.searchParams.get('secret') || req.headers['x-api-secret'];
  
  if (API_SECRET && secret !== API_SECRET) {
    console.log(`[${sessionId}] Unauthorized connection attempt`);
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Create session
  const session = new MediaBridgeSession(sessionId, ws);
  sessions.set(sessionId, session);

  // Handle session end
  session.on('end', () => {
    console.log(`[${sessionId}] Session ended, cleaning up`);
    sessions.delete(sessionId);
  });

  ws.on('close', (code, reason) => {
    console.log(`[${sessionId}] WebSocket closed: ${code} - ${reason.toString()}`);
    session.cleanup();
    sessions.delete(sessionId);
  });

  ws.on('error', (error) => {
    console.error(`[${sessionId}] WebSocket error:`, error);
    session.cleanup();
    sessions.delete(sessionId);
  });
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  
  // Close all sessions
  for (const [id, session] of sessions) {
    console.log(`Closing session ${id}`);
    session.cleanup();
  }
  sessions.clear();

  // Close WebSocket server
  wss.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('Forcing exit');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Media Bridge listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
