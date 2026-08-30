# Graph Report - albiverse  (2026-08-28)

## Corpus Check
- Large corpus: 54 files · ~656,215 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 201 nodes · 259 edges · 21 communities (12 shown, 9 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.85)
- Token cost: 0 input · 972,075 output

## Community Hubs (Navigation)
- Core Feature Screens
- TS Compiler Options
- Repo Docs & Agent Notes
- Core NPM Dependencies
- Dev Tooling Dependencies
- Stubbed Placeholder Pages
- Ambient Audio & Persona Art
- Clock & Countdown UI
- Dashboard Bloom Celebration
- Shared Features DB Schema
- TS Project File Config
- NPM Package Metadata
- Root App Layout
- Scrapbook Slot Component
- ESLint Config File
- Next.js Config File
- PostCSS Config File
- Bloom Flower Asset
- Public Profiles Table
- Invite Code Couples Ref

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `createClient()` - 15 edges
3. `public/images/README.md (Image Asset Guide)` - 11 edges
4. `FeatureStub()` - 8 edges
5. `createClient()` - 7 edges
6. `include` - 7 edges
7. `Next.js` - 7 edges
8. `README.md (Project Overview)` - 6 edges
9. `NYC Skyline Backdrop` - 6 edges
10. `scripts` - 5 edges

## Surprising Connections (you probably didn't know these)
- `NYC Skyline Backdrop` --semantically_similar_to--> `TimelineScreen()`  [INFERRED] [semantically similar]
  public/images/nyc-skyline.png → src/components/TimelineScreen.tsx
- `ambient.mp3 (expected audio asset)` --conceptually_related_to--> `AmbientSound()`  [INFERRED]
  public/audio/README.md → src/components/AmbientSound.tsx
- `SpideyBackground()` --references--> `NYC Skyline Backdrop`  [EXTRACTED]
  src/components/SpideyBackground.tsx → public/images/nyc-skyline.png
- `next/dist/docs Guide (node_modules/next/dist/docs/)` --semantically_similar_to--> `Next.js Documentation`  [INFERRED] [semantically similar]
  AGENTS.md → README.md
- `Bloom Flower Graphic 1 (Maroon Cherry Blossom)` --conceptually_related_to--> `Book-Opening Floral Burst Celebration`  [INFERRED]
  public/images/bloom/flower-1.png → src/components/Dashboard.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Future Feature Media Folder Organization** — public_images_readme_memories_folder, public_images_readme_letters_folder, public_images_readme_music_folder, public_images_readme_vault_folder [EXTRACTED 1.00]
- **Next.js public/ Static Asset Reference Convention** — public_images_readme, public_audio_readme, public_images_peter, public_images_nyc_skyline [INFERRED 0.75]
- **Book-Opening Floral Burst Flower Set (flower-1..7)** — public_images_bloom_flower_1, public_images_bloom_flower_2, public_images_bloom_flower_3, public_images_bloom_flower_4, public_images_bloom_flower_5, public_images_bloom_flower_6, public_images_bloom_flower_7 [EXTRACTED 1.00]
- **Floral Bloom Cascade & Burst Animation (Journal Open)** — src_components_dashboard, public_images_bloom_flower_1, public_images_bloom_flower_2, public_images_bloom_flower_3, public_images_bloom_flower_4, public_images_bloom_flower_5, public_images_bloom_flower_6, public_images_bloom_flower_7 [EXTRACTED 1.00]
- **Bloom Curtain Cascade Flower Image Set (flower-1..7)** — public_images_bloom_flower_1, public_images_bloom_flower_2, public_images_bloom_flower_3, public_images_bloom_flower_4, public_images_bloom_flower_5, public_images_bloom_flower_6, public_images_bloom_flower_7 [EXTRACTED 1.00]
- **Bloom Burst Celebration Animation** — public_images_bloom_flower_1, public_images_bloom_flower_2, public_images_bloom_flower_3, public_images_bloom_flower_4, public_images_bloom_flower_5, public_images_bloom_flower_6, public_images_bloom_flower_7, src_components_dashboard_dashboard [INFERRED 0.95]
- **SpideyBackground Hero Scene Composition** — public_images_nyc_skyline, public_images_peter, public_images_gwen, src_components_spideybackground_spideybackground [INFERRED 0.95]
- **Comic Scrapbook Stage Composition** — public_images_peter, public_images_gwen, public_images_nyc_skyline [INFERRED 0.85]

