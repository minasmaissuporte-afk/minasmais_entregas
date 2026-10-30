---
name: API client codegen compatibility
description: Why the shared Orval-generated React Query client needs explicit TanStack v5 and DOM iterable settings.
---

The shared API client uses TanStack Query v5. Orval may default to v4 when it cannot infer the frontend package dependency, producing query-hook option types that reject valid partial options such as a polling interval. The client TypeScript project also needs `DOM.Iterable` for generated `Headers.entries()` usage.

**Why:** Code generation completed successfully while the generated client library typecheck failed or frontend hook options did not typecheck.

**How to apply:** Preserve the explicit React Query v5 override and DOM iterable library entry when editing the shared API generator or client TypeScript settings; rerun codegen and the workspace typecheck after OpenAPI changes.

## Shared React Query context

The shared `@workspace/api-client-react` package should declare `@tanstack/react-query` as a peer dependency, and Vite consumers should dedupe it. This keeps generated hooks on the same context instance as the app's `QueryClientProvider`.

**Why:** A production bundle contained two copies of TanStack Query; authenticated routes failed at runtime with “No QueryClient set” even though the app rendered a provider.

**How to apply:** When adding consumers of the generated React Query hooks, verify the bundle contains one TanStack Query context and keep the dependency as a shared peer.
