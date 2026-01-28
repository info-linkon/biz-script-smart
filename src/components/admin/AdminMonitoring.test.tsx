import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminMonitoring } from "./AdminMonitoring";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: {
          mediaBridge: {
            configured: true,
            status: { status: "healthy", activeSessions: 2 }
          },
          performance: {
            avgTtfsMs: 350,
            avgEndToAudioMs: 650,
            bargeIns24h: 5,
            sttFailures24h: 1
          },
          calls: { active: 2 },
          rateLimiting: { eventsLastHour: 3 }
        }
      })
    }
  }
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe("AdminMonitoring", () => {
  it("renders the monitoring dashboard", async () => {
    render(<AdminMonitoring />, { wrapper: createWrapper() });
    
    // Should show title in Hebrew
    expect(screen.getByText(/ניטור מערכת/i)).toBeInTheDocument();
  });

  it("displays Media Bridge status card", async () => {
    render(<AdminMonitoring />, { wrapper: createWrapper() });
    
    // Should have Media Bridge section
    expect(screen.getByText(/Media Bridge/i)).toBeInTheDocument();
  });

  it("displays performance metrics section", async () => {
    render(<AdminMonitoring />, { wrapper: createWrapper() });
    
    // Should have performance metrics
    expect(screen.getByText(/ביצועים/i)).toBeInTheDocument();
  });

  it("displays active calls section", async () => {
    render(<AdminMonitoring />, { wrapper: createWrapper() });
    
    // Should have active calls
    expect(screen.getByText(/שיחות פעילות/i)).toBeInTheDocument();
  });
});
