import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MediaBridgeSession } from './session';
import { getCircuitStatus, getActiveJtiCount } from './auth';

const PORT = parseInt(process.env.PORT || '8080', 10);
const API_SECRET = process.env.MEDIA_BRIDGE_SECRET || '';
const DEV_TOKEN = process.env.DEV_TOKEN || '';

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
      turnsCount: session.getTurnsCount(),
      validated: session.isValidated()
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      sessions: stats,
      circuitBreaker: getCircuitStatus(),
      activeJtis: getActiveJtiCount()
    }));
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

  // Create session - validation now happens via Twilio start message customParameters
  // API_SECRET is passed to session for token verification
  const session = new MediaBridgeSession(sessionId, ws, API_SECRET, DEV_TOKEN);
  sessions.set(sessionId, session);

  // Handle validation events
  session.on('validated', () => {
    console.log(`[${sessionId}] Session validated successfully`);
  });

  session.on('validation_failed', (reason: string) => {
    console.log(`[${sessionId}] Validation failed: ${reason}`);
    ws.close(4001, reason);
    sessions.delete(sessionId);
  });

  // Handle session end
  session.on('end', () => {
    console.log(`[${sessionId}] Session ended, cleaning up`);
    sessions.delete(sessionId);
  });

  ws.on('close', (code, reason) => {
    console.log(`[${sessionId}] WebSocket closed: ${code} - ${reason.toString()}`);
    session.recordWSClose(code, reason.toString());
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
  console.log(`API Secret configured: ${API_SECRET ? 'Yes' : 'No'}`);
  console.log(`Dev Token configured: ${DEV_TOKEN ? 'Yes' : 'No'}`);
});

// Export for re-use in auth.ts
export { getActiveJtiCount } from './auth';
