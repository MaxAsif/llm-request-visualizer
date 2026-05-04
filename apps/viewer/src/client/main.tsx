import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createTRPCClient, httpBatchLink } from "@trpc/client"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import type { AppRouter } from "../server/router.js"
import { App } from "./App.js"
import { TRPCProvider } from "./trpc.js"

const queryClient = new QueryClient()
const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })]
})

const root = document.getElementById("root")
if (root === null) throw new Error("missing #root")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>
)
