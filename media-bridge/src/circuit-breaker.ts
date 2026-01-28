/**
 * Circuit Breaker Pattern for External Services
 * Prevents cascading failures by tracking service health
 */

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  openedAt: number;
}

interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening
  resetTimeout: number;        // Time in ms before trying again
  halfOpenRequests: number;    // Requests to allow in half-open state
}

type ServiceName = 'google-stt' | 'google-tts' | 'dialogflow' | 'media-bridge';

const defaultConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,      // 30 seconds
  halfOpenRequests: 2
};

// Circuit states per service
const circuits = new Map<ServiceName, CircuitState>();

// Initialize circuit for a service
function getCircuit(service: ServiceName): CircuitState {
  if (!circuits.has(service)) {
    circuits.set(service, {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
      openedAt: 0
    });
  }
  return circuits.get(service)!;
}

/**
 * Check if circuit is open (service should be bypassed)
 */
export function isCircuitOpen(
  service: ServiceName, 
  config: Partial<CircuitBreakerConfig> = {}
): boolean {
  const cfg = { ...defaultConfig, ...config };
  const circuit = getCircuit(service);

  if (!circuit.isOpen) {
    return false;
  }

  // Check if we should try half-open
  const timeSinceOpen = Date.now() - circuit.openedAt;
  if (timeSinceOpen >= cfg.resetTimeout) {
    // Move to half-open - allow a few requests through
    console.log(`[CircuitBreaker] ${service}: Moving to half-open state`);
    return false;
  }

  return true;
}

/**
 * Record a successful call - resets failure count
 */
export function recordSuccess(service: ServiceName): void {
  const circuit = getCircuit(service);
  
  if (circuit.isOpen) {
    console.log(`[CircuitBreaker] ${service}: Success in half-open, closing circuit`);
  }
  
  circuit.failures = 0;
  circuit.isOpen = false;
  circuit.openedAt = 0;
}

/**
 * Record a failure - may open circuit
 */
export function recordFailure(
  service: ServiceName, 
  config: Partial<CircuitBreakerConfig> = {}
): void {
  const cfg = { ...defaultConfig, ...config };
  const circuit = getCircuit(service);

  circuit.failures++;
  circuit.lastFailure = Date.now();

  if (circuit.failures >= cfg.failureThreshold && !circuit.isOpen) {
    circuit.isOpen = true;
    circuit.openedAt = Date.now();
    console.log(`[CircuitBreaker] ${service}: Circuit OPENED after ${circuit.failures} failures`);
  }
}

/**
 * Get fallback response when circuit is open
 */
export function getFallbackResponse(
  service: ServiceName, 
  language: string = 'he'
): { text: string; audioUrl?: string } {
  const fallbacks: Record<string, Record<ServiceName, string>> = {
    he: {
      'google-stt': 'מצטער, לא הצלחתי לשמוע אותך. אנא נסה שוב.',
      'google-tts': 'יש בעיה זמנית. אנא נסה שוב בעוד רגע.',
      'dialogflow': 'מצטער, יש בעיה טכנית. אנא נסה שוב מאוחר יותר.',
      'media-bridge': 'מצטער, השירות אינו זמין כרגע.'
    },
    ar: {
      'google-stt': 'عذراً، لم أتمكن من سماعك. يرجى المحاولة مرة أخرى.',
      'google-tts': 'هناك مشكلة مؤقتة. يرجى المحاولة لاحقاً.',
      'dialogflow': 'عذراً، هناك مشكلة تقنية. يرجى المحاولة لاحقاً.',
      'media-bridge': 'عذراً، الخدمة غير متوفرة حالياً.'
    },
    en: {
      'google-stt': "Sorry, I couldn't hear you. Please try again.",
      'google-tts': "There's a temporary issue. Please try again in a moment.",
      'dialogflow': "Sorry, there's a technical issue. Please try again later.",
      'media-bridge': "Sorry, the service is temporarily unavailable."
    }
  };

  const langFallbacks = fallbacks[language] || fallbacks['he'];
  return { text: langFallbacks[service] || langFallbacks['dialogflow'] };
}

/**
 * Get circuit breaker status for all services (for monitoring)
 */
export function getCircuitStatus(): Record<ServiceName, { isOpen: boolean; failures: number; openedAt: number }> {
  const status: Record<string, { isOpen: boolean; failures: number; openedAt: number }> = {};
  
  const services: ServiceName[] = ['google-stt', 'google-tts', 'dialogflow', 'media-bridge'];
  
  for (const service of services) {
    const circuit = getCircuit(service);
    status[service] = {
      isOpen: circuit.isOpen,
      failures: circuit.failures,
      openedAt: circuit.openedAt
    };
  }
  
  return status as Record<ServiceName, { isOpen: boolean; failures: number; openedAt: number }>;
}

/**
 * Reset all circuits (for testing or manual intervention)
 */
export function resetAllCircuits(): void {
  circuits.clear();
  console.log('[CircuitBreaker] All circuits reset');
}

/**
 * Force open a circuit (for testing or emergency)
 */
export function forceOpen(service: ServiceName): void {
  const circuit = getCircuit(service);
  circuit.isOpen = true;
  circuit.openedAt = Date.now();
  console.log(`[CircuitBreaker] ${service}: Circuit FORCE OPENED`);
}

/**
 * Force close a circuit (for recovery)
 */
export function forceClose(service: ServiceName): void {
  const circuit = getCircuit(service);
  circuit.isOpen = false;
  circuit.failures = 0;
  circuit.openedAt = 0;
  console.log(`[CircuitBreaker] ${service}: Circuit FORCE CLOSED`);
}
