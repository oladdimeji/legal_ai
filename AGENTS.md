# Legal AI Compact Upgrade Rules

1. Preserve the existing React, Express, PostgreSQL and Gemini architecture.
2. Preserve the current white, black and grayscale interface.
3. Do not perform destructive database or table renames.
4. Use Matter in the UI while retaining cases and case_id internally where useful.
5. Do not delete or reset existing data.
6. Every database query must be scoped to the authenticated workspace.
7. General context must never retrieve Matter information.
8. A Matter must never retrieve another Matter's information.
9. Do not add Firebase Auth, Auth0, Clerk or another authentication service.
10. Implement only the phase or phase range explicitly named in the task.
11. Do not redesign unrelated components.
12. Add repeatable and non-destructive database migrations.
13. Run npm run lint after every completed phase.
14. Run npm run build after every completed phase.
15. Report all changed files, schema changes, assumptions and remaining issues.
16. Stop after completing the requested phase or phase range.
17. Update docs/UPGRADE_PROGRESS.md after every completed phase.
18. Commit every completed phase separately.
19. Do not continue past a failing lint or build command.
20. Do not use a default, first, or fallback user after authentication is introduced.
21. Stop before any destructive migration, data reset or irreversible operation.

22. Installing dependencies already declared in package.json is permitted. Use npm ci when a package-lock.json exists; otherwise use npm install. Do not intentionally change dependency versions unless the requested phase requires it.

23. Application startup must never delete, reset or reseed user data. Demo seeding must be explicitly enabled through an environment variable and disabled by default.

24. Work Product must remain available when its originating conversation is deleted.