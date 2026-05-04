import { createTRPCContext } from "@trpc/tanstack-react-query"
import type { AppRouter } from "../server/router.js"

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()