## Communities (21 total, 9 thin omitted)

### Community 0 - "Core Feature Screens"
Cohesion: 0.16
Nodes (15): DiaryPage(), AuthPage(), CalendarEvent, CountdownsScreen(), CountdownsScreenProps, CoupleConnect(), CoupleConnectProps, DiaryEntry (+7 more)

### Community 1 - "TS Compiler Options"
Cohesion: 0.11
Nodes (19): dom, dom.iterable, esnext, compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules (+11 more)

### Community 2 - "Repo Docs & Agent Notes"
Cohesion: 0.15
Nodes (17): AGENTS.md (Next.js Agent Rules File), next/dist/docs Guide (node_modules/next/dist/docs/), generate-agent-files.js, next dev AGENTS.md Regeneration Mechanism, Next.js Breaking Changes Notice, CLAUDE.md Project Instructions, README.md (Project Overview), create-next-app (+9 more)

### Community 3 - "Core NPM Dependencies"
Cohesion: 0.12
Nodes (17): clsx, lucide-react, next, dependencies, clsx, lucide-react, next, react (+9 more)

### Community 4 - "Dev Tooling Dependencies"
Cohesion: 0.12
Nodes (17): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+9 more)

### Community 6 - "Ambient Audio & Persona Art"
Cohesion: 0.19
Nodes (15): public/audio/README.md (Ambient Audio Asset Guide), ambient.mp3 (expected audio asset), Browser User-Gesture Audio Policy, Gwen (Spider-Gwen) Hanging Character Sprite, NYC Skyline Backdrop, Peter Parker / Spider-Man Character Art, public/images/README.md (Image Asset Guide), letters/ folder (planned) (+7 more)

### Community 7 - "Clock & Countdown UI"
Cohesion: 0.19
Nodes (9): ClockPage(), CountdownsPage(), TimelinePage(), ClockScreen(), ClockScreenProps, TimeBreakdown, FlipDigitUnit(), FlipDigitUnitProps (+1 more)

### Community 8 - "Dashboard Bloom Celebration"
Cohesion: 0.19
Nodes (13): Book-Opening Floral Burst Celebration, Diary/Scrapbook Feature, Kiss Mark / Lipstick Print Motif, Bloom Flower Graphic 1 (Maroon Cherry Blossom), Flower Bloom Stage 3 (Red Hibiscus), Flower Bloom Stage 4 - Full Bloom Red Rose, Bloom Flower 5 (Lipstick Kiss Mark Graphic), Flower-6 Bloom Burst Asset (Lace Bow Illustration) (+5 more)

### Community 9 - "Shared Features DB Schema"
Cohesion: 0.42
Nodes (9): auth.users, public.bucket_list, public.calendar_events, public.is_couple_member(), public.letters, public.media_items, public.partner_vault, public.shared_diary (+1 more)

### Community 10 - "TS Project File Config"
Cohesion: 0.20
Nodes (9): **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx, exclude (+1 more)

### Community 11 - "NPM Package Metadata"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

## Knowledge Gaps
- **76 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+71 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `Core Feature Screens` to `Clock & Countdown UI`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `README.md (Project Overview)` connect `Repo Docs & Agent Notes` to `Core Feature Screens`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `NYC Skyline Backdrop` connect `Ambient Audio & Persona Art` to `Core Feature Screens`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _76 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TS Compiler Options` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Core NPM Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `Dev Tooling Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._