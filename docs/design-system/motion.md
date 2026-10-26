# Lightweight motion specification

Motion explains feedback or continuity. It must not delay navigation, data,
validation, recording payments or attendance. Use CSS first; no GSAP, Lottie,
scroll hijacking, background animation loops or animation dependency by default.

| Interaction | Proposed duration | Behavior |
| --- | --- | --- |
| Button/control press | 80–120ms | Color/opacity; optional subtle transform, no change in layout |
| Tabs/filters | 120–160ms | Selected state; content only once data is ready, no false directional hierarchy |
| Dialog/sheet | 180–220ms | Opacity plus small transform; restore focus, Escape and keyboard intact |
| Validation/save feedback | 120–160ms | Inline appearance and accessible announcement; focus moves to errors as appropriate |
| Chart period changes | 160–220ms | At most a restrained data update; no replaying chart entrance on every render |
| List→detail | Optional 160–200ms | Only if stable version-compatible integration is proven; normal instant navigation is a valid fallback |
| Background refresh | None | Quiet updates, never page-wide fade or scroll reset |

Prefer transform and opacity. Avoid animating width/height/top/left, large filters
or shadows; do not add permanent will-change layers. Skeletons preserve layout;
static placeholders by default, no mandatory shimmering. Never hide focus rings.

Respect prefers-reduced-motion and an optional personal Reduced motion control;
reduced mode removes transforms/reordering/scroll animation and uses immediate
feedback. Never force smooth scrolling or custom swipe gestures over browser Back.
SSR and no-animation paths must work; transitions are progressive enhancement.

Pinned stack is Next15.5.24, React19.2.8. Installed Next config includes an
experimental viewTransition flag, but Next15 official documentation advises
against production use. Do NOT enable it, install React canary or upgrade the
framework for cosmetic motion. Start with stable CSS. Any later native route
transition requires a separate compatibility/security/accessibility experiment.

Tests before implementation: reduce-motion computed behavior; dialog focus/Escape
and return; no unexpected transform after completion; no blocked control while
animation runs; no layout shift from placeholders; navigation/back/scroll behavior.
Measure real mobile interaction with throttling and inspect long tasks; report
actual conditions. Target good Core Web Vitals (LCP≤2.5s, INP≤200ms, CLS≤0.1),
while clearly separating lab evidence from real-user percentile claims.

Sources: [web.dev performance](https://web.dev/articles/animations-guide),
[reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion),
[Next15 transition status](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/viewTransition).
