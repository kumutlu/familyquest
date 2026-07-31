# Queki Help Center — Implementation Plan

Status: **Awaiting approval** (no product code written yet)

## 1. Findings from the existing application

| Area | Evidence in code | Help article mapping |
| --- | --- | --- |
| Routing | [`App.tsx`](../src/App.tsx:53) — routes: `/`, `/onboarding`, `/family`, `/family/:id`, `/tasks`, `/rewards`, `/pet-box`, `/wallet`, `/wallets`, `/goals`, `/goals/:goalId`, `/notifications`, `/history`, `/settings`, plus public `/login`, `/signup`, `/privacy`, `/terms`, `/account-deletion` | One article per route + cross-cutting articles |
| i18n | [`config.ts`](../src/i18n/config.ts:17) with `SUPPORTED_LANGUAGES = ['en','tr']`, lazy namespaces via [`backend.ts`](../src/i18n/backend.ts:11) `import.meta.glob('./locales/*/*.json')` | Add namespace `help` for UI chrome; article bodies live in `src/help/data/<lng>/` |
| Navigation | [`navigation.ts`](../src/config/navigation.ts:18) — 4 tabs (Home, Tasks, Rewards, Family); Settings in profile dropdown | Help entry point added to `ProfileDropdown` + `/help` route |
| Wallet | `AddMoneyModal`, `SendMoneyModal`, `RequestMoneyModal`, `PendingTransfers`, `MoneyInsights`, `TransactionList` | Wallet, Child Transfers, Wallet history |
| Allowance | `wallet:allowance.*` keys, `allowance` transaction category in [`transactionModel.ts`](../src/lib/transactionModel.ts:50) | Weekly Allowance |
| Approvals | [`ApprovalCenter.tsx`](../src/components/parent/ApprovalCenter.tsx), `approvalContracts.ts`, `requests/` | Approval Center |
| Pet Box | `/pet-box` → `FundsDashboard`, `funds/FundCard`, `PetLeaderboard`, `ExpenseModal` | Pet Box |
| Bulletin | [`FamilyBulletin.tsx`](../src/components/bulletin/FamilyBulletin.tsx), `familyBulletin.ts` | Family Bulletin |
| Behaviours | `lib/behaviour.ts`, `behaviour` i18n namespace | Behaviours |
| Gamification | `domain/gamification/*` (xp, level, streak, perfectDay) | Dashboard / Child Guide |
| Notifications | `Notifications.tsx`, `pushNotifications.ts`, `useNotifications.ts` | Notifications |
| Account & security | `Settings.tsx`, `accountDeletionApi.ts`, `familyDeletionApi.ts`, `childLoginApi` | Account & Security |

Anything not backed by the above will be rendered with a **Coming Soon** callout rather than invented behaviour.

## 2. Module architecture

```
src/help/
  types/index.ts            HelpArticle, HelpSection, HelpCategory, HelpBlock unions
  data/
    registry.ts             locale -> article-loader map (import.meta.glob, code-split)
    categories.ts           category ids, icons, order
    en/<article-id>.ts      20 typed article modules
    tr/<article-id>.ts      20 typed article modules
  search/
    index.ts                buildIndex(), searchArticles()
    tokenize.ts             locale-aware normalisation (TR dotless-i folding)
  components/
    HelpSearchBox.tsx  HelpArticleCard.tsx  HelpCategoryGrid.tsx
    HelpBreadcrumbs.tsx  HelpBody.tsx (block renderer)  HelpCallout.tsx
    HelpSteps.tsx  RelatedArticles.tsx  HelpButton.tsx (contextual "?")
    ComingSoon.tsx
  pages/
    HelpHome.tsx  HelpArticlePage.tsx  HelpCategoryPage.tsx  HelpSearchResults.tsx
  useHelpArticle.ts / useHelpSearch.ts hooks
  helpRouteMap.ts           app route -> article id (contextual help)
```

Key decisions:
- **Content as typed TS modules, not JSON** → compile-time safety on `id`, `category`, `related` ids; still fully data-driven and lazily code-split per article per locale.
- **Locale fallback**: missing `tr` article falls back to `en` and shows a "not yet translated" notice.
- **Adding a language** = create `src/help/data/<lng>/` + add the code to `SUPPORTED_LANGUAGES`. The registry glob picks it up automatically.
- UI strings (search placeholder, "X min read", category names, buttons) go into a new i18n namespace `help` → `src/i18n/locales/{en,tr}/help.json`, added to `NAMESPACES`.

