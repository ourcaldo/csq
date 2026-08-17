# Phase 2 — Auth & Tenant Isolation

**Goal:** Implement authentication (Auth.js credentials provider), the `withAuth`
HOC, session helpers, and tenant resolution logic. Every `/dashboard/*` page
must be protected.
**PRD Reference:** Sections 5, 18 (Authorization), 23A (Auth), 23B.6
**Depends On:** Phase 0, Phase 1

---

## Tasks

### 2.1 Auth.js configuration

- [ ] Create `src/pages/api/auth/[...nextauth].ts` with NextAuth config:
  - Credentials provider (email + password).
  - JWT session strategy (not database sessions — simpler for MVP).
  - Callbacks:
    - `jwt`: embed `userId`, `tenantId`, `role` into the token.
    - `session`: pass token data to client session object.
  - `NEXTAUTH_SECRET` from env. `NEXTAUTH_URL` from env.
- [ ] Zod-validate email and password on sign-in attempt.
- [ ] Hash passwords with `bcrypt` (add dependency).

### 2.2 Password hashing

- [ ] `npm i bcryptjs` and `npm i -D @types/bcryptjs`.
- [ ] Create `src/lib/password.ts`:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, hash: string): Promise<boolean>`
- [ ] Use these exclusively. Never store or compare raw passwords.

### 2.3 Registration page

- [ ] Create `src/pages/register.tsx`:
  - Form: name, email, password, business name (creates Tenant + User).
  - Zod validation on all fields.
  - On submit: hash password, create Tenant, create User with tenantId,
    redirect to `/dashboard`.
  - Tenant slug auto-generated from business name (kebab-case, unique).

### 2.4 Login page

- [ ] Create `src/pages/login.tsx`:
  - Form: email, password.
  - Call `signIn("credentials", { email, password, redirect: false })`.
  - On success: redirect to `/dashboard`.
  - On error: show error message.
  - Link to `/register`.

### 2.5 `withAuth` HOC

- [ ] Create `src/lib/auth.ts` with `withAuth`:
  ```ts
  // Simplified signature — full implementation handles SSR session retrieval
  import { GetServerSideProps, GetServerSidePropsContext } from "next";
  import { getSession } from "next-auth/react";

  type WithAuthOptions = {
    required?: boolean; // default true
  };

  export function withAuth(
    gssp?: GetServerSideProps,
    options?: WithAuthOptions
  ): GetServerSideProps {
    return async (ctx: GetServerSidePropsContext) => {
      const session = await getSession(ctx);
      if (!session && (options?.required !== false)) {
        return {
          redirect: { destination: "/login", permanent: false },
        };
      }
      if (gssp) return gssp(ctx);
      return { props: {} };
    };
  }
  ```
- [ ] Export `requireAuth = withAuth()` for pages that always need auth.
- [ ] Export `optionalAuth = withAuth(undefined, { required: false })` for
  pages that work both ways.

### 2.6 Protect dashboard pages

- [ ] Wrap `src/pages/dashboard/index.tsx` with `requireAuth`:
  ```ts
  export const getServerSideProps = requireAuth;
  ```
- [ ] Every future dashboard page MUST use this pattern. No exceptions.

### 2.7 Session helper for API routes

- [ ] Create `src/lib/auth.ts` export `getAuthSession(request)`:
  - Used in API routes and server-side code to extract userId and tenantId.
  - Returns typed session or throws.
- [ ] Every API route that touches tenant data MUST call this first.

### 2.8 Tenant resolution middleware helper

- [ ] Create `src/lib/tenant-context.ts`:
  - `resolveTenantId(session)`: extract tenantId from session.
  - `setTenantContext(prisma, tenantId)`: set `app.current_tenant_id` Postgres
    session variable (for RLS, see Phase 1.8).
- [ ] This is called at the start of every server-side request handler.

### 2.9 `_app.tsx` session provider

- [ ] Update `src/pages/_app.tsx` to wrap with `<SessionProvider>` from
  `next-auth/react`.
- [ ] This is required for client-side session access.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual test: visit `/dashboard` → redirected to `/login`.
- [ ] Manual test: visit `/login`, register, get redirected to `/dashboard`.
- [ ] Manual test: visit `/dashboard` while logged in → page loads.

---

## Files Created/Modified

```
src/
├── lib/
│   ├── auth.ts              (withAuth, getAuthSession, requireAuth)
│   ├── password.ts          (hash, verify)
│   └── tenant-context.ts    (resolveTenantId, setTenantContext)
├── pages/
│   ├── _app.tsx             (add SessionProvider)
│   ├── login.tsx
│   ├── register.tsx
│   ├── dashboard/
│   │   └── index.tsx        (wrapped with requireAuth)
│   └── api/
│       └── auth/
│           └── [...nextauth].ts
```

---

## Notes

- No OAuth, no magic links, no social login. Email + password only for MVP.
- No role-based access beyond "is authenticated and belongs to this tenant."
  Future: admin vs staff roles.
- The session token carries `userId` + `tenantId`. API routes use
  `getAuthSession()` to extract these — never trust client-side claims.
