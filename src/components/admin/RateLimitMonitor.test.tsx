import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RateLimitMonitor } from "./RateLimitMonitor";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "1",
                user_id: "user-1",
                operation_type: "voice_call",
                limit_type: "per_minute",
                created_at: new Date().toISOString(),
                ip_address: "192.168.1.1"
              },
              {
                id: "2",
                user_id: "user-2",
                operation_type: "webhook",
                limit_type: "per_hour",
                created_at: new Date().toISOString(),
                ip_address: "192.168.1.2"
              }
            ],
            error: null
          })
        })
      })
    })
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

describe("RateLimitMonitor", () => {
  it("renders the rate limit monitor", async () => {
    render(<RateLimitMonitor />, { wrapper: createWrapper() });
    
    // Should show title in Hebrew
    expect(screen.getByText(/אירועי Rate Limit/i)).toBeInTheDocument();
  });

  it("displays table headers", async () => {
    render(<RateLimitMonitor />, { wrapper: createWrapper() });
    
    // Should have table headers
    expect(screen.getByText(/זמן/i)).toBeInTheDocument();
    expect(screen.getByText(/פעולה/i)).toBeInTheDocument();
    expect(screen.getByText(/סוג מגבלה/i)).toBeInTheDocument();
  });

  it("shows refresh button", async () => {
    render(<RateLimitMonitor />, { wrapper: createWrapper() });
    
    // Should have refresh button
    expect(screen.getByText(/רענן/i)).toBeInTheDocument();
  });
});