## 3. Data model

```ts
type HelpBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'steps'; steps: { title: string; detail?: string }[] }
  | { kind: 'callout'; tone: 'tip' | 'warning' | 'info' | 'comingSoon'; text: string }
  | { kind: 'faq'; items: { q: string; a: string }[] };

interface HelpSection {
  id: 'what' | 'why' | 'who' | 'how' | 'steps' | 'tips' | 'mistakes' | 'related' | string;
  heading: string;
  blocks: HelpBlock[];
}

interface HelpArticle {
  id: HelpArticleId;            // union of the 20 ids
  title: string;
  description: string;
  category: HelpCategoryId;
  keywords: string[];
  readingTimeMinutes: number;
  updatedAt: string;            // ISO date, powers "Recent Updates"
  audience: ('parent' | 'child' | 'everyone')[];
  popular?: boolean;
  sections: HelpSection[];
  related: HelpArticleId[];
}
```

Every article uses the mandated section order: What it is → Why it exists → Who can use it → How it works → Step-by-step → Tips → Common mistakes → Related features.

## 4. Articles & categories

Categories: `basics`, `roles`, `daily`, `money`, `family`, `account`, `support`.

| # | id | category |
|---|---|---|
| 1 | `welcome` | basics |
| 2 | `getting-started` | basics |
| 3 | `parent-guide` | roles |
| 4 | `child-guide` | roles |
| 5 | `dashboard` | daily |
| 6 | `tasks` | daily |
| 7 | `behaviours` | daily |
| 8 | `rewards` | daily |
| 9 | `wallet` | money |
| 10 | `child-transfers` | money |
| 11 | `weekly-allowance` | money |
| 12 | `savings-goals` | money |
| 13 | `pet-box` | money |
| 14 | `family-bulletin` | family |
| 15 | `approval-center` | family |
| 16 | `family-management` | family |
| 17 | `account-security` | account |
| 18 | `notifications` | account |
| 19 | `faq` | support |
| 20 | `troubleshooting` | support |

## 5. Routing & navigation

New routes inside `AppLayout`:
- `/help` → HelpHome (Search box, Getting Started, Popular, Categories, Recent Updates)
- `/help/search?q=` → results
- `/help/category/:categoryId`
- `/help/:articleId`

Entry points: profile dropdown "Help & Support", and a contextual `HelpButton` (`?`) in each page header driven by `helpRouteMap`:
`/wallet→wallet`, `/wallets→wallet`, `/tasks→tasks`, `/rewards→rewards`, `/goals→savings-goals`, `/pet-box→pet-box`, `/family→family-management`, `/notifications→notifications`, `/settings→account-security`, `/→dashboard`, `/history→wallet`.
The button navigates to `/help/:articleId?from=<path>` — **single source of content, zero duplication**; the article page shows a "Back to Wallet" affordance.

## 6. Search

Client-side, no dependency: build a lazily-created index over `title` (×5), `keywords` (×4), `category` (×2), `description` (×2), flattened body text (×1). Locale-aware `tokenize()` handles Turkish casing (`İ/ı/ş/ğ`) via `toLocaleLowerCase(lng)` + diacritic folding. Prefix matching, per-field weighting, snippet + highlight, debounce 150 ms, keyboard navigable results.

## 7. Phases & deliverables

| Phase | Deliverable | Tests |
| --- | --- | --- |
| 1 | types, registry, categories, routes, page shells, `help` i18n namespace, HelpButton | route smoke tests, registry integrity |
| 2 | 20 English articles | schema test: all sections present, related ids resolve, no orphan articles |
| 3 | 20 Turkish articles | parity test: en/tr have identical ids & section ids |
| 4 | Contextual `?` buttons wired into all page headers | test: every mapped route resolves to an existing article |
| 5 | Search index + results page | unit tests incl. Turkish query cases |
| 6 | Polish: skeletons, empty states, reading-time badges, breadcrumbs, a11y (landmarks, focus, `aria-current`), responsive layout, dark-mode parity | a11y/responsive tests |

## 8. Acceptance criteria

- A new family can complete first-run setup using only `/help`.
- Zero hardcoded English in components; all chrome from the `help` namespace.
- Every article available in EN and TR with identical structure.
- Every app page exposes a working `?` button.
- Search finds an article by title, keyword, category and body text in both languages.
- No documented behaviour without corresponding code; gaps marked **Coming Soon**.
